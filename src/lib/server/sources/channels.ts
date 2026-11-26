/**
 * Trusted channels: a few YouTube channels that keep whole old shows no streaming site has, one
 * playlist per show (Lucky Luke, The Tick, Samurai Pizza Cats, ...). Owner, 2026-11-20: Lucky Luke
 * was only on YouTube.
 *
 * - Listing: each channel's playlists page and each playlist are read with plain requests (kept a
 *   day). A playlist is the show whose name has the same words ("Lucky Luke - The New Adventures"
 *   is "The New Adventures of Lucky Luke"), and the same year when the playlist says one. A video's
 *   "Ep. 02" (or "S1E2", "Episode 2") says which episode; plain numbers count on through TMDB's
 *   seasons.
 * - Playing: in Catalog's own player, through the desktop app's hidden YouTube window, the same way
 *   the Roku gets YouTube (src/lib/server/youtube.ts, electron/youtubeHelper.cjs): it plays the video
 *   unseen and keeps its pieces, which become an HLS stream here. Desktop app only.
 * - Captions: Catalog's usual subtitle search, by the episode, as for any other copy.
 *
 * The copies are named after the channel's collection, never YouTube.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { officialFile, publisherMatches } from './official';
import { cachedListing, videoListing } from './videoListing';
import type { FileOption } from '../showbox';
import type { TmdbShow } from '../combinedEpisodes';
import { tmdbGet } from '../metadata/tmdb';
import { inDesktopApp, isVideoId, keptSeconds, readIndex, startCapture } from '../youtube';

/** The channels, by their handle. `name` is what the copy is called in the player. */
export const CHANNELS = [{ handle: '@VintageCartooninHD-nn1vk', name: 'Vintage Cartoons' }];

// The channel uses alternate titles, or a title shared with another adaptation.
const playlistSeries: Record<string, number> = {
	PLQGZSV9PRCFkFnmkiTPguA9kt_eZXLdae: 14540, // The Tick (1994)
	PLQGZSV9PRCFn1jPcfgyjYPHyBpyoVj_aj: 3320, // Biker Mice from Mars (1993)
	PLQGZSV9PRCFm3ZKaRi4alHfnon_llEckb: 75216, // Mort & Phil
	'PLQGZSV9PRCFlf0JbMmfzQX-umMoU6cLIV': 9987, // WildC.A.T.S: Covert Action Teams
	PLQGZSV9PRCFm_oc7ScPfmRwiijNG9u_Z9: 62318 // The New Adventures of Lucky Luke (2001)
};

const DAY = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WEB = { clientName: 'WEB', clientVersion: '2.20251101.00.00', hl: 'en', gl: 'US' };

type Playlist = { id: string; title: string };
type Video = { id: string; title: string };

function kept<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

/** Every `key` object anywhere inside `o`. */
function walk(o: unknown, key: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
	if (!o || typeof o !== 'object') return out;
	const rec = o as Record<string, unknown>;
	if (rec[key] && typeof rec[key] === 'object') out.push(rec[key] as Record<string, unknown>);
	for (const k in rec) walk(rec[k], key, out);
	return out;
}

/** The page's own data (ytInitialData), from its HTML. */
async function pageData(url: string): Promise<unknown | null> {
	const resp = await fetch(url, {
		headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
		signal: AbortSignal.timeout(15_000)
	});
	if (!resp.ok) return null;
	const html = await resp.text();
	const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
	try {
		return m ? JSON.parse(m[1]) : null;
	} catch {
		return null;
	}
}

/** The next page of a list (a continuation token from the page before). */
async function more(token: string): Promise<unknown | null> {
	const resp = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
		body: JSON.stringify({ context: { client: WEB }, continuation: token }),
		signal: AbortSignal.timeout(15_000)
	}).catch(() => null);
	return resp?.ok ? resp.json().catch(() => null) : null;
}
const nextToken = (data: unknown): string => String(walk(data, 'continuationCommand')[0]?.token ?? '');

/** The items of a list page (playlists on a channel's page, videos in a playlist), with its following pages. */
async function lockups(first: unknown): Promise<{ id: string; title: string; kind: string }[]> {
	const out: { id: string; title: string; kind: string }[] = [];
	let data = first;
	for (let page = 0; data && page < 10; page++) {
		for (const l of walk(data, 'lockupViewModel')) {
			const meta = l.metadata as { lockupMetadataViewModel?: { title?: { content?: string } } } | undefined;
			const id = String(l.contentId ?? '');
			const title = meta?.lockupMetadataViewModel?.title?.content ?? '';
			if (id && title) out.push({ id, title, kind: String(l.contentType ?? '') });
		}
		const token = nextToken(data);
		data = token ? await more(token) : null;
	}
	return out;
}

/** A channel's playlists, kept a day. */
async function playlistsOf(handle: string): Promise<Playlist[]> {
	const key = `channel-playlists|${handle}`;
	const known = kept<Playlist[]>(key, DAY);
	if (known) return known;
	const data = await pageData(`https://www.youtube.com/${handle}/playlists`);
	if (!data) return [];
	const lists = (await lockups(data)).filter((l) => /PLAYLIST/.test(l.kind) || l.id.startsWith('PL'));
	const playlists = [...new Map(lists.map((l) => [l.id, { id: l.id, title: l.title }])).values()];
	if (playlists.length) saveOrderCache(key, playlists, Date.now());
	return playlists;
}

/** A playlist's videos, in order, kept a day. */
async function videosOf(playlist: string): Promise<Video[]> {
	const key = `channel-videos|${playlist}`;
	const known = kept<Video[]>(key, DAY);
	if (known) return known;
	const data = await pageData(`https://www.youtube.com/playlist?list=${playlist}`);
	if (!data) return [];
	const videos = (await lockups(data)).filter((l) => isVideoId(l.id) && !/PLAYLIST/.test(l.kind)).map((l) => ({ id: l.id, title: l.title }));
	if (videos.length) saveOrderCache(key, videos, Date.now());
	return videos;
}

/* ------------------------------------------------------------------ matching */

const SMALL = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'de', 'la', 'le', 'les']);
/** A name's words, small ones and brackets ([HD 1080p], (1984)) left out, in order. */
const wordsOf = (name: string) =>
	name
		.toLowerCase()
		.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
		.replace(/&/g, ' and ')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !SMALL.has(w))
		.sort()
		.join(' ');

/** The year in a playlist's name ("Lucky Luke (1984)"), if any. */
const yearOf = (title: string) => Number(title.match(/\((\d{4})\)/)?.[1] ?? 0);

/** The year a show started, by TMDB's first season. */
const startYear = (show: TmdbShow) =>
	Math.min(...show.seasons.filter((s) => s.number > 0 && s.airDate).map((s) => Number(s.airDate!.slice(0, 4))), Infinity);

/** Which episode a video is, by its title: [season, episode] or [0, overall number]. */
export function episodeOf(title: string): [number, number] | null {
	const se = title.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
	if (se) return [+se[1], +se[2]];
	const ep = title.match(/(?:\bEp(?:isode)?\.?|\bE|#)\s*(\d{1,3})\b/i);
	if (ep) return [0, +ep[1]];
	return null;
}

/** The episode's own name in a video's title: "[HD] Lucky Luke (1984) - Ep. 02: Daltons In The Blizzard [1080p]" → "Daltons In The Blizzard". */
export function nameIn(title: string): string {
	const plain = title.replace(/\[[^\]]*\]/g, ' ');
	const after = plain.split(/(?:\bEp(?:isode)?\.?|\bS\d{1,2}\s*E|#)\s*\d{1,3}\s*[:\-–—]\s*/i)[1] ?? '';
	return after.replace(/\s+/g, ' ').trim();
}

/** A name squashed for comparing: "The Stage Coach" and "The Stagecoach" both "stagecoach". */
const squash = (name: string) =>
	name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !SMALL.has(w))
		.join('')
		.replace(/s/g, '');
/** The same word spelled a little differently: "elixir"/"elixer", "redemption"/"redeem". */
function alike(a: string, b: string): boolean {
	if (a === b) return true;
	if (a.length < 5 || b.length < 5) return false;
	if (a.slice(0, 5) === b.slice(0, 5)) return true;
	if (Math.abs(a.length - b.length) > 1) return false;
	// One letter changed, added or left out.
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}
const wordSet = (name: string) => new Set(wordsOf(name).split(' ').map((w) => w.replace(/s$/, '')).filter(Boolean));

/**
 * The TMDB episode with this name, by its words: the same once squashed, or else the only one
 * sharing at least two thirds of its words. Lucky Luke's channel numbers the episodes in another
 * order than TMDB ("Ep. 02" is TMDB's 9th), so the name decides, never the number.
 */
function byName(name: string, episodes: { season: number; episode: number; name: string }[]): [number, number] | null {
	if (!name) return null;
	const want = squash(name);
	const same = episodes.filter((e) => squash(e.name) === want);
	if (same.length === 1) return [same[0].season, same[0].episode];
	const words = wordSet(name);
	const scored = episodes
		.map((e) => {
			const theirs = [...wordSet(e.name)];
			const shared = [...words].filter((w) => theirs.some((t) => alike(w, t))).length;
			return { e, score: shared / Math.max(words.size, theirs.length, 1) };
		})
		.filter((s) => s.score >= 0.66)
		.sort((a, b) => b.score - a.score);
	if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return [scored[0].e.season, scored[0].e.episode];
	return null;
}

/** TMDB's episode names for the show, every season. */
async function tmdbNames(show: TmdbShow): Promise<{ season: number; episode: number; name: string }[]> {
	const key = `channel-tmdb-names|${show.id}`;
	const known = kept<{ season: number; episode: number; name: string }[]>(key, 7 * DAY);
	if (known) return known;
	const out: { season: number; episode: number; name: string }[] = [];
	for (const s of show.seasons.filter((s) => s.number > 0 && s.count > 0)) {
		const data = await tmdbGet<{ episodes?: { episode_number: number; name?: string }[] }>(`/tv/${show.id}/season/${s.number}`);
		for (const e of data?.episodes ?? []) if (e.name) out.push({ season: s.number, episode: e.episode_number, name: e.name });
	}
	if (out.length) saveOrderCache(key, out, Date.now());
	return out;
}

/** An overall number placed on TMDB's seasons (season 1's count, then season 2's, ...). */
function onSeasons(show: TmdbShow, overall: number): [number, number] | null {
	let n = overall;
	for (const s of [...show.seasons].filter((s) => s.number > 0 && s.count > 0).sort((a, b) => a.number - b.number)) {
		if (n <= s.count) return [s.number, n];
		n -= s.count;
	}
	return null;
}

/** A trusted channel's copy of an episode (fid -70 onwards, one per channel). */
const channelShareKey = (video: string) => `channel:${video}`;
export function parseChannelShareKey(shareKey: string): string | null {
	const m = shareKey.match(/^channel:([\w-]{6,20})$/);
	return m ? m[1] : null;
}

/**
 * Videos whose names TMDB spells another way, placed by hand ([season, episode]), checked against
 * TMDB's episode descriptions (2026-11-20). These win over the name matching.
 */
const PLACED: Record<string, [number, number]> = {
	// Lucky Luke (1984), Vintage Cartoons
	'0OorWst09No': [1, 24], // "Dalton's Redemption" = The Daltons Redeem Themselves (the rehabilitation program)
	'8bX89KVb838': [1, 18], // "Steaming Up The Mississippi" = The Bridge on the Mississippi (the riverboat race)
	S2UTJ2unVJY: [1, 7], // "Tracks Across The Prairie" = Rails on the Prairie
	K1s0XfxlACM: [1, 5], // "The Dalton's Hoard" = The Daltons' Treasure
	lGHoKRI4y3I: [1, 20] // "The White Horseman" = The Dashing White Cowboy (Le Cavalier blanc)
};

/* ------------------------------------------------------------------ links added by hand */

/*
 * A video link added to an episode in the player's Files menu ("Add a video link"), for a show no
 * collection covers or an episode it's missing. Kept in the library by TMDB show, for every profile.
 */
export type HandLink = { season: number; episode: number; video: string };
const handKey = (showId: number) => `channel-links|${showId}`;
export const HAND_FID = -79;
export const HAND_NAME = 'Your link';

export function handLinks(showId: number): HandLink[] {
	const kept = getOrderCache(handKey(showId))?.value;
	return Array.isArray(kept) ? (kept as HandLink[]) : [];
}

/** A YouTube address (watch, youtu.be, shorts, embed, or the bare id) as its video id. */
export function videoIdOf(link: string): string | null {
	const text = link.trim();
	if (isVideoId(text) && !/[./]/.test(text)) return text;
	try {
		const url = new URL(/^https?:/i.test(text) ? text : `https://${text}`);
		if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(url.hostname)) return null;
		const id = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1) : (url.searchParams.get('v') ?? url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]+)/)?.[1] ?? '');
		return isVideoId(id) ? id : null;
	} catch {
		return null;
	}
}

/** Adds (or, with `video` null, takes away) the link for one episode. */
export function setHandLink(showId: number, season: number, episode: number, video: string | null): void {
	const list = handLinks(showId).filter((l) => !(l.season === season && l.episode === episode));
	if (video) list.push({ season, episode, video });
	saveOrderCache(handKey(showId), list, Date.now());
	saveOrderCache('channel-links-changed', Date.now(), Date.now());
}

/** When a link was last added or taken away (a show's kept episode list is made again after it). */
export const handLinksChanged = () => Number(getOrderCache('channel-links-changed')?.value ?? 0);

/** The copy for a link added by hand. */
export const handCopy = (video: string): FileOption => ({ fid: HAND_FID, quality: 'HD', name: HAND_NAME, size: '', source: HAND_NAME, shareKey: channelShareKey(video) });

/**
 * The show's episodes on the trusted channels, by "season-episode", and links added by hand (first).
 * Curated playlist lookups wait up to `wait` ms. Only the desktop host can start native playback.
 */
export async function channelFiles(show: TmdbShow, wait: number): Promise<Map<string, FileOption[]>> {
	const out = new Map<string, FileOption[]>();
	const matched = await publisherMatches(show.name, startYear(show), 'tv', `tv:${show.id}`);
	// Check the chosen video at playback, not a whole show's uploads while listing its episodes.
	for (const w of matched) {
		if (cachedListing(w.videoId) === 'unavailable') continue;
		const key = w.season + '-' + w.episode;
		out.set(key, [...(out.get(key) ?? []), officialFile(w)]);
	}
	for (const l of handLinks(show.id).filter(l => cachedListing(l.video) !== 'unavailable')) out.set(`${l.season}-${l.episode}`, [handCopy(l.video), ...(out.get(`${l.season}-${l.episode}`) ?? [])]);
	const work = (async () => {
		const name = wordsOf(show.name);
		const year = startYear(show);
		for (const [i, channel] of CHANNELS.entries()) {
			const playlists = await playlistsOf(channel.handle).catch(() => [] as Playlist[]);
			for (const list of playlists) {
				const pinned = playlistSeries[list.id];
				if (pinned ? show.id !== pinned : wordsOf(list.title) !== name) continue;
				const listYear = yearOf(list.title);
				if (listYear && listYear !== year) continue;
				const names = await tmdbNames(show).catch(() => []);
				for (const video of await videosOf(list.id).catch(() => [] as Video[])) {
					// By the episode's name when the title has one (a name TMDB hasn't got leaves the
					// video out); by its number only when it has none.
					if (cachedListing(video.id) === 'unavailable') continue;
					const name = nameIn(video.title);
					const at = episodeOf(video.title);
					const placed = PLACED[video.id] ?? (name ? byName(name, names) : at && (at[0] ? at : onSeasons(show, at[1])));
					if (!placed) continue;
					const key = `${placed[0]}-${placed[1]}`;
					if (out.get(key)?.some((f) => f.shareKey === channelShareKey(video.id) || f.source === channel.name)) continue;
					const quality = /4K|2160p/i.test(list.title + video.title) ? '2160p' : /1080p/i.test(list.title + video.title) ? '1080p' : 'HD';
					out.set(key, [...(out.get(key) ?? []), { fid: -70 - i, quality, name: channel.name, size: '', source: channel.name, shareKey: channelShareKey(video.id) }]);
				}
			}
		}
	})().catch((e) => console.warn('[channels]', e));
	await Promise.race([work, new Promise((r) => setTimeout(r, wait))]);
	return out;
}

/**
 * The stream for a channel copy: the hidden YouTube window starts keeping it, and the address is
 * given once both tracks have a continuous start; the capture continues as playback begins.
 */
export async function channelStream(shareKey: string): Promise<{ url: string; why: string }> {
	const id = parseChannelShareKey(shareKey);
	if (!id) return { url: '', why: 'Not a channel copy' };
	if (!inDesktopApp()) return { url: '', why: 'Plays only with Catalog open on the computer' };
	const listing = await videoListing(id, true);
	if (listing !== 'listed') return { url: '', why: listing === 'unavailable' ? 'This YouTube video is no longer public' : 'YouTube availability could not be confirmed' };
	startCapture(id, 0);
	const until = Date.now() + 45_000;
	while (Date.now() < until) {
		const index = readIndex(id);
		if (index?.error) return { url: '', why: index.error };
		if (index?.video && index.audio) {
			const seconds = keptSeconds(index);
			if (seconds >= 4 || (index.done && seconds > 0)) return { url: `/api/youtube/hls/${id}/main.m3u8`, why: '' };
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return { url: '', why: "The video didn't start in time" };
}
