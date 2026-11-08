/**
 * Vidfast (vidfast.vc): films and TV by TMDB id, season and episode, like 7Movies and Movy.
 * Found in Streambert (2026-11-04): 1080p, its playlist in about 3 s, on films and episodes.
 *
 * Like Movy, its link only comes to its own page, so the desktop app opens that page out of
 * sight and notes the playlist its player asks for (electron/main.cjs, `findOnVidfastNow`, in
 * the same queue as Movy's: two lookups at once). A link found is kept 30 minutes, a "no" 6
 * hours. Its video servers (goldenkite.top, ultramoss.top, olivewave.top on 2026-11-04) want
 * vidfast.vc as Referer and Origin, so the video comes through Catalog's relay.
 * Only in the desktop app: elsewhere (npm run dev) Vidfast never has anything.
 */
import type { FileOption } from '../showbox';
import { electronMovyFind } from '../electron-fetch';
import { trustVideoHost } from '../relayHosts';

const SITE = 'https://vidfast.vc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MINUTE = 60 * 1000;

/** What Vidfast's video servers expect to be asked with. */
export const VIDFAST_HEADERS = { 'User-Agent': UA, Referer: `${SITE}/`, Origin: SITE };

type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };

/** A Vidfast copy's share key: `vidfast:<tv|movie>:<TMDB id>:<season>:<episode>`. */
export function vidfastShareKey(what: What): string {
	return `vidfast:${what.type}:${what.id}:${what.season}:${what.episode}`;
}

export function parseVidfastShareKey(shareKey: string): What | null {
	const m = shareKey.match(/^vidfast:(tv|movie):(\d+):(\d+):(\d+)$/);
	if (!m) return null;
	return { type: m[1] as 'tv' | 'movie', id: Number(m[2]), season: Number(m[3]), episode: Number(m[4]) };
}

/** Vidfast's copy of a film or episode (fid -8), listed after Movy's. */
export function vidfastCopy(what: What): FileOption {
	return { fid: -8, quality: 'HD', name: 'Vidfast', size: '', source: 'Vidfast', shareKey: vidfastShareKey(what) };
}

const pageFor = (what: What) =>
	what.type === 'tv' ? `${SITE}/tv/${what.id}/${what.season}/${what.episode}?autoPlay=true` : `${SITE}/movie/${what.id}?autoPlay=true`;

const known = new Map<string, { at: number; url: string | null }>();
const asking = new Map<string, Promise<string | null>>();

/** The video playlist for a Vidfast copy, or null when it hasn't got it (or didn't answer in time). */
export function vidfastStream(shareKey: string, fresh = false): Promise<string | null> {
	const what = parseVidfastShareKey(shareKey);
	if (!what) return Promise.resolve(null);
	const kept = known.get(shareKey);
	if (kept && !fresh) {
		const age = Date.now() - kept.at;
		if (kept.url ? age < 30 * MINUTE : age < 6 * 60 * MINUTE) return Promise.resolve(kept.url);
	}
	const under = asking.get(shareKey);
	if (under) return under;
	const result = electronMovyFind(pageFor(what), undefined, 'vidfast')
		.then(({ url, error }) => {
			if (url) {
				trustVideoHost(url, 'vidfast');
				known.set(shareKey, { at: Date.now(), url });
				return url;
			}
			// Nothing came: kept 6 hours. Too slow: asked again after 10 minutes. Otherwise not kept.
			if (error === 'timeout') known.set(shareKey, { at: Date.now() - 6 * 60 * MINUTE + 10 * MINUTE, url: null });
			return null;
		})
		.finally(() => asking.delete(shareKey));
	asking.set(shareKey, result);
	return result;
}
