/**
 * Folds anime added season by season into one entry per show.
 *
 * Runs shortly after startup and does nothing unless two entries turn out to be seasons of the
 * same show. Before the first change it copies the whole library aside, so a merge that went
 * wrong can be undone by restoring that file.
 */
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { db, dbPath } from './db/index';
import { showRoots } from './metadata/franchise';

type Row = {
	id: number;
	sourceId: string;
	title: string;
	year: number | null;
	status: string;
	rating: number | null;
	rewatches: number;
	favorite: number;
	notes: string;
	startedOn: string | null;
	finishedOn: string | null;
	lastSeason: number | null;
	lastEpisode: number | null;
};

export type MergePlan = { keep: Row; fold: Row[] }[];

function backupOnce(): void {
	const dir = join(dirname(dbPath), 'backups');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const file = join(dir, `library-before-season-merge-${new Date().toISOString().slice(0, 10)}.db`);
	if (existsSync(file)) return;
	db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/** All seasons finished → finished; anything started → watching; otherwise the kept one's. */
function mergedStatus(rows: Row[], keep: Row): string {
	if (rows.every((r) => r.status === 'completed')) return 'completed';
	if (rows.some((r) => r.status === 'watching')) return 'watching';
	if (rows.some((r) => r.status === 'completed')) return 'watching';
	return keep.status;
}

export async function planSeasonMerge(): Promise<MergePlan> {
	const rows = db
		.prepare(`
			SELECT id, source_id AS sourceId, title, year, status, rating, rewatches, favorite, notes,
			       started_on AS startedOn, finished_on AS finishedOn,
			       last_season AS lastSeason, last_episode AS lastEpisode
			FROM entries WHERE source = 'anilist' AND source_id IS NOT NULL
		`)
		.all() as unknown as Row[];
	if (rows.length < 2) return [];

	const rootOf = await showRoots(rows.map((r) => Number(r.sourceId)));
	const groups = new Map<number, Row[]>();
	for (const row of rows) {
		const root = rootOf.get(Number(row.sourceId)) ?? Number(row.sourceId);
		groups.set(root, [...(groups.get(root) ?? []), { ...row }]);
	}

	const plan: MergePlan = [];
	for (const [root, members] of groups) {
		if (members.length < 2) continue;
		const sorted = [...members].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id - b.id);
		const keep = sorted.find((r) => r.sourceId === String(root)) ?? sorted[0];
		plan.push({ keep, fold: sorted.filter((r) => r !== keep) });
	}
	return plan;
}

export async function mergeAnimeSeasons(): Promise<number> {
	const plan = await planSeasonMerge();
	if (plan.length === 0) return 0;

	backupOnce();
	const update = db.prepare(`
		UPDATE entries SET status = ?, rating = ?, rewatches = ?, favorite = ?, notes = ?,
			started_on = ?, finished_on = ?, last_season = ?, last_episode = ?, updated_at = ?
		WHERE id = ?
	`);
	const remove = db.prepare('DELETE FROM entries WHERE id = ?');

	db.exec('BEGIN');
	try {
		for (const { keep, fold } of plan) {
			const all = [keep, ...fold];
			const latest = all
				.filter((r) => r.lastSeason != null)
				.sort((a, b) => (b.lastSeason! - a.lastSeason!) || ((b.lastEpisode ?? 0) - (a.lastEpisode ?? 0)))[0];
			const notes = [...new Set(all.map((r) => r.notes.trim()).filter(Boolean))].join('\n\n');
			const started = all.map((r) => r.startedOn).filter(Boolean).sort()[0] ?? null;
			const finished = all.map((r) => r.finishedOn).filter(Boolean).sort().at(-1) ?? null;
			const status = mergedStatus(all, keep);
			const ratings = all.map((r) => r.rating).filter((r): r is number => r != null);
			const rating = keep.rating ?? (ratings.length ? Math.max(...ratings) : null);

			update.run(
				status,
				rating,
				Math.max(...all.map((r) => r.rewatches ?? 0)),
				all.some((r) => r.favorite) ? 1 : 0,
				notes,
				started,
				status === 'completed' ? finished : keep.finishedOn,
				latest?.lastSeason ?? null,
				latest?.lastEpisode ?? null,
				new Date().toISOString(),
				keep.id
			);
			for (const row of fold) remove.run(row.id);
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
	return plan.reduce((n, g) => n + g.fold.length, 0);
}
