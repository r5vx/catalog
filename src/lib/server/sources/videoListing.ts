import { getOrderCache, saveOrderCache } from '../db/queries';

export type Listing = 'listed' | 'unavailable' | 'unknown';
const pending = new Map<string, Promise<Listing>>();
// (A removed or private video stays that way: asked again after a day, not every hour.)
const ttl = { listed: 15 * 60_000, unavailable: 24 * 60 * 60_000, unknown: 60_000 };
const key = (id: string) => `yt-listing-v1|${id}`;
export function cachedListing(id: string): Listing | null {
	const row = getOrderCache(key(id));
	const state = row?.value as Listing;
	return row && Object.hasOwn(ttl, state) && Date.now() - row.at < ttl[state] ? state : null;
}

/** oEmbed confirms public metadata, not regional playback rights or a decodable stream. */
export async function videoListing(id: string, fresh = false): Promise<Listing> {
	if (!/^[\w-]{11}$/.test(id)) return 'unavailable';
	const cached = cachedListing(id);
	if (cached && (!fresh || cached !== 'listed')) return cached;
	const running = pending.get(id);
	if (running) return running;
	const job = (async (): Promise<Listing> => {
		let state: Listing = 'unknown';
		try {
			const query = new URLSearchParams({ format: 'json', url: `https://www.youtube.com/watch?v=${id}` });
			const response = await fetch(`https://www.youtube.com/oembed?${query}`, { signal: AbortSignal.timeout(4500) });
			if ([401, 404, 410].includes(response.status)) state = 'unavailable';
			else if (response.ok) {
				const data = await response.json();
				if (data?.type === 'video' && data.title && data.author_name) state = 'listed';
			}
		} catch { /* Offline or throttled is not a takedown. */ }
		saveOrderCache(key(id), state, Date.now());
		return state;
	})().finally(() => pending.delete(id));
	pending.set(id, job);
	return job;
}
