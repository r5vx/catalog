/**
 * Which friends have watched a title, going by the library files they shared (the library's
 * Friends → a file from a friend; `shared_catalogs`). The same question the meeting point
 * answers for friends online (src/lib/server/online.ts), asked of the files kept on this computer.
 */
import { isWatched } from '$lib/constants';
import { getOrderCache, getSharedCatalog, listSharedCatalogs, saveOrderCache } from './db/queries';
import { cloud } from './online';
import { currentProfile } from './profile';

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

/**
 * Which of these files are a friend online under another name: a file someone sent before they
 * joined (a friend's "Merk" file next to the same person online as "Alex", so "Alex and Merk
 * watched this" and a Merk with no ratings on every title). Same person = most of the titles in
 * their online library (a sample of up to 240) are watched in the file. Kept a week.
 */
export async function filesThatAreOnline(fileIds: string[], onlineIds: string[]): Promise<Set<string>> {
	const twins = new Set<string>();
	if (!fileIds.length || !onlineIds.length) return twins;
	const catalogs = new Map(listSharedCatalogs().map((c) => [`file-${c.id}`, c]));
	for (const fileId of fileIds) {
		const catalog = catalogs.get(fileId);
		if (!catalog) continue;
		for (const person of onlineIds) {
			if (!/^[A-Z0-9]{16}$/.test(person)) continue;
			const cacheKey = `file-twin|${catalog.id}|${catalog.importedAt}|${person}`;
			const before = getOrderCache(cacheKey);
			let same = before && Date.now() - before.at < WEEK ? Boolean(before.value) : null;
			if (same === null) {
				same = await looksLikeFile(catalog.id, catalog.importedAt, catalog.name, person);
				if (same !== null) saveOrderCache(cacheKey, same, Date.now());
			}
			if (same) {
				twins.add(fileId);
				break;
			}
		}
	}
	return twins;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** null: their library couldn't be asked (not kept, so it's asked again). */
async function looksLikeFile(id: number, importedAt: string, name: string, person: string): Promise<boolean | null> {
	const file = kept(id, importedAt, name);
	if (!file || file.byKey.size < 10) return false;
	const keys: string[] = [];
	for (const offset of [0, 120]) {
		const answer = await cloud<{ items?: { key: string }[]; total?: number }>(`/v1/people/${person}/library?sort=title&offset=${offset}`, { profile: currentProfile() });
		if (!answer.ok) return answer.status === 403 ? false : null;
		const items = answer.data?.items ?? [];
		keys.push(...items.map((item) => item.key));
		if (items.length < 120) break;
	}
	if (keys.length < 10) return false;
	const inFile = keys.filter((key) => file.byKey.has(key)).length;
	return inFile / keys.length >= 0.6;
}
