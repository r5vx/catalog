/**
 * Settings → Storage: how much Catalog keeps on this computer to load things faster, and a
 * limit on it.
 *
 * What counts towards the limit is only what can be had again: preview pictures for the
 * progress bar, subtitle files, answers from TMDB and the rest (details, scores, which file is
 * which episode), and the app's own cache of pictures and video. Your library, notes and
 * backups never do. Over the limit, the oldest go first; anything cleared is fetched again the
 * next time it's wanted.
 *
 * The app's own cache is the desktop app's to manage (electron/main.cjs): it's told its share
 * through storage.json, read as it starts, and asked to empty it by message.
 */
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, dataDir, dbPath } from './db';
import { readSettings } from './settings';

export const LIMITS = [
	{ mb: 100, label: '100 MB' },
	{ mb: 250, label: '250 MB' },
	{ mb: 500, label: '500 MB' },
	{ mb: 1000, label: '1 GB' },
	{ mb: 2000, label: '2 GB' }
] as const;
const DEFAULT_MB = 500;
const MB = 1024 * 1024;

/**
 * Each kind's own share of the limit, so one can't crowd out the rest: pictures and video
 * pieces are by far the biggest, looked-up answers the smallest and most useful.
 */
export const SHARES = { appCache: 0.5, previews: 0.2, subtitles: 0.15, lookups: 0.15 } as const;

/** Kept in the lookups but not a lookup: never trimmed. */
const NOT_LOOKUPS = ['slow-requests'];

export function storageLimitMb(): number {
	const saved = Number(readSettings().storageLimitMb);
	return LIMITS.some((l) => l.mb === saved) ? saved : DEFAULT_MB;
}

function folderSize(path: string): number {
	if (!existsSync(path)) return 0;
	let total = 0;
	for (const name of readdirSync(path)) {
		try {
			const file = join(path, name);
			const info = statSync(file);
			total += info.isDirectory() ? folderSize(file) : info.size;
		} catch {}
	}
	return total;
}

function fileSize(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

const previewsDir = () => join(dataDir, 'previews');
// Where the desktop app keeps its cache: beside the library (both live in %APPDATA%\Catalog).
const appCacheDirs = () => [join(dataDir, 'Cache'), join(dataDir, 'Code Cache')];

export type StorageReport = {
	library: number;
	backups: number;
	previews: number;
	subtitles: number;
	lookups: number;
	appCache: number;
	limitMb: number;
};

export function storageReport(): StorageReport {
	const subtitles = (db.prepare('SELECT COALESCE(sum(length(content)), 0) AS n FROM saved_subtitles').get() as { n: number }).n;
	const lookups = (db.prepare('SELECT COALESCE(sum(length(value)), 0) AS n FROM watch_order_cache').get() as { n: number }).n;
	const libraryFile = fileSize(dbPath) + fileSize(`${dbPath}-wal`);
	return {
		// The library file holds the kept subtitles and lookups too; they're shown on their own.
		library: Math.max(0, libraryFile - subtitles - lookups),
		backups: folderSize(join(dataDir, 'backups')),
		previews: folderSize(previewsDir()),
		subtitles,
		lookups,
		appCache: appCacheDirs().reduce((total, dir) => total + folderSize(dir), 0),
		limitMb: storageLimitMb()
	};
}

/** The desktop app's share of the limit, written where it reads it on starting. */
export function tellAppItsShare(): void {
	try {
		writeFileSync(join(dataDir, 'storage.json'), JSON.stringify({ appCacheBytes: Math.round(storageLimitMb() * MB * SHARES.appCache) }));
	} catch {}
}

type Kept = { size: number; at: number; drop: () => void };

/** Newest first while they fit in `budget`; the rest goes. How many went. */
function trim(items: Kept[], budget: number): number {
	let dropped = 0;
	for (const one of [...items].sort((a, b) => b.at - a.at)) {
		budget -= one.size;
		if (budget >= 0) continue;
		try {
			one.drop();
			dropped++;
		} catch {}
	}
	return dropped;
}

/** Each kind kept within its own share of the limit, oldest first. */
export function keepWithinLimit(): void {
	try {
		const limit = storageLimitMb() * MB;
		const dir = previewsDir();
		const pictures: Kept[] = existsSync(dir)
			? readdirSync(dir).flatMap((name) => {
					const file = join(dir, name);
					try {
						const info = statSync(file);
						return [{ size: info.size, at: info.mtimeMs, drop: () => unlinkSync(file) }];
					} catch {
						return [];
					}
				})
			: [];
		const subtitles: Kept[] = (
			db.prepare('SELECT url, length(content) AS size, saved_at AS at FROM saved_subtitles').all() as { url: string; size: number; at: string }[]
		).map((s) => ({
			size: s.size,
			at: Date.parse(`${s.at.replace(' ', 'T')}Z`) || 0,
			drop: () => db.prepare('DELETE FROM saved_subtitles WHERE url = ?').run(s.url)
		}));
		const lookups: Kept[] = (
			db
				.prepare(`SELECT key, length(value) AS size, saved_at AS at FROM watch_order_cache WHERE key NOT IN (${NOT_LOOKUPS.map(() => '?').join(',')})`)
				.all(...NOT_LOOKUPS) as { key: string; size: number; at: number }[]
		).map((l) => ({ size: l.size, at: Number(l.at) || 0, drop: () => db.prepare('DELETE FROM watch_order_cache WHERE key = ?').run(l.key) }));

		trim(pictures, limit * SHARES.previews);
		const dropped = trim(subtitles, limit * SHARES.subtitles) + trim(lookups, limit * SHARES.lookups);
		if (dropped) {
			db.exec('PRAGMA incremental_vacuum');
			db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		}
	} catch (e) {
		console.error('[storage]', e);
	}
}

/** Everything that can be had again, gone now (Settings → Storage → Clear). */
export function clearKept(): void {
	const dir = previewsDir();
	if (existsSync(dir)) for (const name of readdirSync(dir)) {
		try {
			unlinkSync(join(dir, name));
		} catch {}
	}
	db.exec('DELETE FROM saved_subtitles');
	db.prepare(`DELETE FROM watch_order_cache WHERE key NOT IN (${NOT_LOOKUPS.map(() => '?').join(',')})`).run(...NOT_LOOKUPS);
	db.exec('PRAGMA incremental_vacuum');
	db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
	if (typeof process.send === 'function') process.send({ type: 'clear-app-cache' });
}
