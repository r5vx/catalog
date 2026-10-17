/**
 * Every title's other names, so the library search finds "Dungeon Meshi" as well as
 * "Delicious in Dungeon", and a film by its original title. From TMDB: the original name
 * (ダンジョン飯) and the alternative titles from Japan (the romaji, "Dungeon Meshi") and the
 * English-speaking countries. Kept in `entries.other_titles`, one per line; '' means TMDB was
 * asked and had none, NULL that nobody has asked yet.
 *
 * Fills in by itself a little after start-up (a few hundred quick lookups, once), and for each
 * title as it's added.
 */
import { db } from './db';
import { tmdbGet } from './metadata/tmdb';

type AltTitle = { iso_3166_1: string; title: string };
type Details = {
	original_name?: string;
	original_title?: string;
	alternative_titles?: { results?: AltTitle[]; titles?: AltTitle[] };
};

const COUNTRIES = new Set(['JP', 'US', 'GB', 'CA', 'AU']);

/** A TMDB title's other names, or null when TMDB couldn't be asked. */
async function otherNamesFor(sourceId: string, title: string): Promise<string[] | null> {
	const [kind, id] = sourceId.split(':');
	if ((kind !== 'tv' && kind !== 'movie') || !id) return null;
	const details = await tmdbGet<Details>(`/${kind}/${id}`, { append_to_response: 'alternative_titles' });
	if (!details) return null;
	const alternatives = details.alternative_titles?.results ?? details.alternative_titles?.titles ?? [];
	const names = [
		details.original_name ?? details.original_title ?? '',
		...alternatives.filter((a) => COUNTRIES.has(a.iso_3166_1)).map((a) => a.title)
	];
	const seen = new Set([title.toLowerCase()]);
	return names
		.map((n) => n.trim())
		.filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/** Looks one entry up and keeps what it found (nothing kept if TMDB couldn't be asked). */
export async function fillOtherNames(entryId: number): Promise<void> {
	const entry = db.prepare("SELECT title, source_id FROM entries WHERE id = ? AND source = 'tmdb'").get(entryId) as
		| { title: string; source_id: string | null }
		| undefined;
	if (!entry?.source_id) return;
	const names = await otherNamesFor(entry.source_id, entry.title);
	if (names) db.prepare('UPDATE entries SET other_titles = ? WHERE id = ?').run(names.join('\n'), entryId);
}

let running = false;

/** Every entry nobody has asked about yet, gently (a lookup every 150 ms). */
export async function fillAllOtherNames(): Promise<void> {
	if (running) return;
	running = true;
	try {
		const ids = (
			db.prepare("SELECT id FROM entries WHERE source = 'tmdb' AND source_id IS NOT NULL AND other_titles IS NULL ORDER BY id").all() as { id: number }[]
		).map((r) => r.id);
		for (const id of ids) {
			await fillOtherNames(id);
			await new Promise((r) => setTimeout(r, 150));
		}
	} finally {
		running = false;
	}
}
