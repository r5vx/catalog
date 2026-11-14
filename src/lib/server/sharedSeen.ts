/**
 * Which friends have watched a title, going by the library files they shared (the library's
 * Friends → a file from a friend; `shared_catalogs`). The same question the meeting point
 * answers for friends online (src/lib/server/online.ts), asked of the files kept on this computer.
 */
import { isWatched } from '$lib/constants';
import { getSharedCatalog, listSharedCatalogs } from './db/queries';

type SharedTitle = { title?: string; year?: number | null; status?: string; source?: string; sourceId?: string; rating?: number | null };
type Kept = { name: string; byKey: Map<string, number | null>; byName: Map<string, { year: number | null; rating: number | null; key: string }[]> };

/** Each file read once: by its id and when it was put in (a file put in again gets a new id). */
const read = new Map<string, Kept>();

const plain = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function kept(id: number, importedAt: string, name: string): Kept | null {
	const at = `${id}|${importedAt}`;
	const before = read.get(at);
	// (A friend renamed since still answers by their new name.)
	if (before) return { ...before, name };
	const catalog = getSharedCatalog(id);
	if (!catalog) return null;
	let titles: SharedTitle[] = [];
	try {
		titles = JSON.parse(catalog.data);
	} catch {}
	const one: Kept = { name, byKey: new Map(), byName: new Map() };
	for (const title of Array.isArray(titles) ? titles : []) {
		if (!title?.title || !isWatched(title.status)) continue;
		const rating = typeof title.rating === 'number' ? title.rating : null;
		const key = title.source && title.sourceId ? `${title.source}:${title.sourceId}` : '';
		if (key) one.byKey.set(key, rating);
		const name = plain(title.title);
		one.byName.set(name, [...(one.byName.get(name) ?? []), { year: title.year ?? null, rating, key }]);
	}
	if (read.size > 40) read.clear();
	read.set(at, one);
	return one;
}

/**
 * The friends whose shared file has this title as watched. Matched by the title's own number
 * where the file carries it; else by name (an older file, or the same show from the other site),
 * and then the years must agree when both are known.
 */
export function sharedFriendsWhoWatched(source: string, sourceId: string, title: string, year: number | null): { id: string; name: string; avatar: number; rating: number | null }[] {
	const key = `${source}:${sourceId}`;
	const name = plain(title);
	const found: { id: string; name: string; avatar: number; rating: number | null }[] = [];
	for (const catalog of listSharedCatalogs()) {
		const one = kept(catalog.id, catalog.importedAt, catalog.name);
		if (!one) continue;
		let rating: number | null | undefined = one.byKey.get(key);
		if (rating === undefined && name) {
			const same = (one.byName.get(name) ?? []).find(
				// Not another title from the same site under the same name (a remake).
				(t) => (!t.key || !t.key.startsWith(`${source}:`)) && (year === null || t.year === null || Math.abs(t.year - year) <= 1)
			);
			if (same) rating = same.rating;
		}
		if (rating !== undefined) found.push({ id: `file-${catalog.id}`, name: one.name, avatar: 0, rating });
	}
	return found;
}
