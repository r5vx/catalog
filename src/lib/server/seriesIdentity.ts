import { isRemake, type SeriesHit } from '../release';
import { getOrderCache, saveOrderCache } from './db/queries';
import { tmdbGet } from './metadata/tmdb';

type Hit = SeriesHit & { title?: string; original_title?: string; release_date?: string };
const pending = new Map<string, Promise<boolean>>();
export async function ambiguousRelease(title: string, type: string, year: string) {
	if (!['movie', 'tv'].includes(type) || !year) return false;
	const key = `same-name|${type}|${title.trim().toLowerCase()}`;
	const hit = getOrderCache(key);
	if (hit?.value === true || (hit && Date.now() - hit.at < 7 * 86400_000)) return hit.value === true;
	const under = pending.get(key);
	if (under) return under;
	const work = tmdbGet<{ results: Hit[] }>(`/search/${type}`, { query: title }).then(found => {
		if (!found) return true; // Don't choose an undated match when the check is offline.
		const several = isRemake(found.results.map(h => type === 'movie' ? {
			id: h.id, name: h.title, original_name: h.original_title, first_air_date: h.release_date
		} : h), title);
		saveOrderCache(key, several, Date.now());
		return several;
	}).finally(() => pending.delete(key));
	pending.set(key, work);
	return work;
}
