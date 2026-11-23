/**
 * Nyaa (nyaa.si): anime fans' torrents, which have what no streaming site does: old shows (all 50
 * episodes of Jungle King Tar-chan), BD copies, every fansub group's release.
 *
 * Only with a debrid service (Settings → Services, sources/debrid.ts), and off until turned on
 * there: the debrid service gets the torrent on its own servers and Catalog plays its plain link,
 * so this computer never joins a torrent (owner, 2026-11-20: no torrenting from home without a
 * VPN). Then every anime episode and anime film gets a "Nyaa" copy, listed without asking (like
 * 7Movies'), found when it's played:
 *   1. Nyaa's search (its RSS feed: seeders, size, trusted) for the show's names, English-subtitled
 *      releases only, most seeders first;
 *   2. releases of that episode, and batches whose range has it, ranked: the quality wanted, no
 *      10-bit H.264 or AC3/DTS-only sound (they don't play here), trusted, seeders;
 *   3. the .torrent's file list says which file is the episode (a batch's "… - 07 [AVC].mkv");
 *   4. the debrid service is asked for that file (`getOnDebrid`): ready at once when someone has
 *      asked it before, else its servers get it from the torrent's sharers and it's asked again
 *      later (the player says how far along it is). An MKV's tracks are read from the link's
 *      start, and one that can't play here is passed over for the next release (at most 3).
 * The player plays the debrid link. The file's own subtitles come through `nyaaFileSubtitles`
 * (read out of the MKV through the link: linkFile.ts, mkv.ts).
 *
 * (torrents.ts, which opened torrents on this computer, is kept for a VPN later but unused.)
 *
 * Share key: `nyaa:<tv|movie>:<tmdb>:<season>:<episode>`. The release picked is kept two days.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { readSettings } from '../settings';
import { tmdbGet } from '../metadata/tmdb';
import type { FileOption } from '../showbox';
import { isPictureTrack, isTextTrack, playable, subtitleFile } from '../mkv';
import { readMkvPictures, toSrt, type Cue } from '../pictureSubs';
import { linkInfo, linkSubtitles } from '../linkFile';
import { debridSetting, getOnDebrid, serviceName, type Release } from './debrid';

type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };

const SITE = 'https://nyaa.si';
const HOUR = 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Settings → Services → Nyaa, which needs a debrid service saved (nothing is torrented from here). */
export const nyaaOn = () => readSettings().nyaa === '1' && debridSetting() !== null;

export const nyaaShareKey = (what: What) => `nyaa:${what.type}:${what.id}:${what.season}:${what.episode}`;

export function parseNyaaShareKey(shareKey: string): What | null {
	const m = shareKey.match(/^nyaa:(tv|movie):(\d+):(\d+):(\d+)$/);
	return m ? { type: m[1] as 'tv' | 'movie', id: +m[2], season: +m[3], episode: +m[4] } : null;
}

/** The copy listed for an anime episode or film (nothing when Nyaa is off). */
export function nyaaCopy(what: What): FileOption[] {
	if (!nyaaOn()) return [];
	return [{ fid: -60, quality: '1080p', name: 'Nyaa', size: '', source: 'Nyaa', shareKey: nyaaShareKey(what) }];
}

/* ------------------------------------------------------------ Nyaa's search */

export type NyaaRelease = { id: number; title: string; seeders: number; bytes: number; trusted: boolean; remake: boolean; hash: string };

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? '';
const unescape = (s: string) =>
	s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function sizeBytes(size: string): number {
	const m = size.match(/([\d.]+)\s*([KMGT])i?B/i);
	return m ? parseFloat(m[1]) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase()) : 0;
}

/** Nyaa's RSS feed as releases. */
export function releasesFrom(xml: string): NyaaRelease[] {
	return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
		id: Number(tag(item, 'guid').match(/view\/(\d+)/)?.[1] ?? 0),
		title: unescape(tag(item, 'title')),
		seeders: Number(tag(item, 'nyaa:seeders')) || 0,
		bytes: sizeBytes(tag(item, 'nyaa:size')),
		trusted: tag(item, 'nyaa:trusted') === 'Yes',
		remake: tag(item, 'nyaa:remake') === 'Yes',
		hash: tag(item, 'nyaa:infoHash').toLowerCase()
	})).filter((r) => r.id && /^[a-f0-9]{40}$/.test(r.hash));
}

/** Anime, English-translated, most seeders first. Kept 3 hours. */
async function search(text: string): Promise<NyaaRelease[]> {
	// Punctuation out: Nyaa reads "-word" as "without this word".
	const query = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	if (!query) return [];
	const key = `nyaa-search|${query.toLowerCase()}`;
	const hit = getOrderCache(key);
	if (hit && Date.now() - hit.at < 3 * HOUR) return hit.value as NyaaRelease[];
	try {
		const resp = await fetch(`${SITE}/?page=rss&c=1_2&f=0&s=seeders&o=desc&q=${encodeURIComponent(query)}`, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(12000)
		});
		if (!resp.ok) return [];
		const found = releasesFrom(await resp.text());
		saveOrderCache(key, found, Date.now());
		return found;
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------ release names */

/** Lowercase letters and digits only, single spaces: "Jungle King Tar-chan" → "jungle king tar chan". */
export const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type ReleaseName = {
	/** One episode, a range of them (a batch), or neither said (a film, or a batch named "Complete"). */
	episode: number | null;
	range: [number, number] | null;
	season: number | null;
	batch: boolean;
	version: number;
};

/**
 * What a release or file name says: "[SubsPlease] Title - 05 (1080p) [C2544FB4].mkv" → episode 5;
 * "[ARR] Jungle King Tar-chan TV 01-50" → 1–50; "Title S02E03" → season 2, episode 3;
 * "Title 2nd Season - 04" → season 2, episode 4; "[Group] Title (BD 1080p) [Batch]" → a batch.
 */
export function readName(name: string): ReleaseName {
	const base = name.replace(/\.(mkv|mp4|avi|webm)$/i, '');
	// Bracketed parts hold the group, quality, codecs and checksum: not the episode.
	const bare = base.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
	const batch = /\b(batch|complete|bd\s*box|collection)\b/i.test(base);
	let season: number | null = null;
	let episode: number | null = null;
	let range: [number, number] | null = null;
	let version = 1;

	const se = bare.match(/\bS(\d{1,2})\s*E(\d{1,4})(?:v(\d))?\b/i);
	if (se) {
		season = +se[1];
		episode = +se[2];
		version = se[3] ? +se[3] : 1;
	}
	if (season === null) {
		const s = bare.match(/\bS(\d{1,2})\b|\bSeason\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i);
		if (s) season = +(s[1] ?? s[2] ?? s[3]);
	}
	if (episode === null) {
		// "(01-12)" in brackets (SubsPlease's batches), or "01-50" / "01 ~ 50" in the name. Not
		// "Title 2 - 11", which is episode 11 of a show with a number in its name.
		const r =
			base.match(/[[(](?:E|EP)?(\d{1,4})\s*[-~]\s*(?:E|EP)?(\d{1,4})(?:\s*END)?[\])]/i) ??
			bare.match(/(?:^|\s)(?:E|EP|Episodes?\s*)?(\d{1,4})(?:-|\s*~\s*)(?:E|EP)?(\d{1,4})(?:\s|$)/i);
		if (r && +r[2] > +r[1] && +r[1] < 1900) range = [+r[1], +r[2]];
	}
	if (episode === null && !range) {
		// "Title - 05", "Title - 05v2", "Title Episode 5", "Title E05", "Title 07" (the number last).
		const e =
			bare.match(/\s-\s(\d{1,4})(?:\s?v(\d))?(?:\s|$)/i) ??
			bare.match(/\b(?:E|EP|Episode)\s*(\d{1,4})(?:\s?v(\d))?\b/i) ??
			bare.match(/\s(\d{1,4})(?:\s?v(\d))?$/i);
		if (e && !(+e[1] >= 1900 && +e[1] <= 2100)) {
			episode = +e[1];
			version = e[2] ? +e[2] : 1;
		}
	}
	const v = base.match(/\bv(\d)\b/i);
	if (v) version = Math.max(version, +v[1]);
	return { episode, range, season, batch: batch || (episode === null && !range), version };
}

/**
 * Japanese names are spelled more than one way in English letters: TMDB's "Jungle King Taa-chan"
 * is "Tar-chan" on Nyaa; "Ouja"/"Oja", "Shippuuden"/"Shippuden". Both sides are folded alike
 * before they're compared: long vowels made short, a word's last "ar" made "a", "wo" as "o".
 */
export const folded = (s: string) =>
	plain(s)
		.split(' ')
		.map((w) => (w === 'wo' ? 'o' : w.replace(/ou|oh(?=[^aeiou]|$)/g, 'o').replace(/([aeiou])\1+/g, '$1').replace(/(?<=\w)ar$/, 'a')))
		.join(' ');

/** Whether a release name is of this show: it holds one of the show's names whole (folded alike). */
const isOf = (name: string, names: string[]) => {
	const p = ` ${folded(name)} `;
	return names.some((n) => n.length >= 3 && p.includes(` ${folded(n)} `));
};

/**
 * The words of a name Nyaa's search can't miss: without those spelled more than one way (long
 * vowels, a last "ar"), when at least two are left. "jungle king taa chan" → "jungle king chan".
 */
const sureWords = (name: string) => {
	const words = name.split(' ');
	const sure = words.filter((w) => folded(w) === w && !/ar$/.test(w));
	return sure.length >= 2 && sure.length < words.length ? sure.join(' ') : '';
};

/** Plays here, by its name: no 10-bit H.264, no sound that's only AC3/DTS. */
function playableName(title: string): boolean {
	const hevc = /\b(x265|h\.?265|hevc)\b/i.test(title);
	const av1 = /\bav1\b/i.test(title);
	if (/\b(10.?bit|hi10p?|yuv420p10)\b/i.test(title) && !hevc && !av1) return false;
	const goodSound = /\b(aac|flac|opus|mp3|vorbis)\b/i.test(title);
	if (/\b(ac3|e-?ac-?3|ddp?\s*\d|dts(-hd)?|truehd)\b/i.test(title) && !goodSound) return false;
	return true;
}

const qualityOf = (title: string) => (/\b(2160p|4k)\b/i.test(title) ? 2160 : /\b1080p?\b/i.test(title) ? 1080 : /\b720p?\b/i.test(title) ? 720 : /\b(480p?|576p?|dvd)\b/i.test(title) ? 480 : 0);

/** How good a release is for us, higher first. */
function score(r: NyaaRelease): number {
	const q = qualityOf(r.title);
	const quality = q === 1080 ? 40 : q === 720 ? 30 : q === 2160 ? 20 : q === 480 ? 10 : 15;
	const dub = /\b(dub|dubbed)\b/i.test(r.title) && !/\bdual\b/i.test(r.title) ? -25 : 0;
	// (Trusted counts for less when hardly anyone shares it: Jungle King's trusted ARR pack had 1
	// sharer, a re-upload of the very same files 3, 2026-11-20.)
	const trusted = r.trusted ? (r.seeders >= 3 ? 10 : 3) : 0;
	return quality + trusted + (r.remake ? -15 : 0) + dub + Math.min(30, Math.log2(1 + r.seeders) * 5);
}

/* ------------------------------------------------------------ the show's names */

type Show = { names: string[]; before: number; anime: boolean };

/**
 * The names a release could use (TMDB's English one, the original and the romaji from Japan's
 * alternative titles) and, for a later season, how many episodes come before it (a release may
 * count from the show's first episode).
 */
async function showOf(what: What): Promise<Show | null> {
	const key = `nyaa-show|${what.type}:${what.id}`;
	const hit = getOrderCache(key);
	if (hit && Date.now() - hit.at < 24 * HOUR) return { ...(hit.value as Show), before: beforeOf(hit.value as Show & { seasons?: [number, number][] }, what.season) };
	type Details = {
		name?: string;
		title?: string;
		original_name?: string;
		original_title?: string;
		seasons?: { season_number: number; episode_count: number }[];
		alternative_titles?: { results?: { iso_3166_1: string; title: string }[]; titles?: { iso_3166_1: string; title: string }[] };
	};
	const details = await tmdbGet<Details>(`/${what.type}/${what.id}`, { append_to_response: 'alternative_titles' });
	if (!details) return null;
	const alts = details.alternative_titles?.results ?? details.alternative_titles?.titles ?? [];
	const all = [
		details.name ?? details.title ?? '',
		...alts.filter((a) => a.iso_3166_1 === 'JP' && /^[\x20-\x7e]+$/.test(a.title)).map((a) => a.title),
		...alts.filter((a) => ['US', 'GB'].includes(a.iso_3166_1)).map((a) => a.title),
		details.original_name ?? details.original_title ?? ''
	];
	const names = [...new Set(all.map(plain).filter((n) => n.length >= 3))].slice(0, 6);
	const seasons = (details.seasons ?? []).map((s) => [s.season_number, s.episode_count] as [number, number]);
	const value = { names, before: 0, anime: true, seasons };
	saveOrderCache(key, value, Date.now());
	return { names, before: beforeOf(value, what.season), anime: true };
}

const beforeOf = (show: { seasons?: [number, number][] }, season: number) =>
	(show.seasons ?? []).filter(([n]) => n > 0 && n < season).reduce((sum, [, count]) => sum + count, 0);

/* ------------------------------------------------------------ finding the file */

type Candidate = { release: NyaaRelease; single: boolean };

/** Releases that hold this episode (or film), best first. */
export function candidatesFor(releases: NyaaRelease[], names: string[], what: What, before: number): Candidate[] {
	const out: Candidate[] = [];
	const absolute = before + what.episode;
	for (const r of releases) {
		if (!r.seeders || !isOf(r.title, names) || !playableName(r.title)) continue;
		const n = readName(r.title);
		if (what.type === 'movie') {
			if (n.episode === null && !n.range) out.push({ release: r, single: true });
			continue;
		}
		const seasonOk = n.season === null ? what.season === 1 || before > 0 : n.season === what.season;
		const has = (ep: number) => n.episode === ep || (n.range !== null && n.range[0] <= ep && ep <= n.range[1]);
		const inSeason = n.season === what.season || (n.season === null && what.season === 1);
		if ((inSeason && has(what.episode)) || (n.season === null && before > 0 && has(absolute))) out.push({ release: r, single: n.episode !== null });
		// A batch that says only which season (or nothing): its file list decides.
		else if (n.episode === null && !n.range && n.batch && seasonOk) out.push({ release: r, single: false });
	}
	// One release of the episode before a batch of the same standing (smaller, so quicker to find peers for).
	return out.sort((a, b) => score(b.release) - score(a.release) || Number(b.single) - Number(a.single));
}

type TorrentFile = { path: string; name: string; length: number };

/** Which file of a torrent is the episode (or the film: its largest video). */
export function fileFor(files: TorrentFile[], what: What, before: number): number {
	const videos = files.map((f, i) => ({ ...f, i })).filter((f) => /\.(mkv|mp4|webm)$/i.test(f.name) && !/\b(ncop|nced|creditless|preview|trailer|pv|cm)\b/i.test(f.name));
	if (!videos.length) return -1;
	if (what.type === 'movie' || videos.length === 1) return videos.sort((a, b) => b.length - a.length)[0].i;
	const absolute = before + what.episode;
	const numbered = videos.map((f) => {
		const n = readName(f.name);
		const folderSeason = f.path.match(/(?:^|[\\/])(?:S|Season\s*)(\d{1,2})(?:[\\/]|\s)/i);
		const season = n.season ?? (folderSeason ? +folderSeason[1] : null);
		return { ...f, episode: n.episode, version: n.version, season };
	});
	const matches = numbered.filter((f) => {
		if (/[\\/](specials?|extras?|bonus|ova)[\\/]/i.test(f.path)) return false;
		if (f.season !== null && f.season !== what.season) return false;
		// A season-less name counts the season's own episodes in a season's own batch, or the
		// show's from its first in one batch of every season.
		return f.episode === what.episode || (before > 0 && f.season === null && f.episode === absolute);
	});
	const absoluteMatches = before > 0 ? matches.filter((f) => f.season === null && f.episode === absolute) : [];
	// The newest version ("v2") of the episode, then the largest.
	return (absoluteMatches.length ? absoluteMatches : matches).sort((a, b) => b.version - a.version || b.length - a.length)[0]?.i ?? -1;
}

/** A release's .torrent (its file list), asked twice: Nyaa turns away the odd ask right after its searches. */
async function torrentFile(id: number): Promise<Buffer | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt) await new Promise((r) => setTimeout(r, 2000));
		try {
			const resp = await fetch(`${SITE}/download/${id}.torrent`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
			if (resp.ok) return Buffer.from(await resp.arrayBuffer());
		} catch {}
	}
	return null;
}

async function filesOf(torrent: Buffer): Promise<TorrentFile[]> {
	const { default: parseTorrent } = await import('parse-torrent');
	const parsed = (await parseTorrent(torrent)) as { files?: TorrentFile[] };
	return parsed.files ?? [];
}

/**
 * The release and file picked for a share key. `url` is the debrid service's link once it has the
 * file ('' while it's still getting it); `at` is when that link was had (asked again after a few
 * hours: links stop working).
 */
export type NyaaPick = { hash: string; file: number; name: string; release: string; url: string; at: number };

/** A release that didn't play (the service couldn't get it, or a file this player can't play): not tried again for a day. */
const badKey = (hash: string, file: number) => `nyaa-bad|${hash}:${file}`;
const pickKey = (shareKey: string) => `nyaa-pick|${shareKey}`;
const LINK_LASTS = 3 * HOUR;

/** At most this many releases are asked of the debrid service per ask (each is added to the account). */
const MOST_TRIES = 3;

/** Each file's link, for its subtitle tracks (`torrent:<hash>:<file>:<track>`). */
const links = new Map<string, string>();

const picking = new Map<string, Promise<{ pick: NyaaPick | null; why: string }>>();

/** The release and file for a share key, from the debrid service (the player's link waits on this). */
export function nyaaPick(shareKey: string, fresh = false): Promise<{ pick: NyaaPick | null; why: string }> {
	let job = picking.get(shareKey);
	if (!job) {
		job = pickNow(shareKey, fresh)
			.then((found) => {
				if (found.pick?.url) links.set(`${found.pick.hash}:${found.pick.file}`, found.pick.url);
				return found;
			})
			.finally(() => picking.delete(shareKey));
		picking.set(shareKey, job);
	}
	return job;
}

/** The pick as the debrid module's Release (the file by its place and its name). */
const releaseOf = (pick: NyaaPick): Release => ({
	hash: pick.hash,
	fileIdx: pick.file,
	filename: pick.name,
	name: pick.release,
	quality: '',
	gb: 0,
	seeders: 0,
	otherLanguages: false
});

/** Whether the file at the link plays here (an MKV's tracks are read; anything else is taken as playable). */
async function playsHere(pick: NyaaPick): Promise<{ ok: boolean; why: string }> {
	if (!/\.mkv$/i.test(pick.name)) return { ok: true, why: '' };
	const info = await linkInfo(`${pick.hash}:${pick.file}`, pick.url);
	return info ? playable(info) : { ok: false, why: "the file couldn't be read" };
}

/**
 * Asks the debrid service for a pick's file: ready, still being got (kept, so the next ask carries
 * on with the same release), or failed (passed over for a day).
 */
async function askDebrid(shareKey: string, pick: NyaaPick): Promise<{ pick: NyaaPick | null; why: string; failed: boolean }> {
	const on = debridSetting();
	if (!on) return { pick: null, why: 'Nyaa needs a debrid service (Settings → Services)', failed: false };
	const got = await getOnDebrid(releaseOf(pick), on.service, on.key);
	if (got.url) {
		const ready = { ...pick, url: got.url, at: Date.now() };
		const plays = await playsHere(ready);
		if (!plays.ok) {
			saveOrderCache(badKey(pick.hash, pick.file), plays.why, Date.now());
			return { pick: null, why: plays.why, failed: true };
		}
		saveOrderCache(pickKey(shareKey), ready, Date.now());
		return { pick: ready, why: '', failed: false };
	}
	if (got.failed) {
		saveOrderCache(badKey(pick.hash, pick.file), got.why, Date.now());
		return { pick: null, why: got.why, failed: true };
	}
	saveOrderCache(pickKey(shareKey), { ...pick, url: '', at: 0 }, Date.now());
	return { pick: null, why: `${got.why}. Try again in a few minutes`, failed: false };
}

async function pickNow(shareKey: string, fresh: boolean): Promise<{ pick: NyaaPick | null; why: string }> {
	const what = parseNyaaShareKey(shareKey);
	if (!what) return { pick: null, why: 'not a Nyaa copy' };
	const on = debridSetting();
	if (!on) return { pick: null, why: 'Nyaa needs a debrid service (Settings → Services)' };

	// The release picked before: its link while it lasts, else the service is asked again (it may
	// have finished getting it since).
	const kept = getOrderCache(pickKey(shareKey));
	if (kept && Date.now() - kept.at < 14 * 24 * HOUR) {
		const pick = kept.value as NyaaPick;
		if (pick.url && !fresh && Date.now() - pick.at < LINK_LASTS) return { pick, why: '' };
		const asked = await askDebrid(shareKey, pick);
		if (!asked.failed) return asked;
	}

	const show = await showOf(what);
	if (!show?.names.length) return { pick: null, why: 'Nyaa: TMDB could not be asked' };
	const pad = (n: number) => String(n).padStart(2, '0');
	const queries = new Set<string>();
	for (const name of show.names.slice(0, 2)) {
		queries.add(name);
		const sure = sureWords(name);
		if (sure) queries.add(sure);
		if (what.type === 'tv') queries.add(`${name} ${pad(what.episode)}`);
		if (what.type === 'tv' && show.before) queries.add(`${name} ${pad(show.before + what.episode)}`);
	}
	const found = (await Promise.all([...queries].map(search))).flat();
	const unique = [...new Map(found.map((r) => [r.id, r])).values()];
	const candidates = candidatesFor(unique, show.names, what, show.before);
	if (!candidates.length) {
		// Released but nobody sharing it: kept on the wishlist and looked for again every few hours.
		if (unique.length && candidatesFor(unique.map((r) => ({ ...r, seeders: 1 })), show.names, what, show.before).length) {
			wish(shareKey, show.names[0], what);
			return { pick: null, why: `Nyaa: nobody is sharing it right now. Catalog keeps looking and gets it through ${serviceName(on.service)} when someone does` };
		}
		return { pick: null, why: unique.length ? 'Nyaa has no English-subtitled copy of this episode' : 'Nyaa has nothing for this' };
	}

	let why = '';
	let tries = 0;
	for (const c of candidates.slice(0, 6)) {
		if (tries >= MOST_TRIES) break;
		const meta = await torrentFile(c.release.id);
		if (!meta) continue;
		const files = await filesOf(meta).catch(() => []);
		const index = fileFor(files, what, show.before);
		if (index < 0) continue;
		const bad = getOrderCache(badKey(c.release.hash, index));
		if (bad && Date.now() - bad.at < 24 * HOUR) {
			why = String(bad.value);
			continue;
		}
		tries++;
		const asked = await askDebrid(shareKey, { hash: c.release.hash, file: index, name: files[index].name, release: c.release.title, url: '', at: 0 });
		// Ready, or being got: either way this is the release (the next ask carries on with it).
		if (!asked.failed) return asked;
		why = asked.why;
	}
	if (!why) wish(shareKey, show.names[0], what);
	return { pick: null, why: `Nyaa through ${serviceName(on.service)}: ${why || 'nobody is sharing it right now. Catalog keeps looking'}` };
}

/* ------------------------------------------------------------ the wishlist */

/*
 * Episodes picked on Nyaa while nobody was sharing them (owner, 2026-11-20). Every 6 hours each is
 * looked for again; once someone shares it, it's sent to the debrid service (which gets it on its
 * own servers, never from here), so it's ready to play. Settings → Services lists them.
 */
export type NyaaWish = { shareKey: string; name: string; season: number; episode: number; added: number; checked: number; state: 'waiting' | 'getting' | 'ready'; note: string };
const WISHES = 'nyaa-wishes';
const CHECK_EVERY = 6 * HOUR;

export function nyaaWishes(): NyaaWish[] {
	const kept = getOrderCache(WISHES)?.value;
	return Array.isArray(kept) ? (kept as NyaaWish[]) : [];
}
const saveWishes = (list: NyaaWish[]) => saveOrderCache(WISHES, list.slice(-200), Date.now());

function wish(shareKey: string, name: string, what: What): void {
	const list = nyaaWishes();
	if (list.some((w) => w.shareKey === shareKey)) return;
	list.push({ shareKey, name, season: what.type === 'tv' ? what.season : 0, episode: what.type === 'tv' ? what.episode : 0, added: Date.now(), checked: Date.now(), state: 'waiting', note: '' });
	saveWishes(list);
}

export function removeNyaaWish(shareKey: string): void {
	saveWishes(nyaaWishes().filter((w) => w.shareKey !== shareKey));
}

let checking = false;
/** Looks for each wish not checked in the last 6 hours (`all`: every one, for "Look now"). */
export async function checkNyaaWishes(all = false): Promise<void> {
	if (checking || !nyaaOn()) return;
	checking = true;
	try {
		for (const w of nyaaWishes()) {
			if (w.state === 'ready' || (!all && Date.now() - w.checked < CHECK_EVERY)) continue;
			const { pick, why } = await nyaaPick(w.shareKey).catch(() => ({ pick: null, why: '' }));
			// (Removed meanwhile: left out.)
			const list = nyaaWishes();
			const now = list.find((x) => x.shareKey === w.shareKey);
			if (!now) continue;
			now.checked = Date.now();
			now.state = pick?.url ? 'ready' : /is getting it|waiting for someone|looking for people/.test(why) ? 'getting' : 'waiting';
			now.note = pick?.url ? '' : why.replace(/^Nyaa( through [^:]+)?: /, '').replace(/\. Try again in a few minutes$/, '');
			saveWishes(list);
			await new Promise((r) => setTimeout(r, 5000));
		}
	} finally {
		checking = false;
	}
}

/** The player's link for a Nyaa copy: the debrid service's link to the file, or why there's none. */
export async function nyaaStream(shareKey: string, fresh = false): Promise<{ url: string; why: string; name: string }> {
	const { pick, why } = await nyaaPick(shareKey, fresh);
	if (!pick?.url) return { url: '', why, name: '' };
	return { url: pick.url, why: '', name: pick.release };
}

/* ------------------------------------------------------------ the file's own subtitles */

const LANGUAGES: Record<string, string> = {
	en: 'English', eng: 'English', ja: 'Japanese', jpn: 'Japanese', es: 'Spanish', spa: 'Spanish', pt: 'Portuguese', por: 'Portuguese',
	fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian',
	ru: 'Russian', rus: 'Russian', ar: 'Arabic', ara: 'Arabic', pl: 'Polish', pol: 'Polish', und: 'English'
};
const shortLang = (l: string) => (LANGUAGES[l] ?? 'English').slice(0, 2).toLowerCase();

export type FileSubtitle = { id: string; url: string; lang: string; language: string; fileName: string; source: string; default?: boolean };

/** The subtitle tracks inside the Nyaa file a share key plays (waits for the pick, if one's being made). */
export async function nyaaFileSubtitles(shareKey: string): Promise<FileSubtitle[]> {
	const kept = getOrderCache(pickKey(shareKey));
	const pick = picking.has(shareKey) ? (await nyaaPick(shareKey)).pick : kept ? (kept.value as NyaaPick) : null;
	if (!pick?.url || !/\.mkv$/i.test(pick.name)) return [];
	links.set(`${pick.hash}:${pick.file}`, pick.url);
	const read = await linkSubtitles(`${pick.hash}:${pick.file}`, pick.url);
	if (!read) return [];
	const tracks = read.info.tracks.filter((t) => isTextTrack(t) || isPictureTrack(t));
	const list = tracks.map((t) => {
		const language = LANGUAGES[t.language] ?? t.language;
		const label = t.name || language;
		return {
			id: `nyaa-${pick.hash.slice(0, 8)}-${pick.file}-${t.number}`,
			url: `torrent:${pick.hash}:${pick.file}:${t.number}`,
			lang: shortLang(t.language),
			language,
			fileName: `${label} (${isPictureTrack(t) ? 'read from pictures' : 'in the file'})`,
			source: 'Nyaa'
		} as FileSubtitle;
	});
	// The full English track goes on by itself (not the signs-only one).
	const englishText = list.filter((s, i) => s.language === 'English' && isTextTrack(tracks[i]));
	const english = englishText.length ? englishText : list.filter((s) => s.language === 'English');
	const full = english.find((s) => !/sign|song|forced/i.test(s.fileName)) ?? english[0];
	if (full) full.default = true;
	return [...list].sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)));
}

/** Picture tracks being read into text, by subtitle url (a few lines at a time, as they arrive). */
const pictureReadings = new Map<string, { cues: Cue[]; read: number; busy: boolean; done: boolean }>();

/**
 * `torrent:<hash>:<file>:<track>` (named from when torrents were opened here) → that track as a
 * whole subtitle file so far, and whether it's all there.
 */
export async function fileSubtitleText(url: string): Promise<{ text: string; complete: boolean } | null> {
	const m = url.match(/^torrent:([a-f0-9]{40}):(\d+):(\d+)$/);
	if (!m) return null;
	const keptKey = `nyaa-picture-text|${m[1]}:${m[2]}:${m[3]}`;
	const kept = getOrderCache(keptKey);
	if (kept && typeof kept.value === 'string') return { text: kept.value, complete: true };
	const link = links.get(`${m[1]}:${m[2]}`);
	if (!link) return { text: '', complete: false };
	const read = await linkSubtitles(`${m[1]}:${m[2]}`, link);
	if (!read) return { text: '', complete: false };
	const track = read.info.tracks.find((t) => t.number === +m[3]);
	if (!track) return { text: '', complete: true };
	if (isPictureTrack(track)) {
		let job = pictureReadings.get(url);
		if (!job) {
			job = { cues: [], read: 0, busy: false, done: false };
			pictureReadings.set(url, job);
		}
		const reading = job;
		if (!reading.busy && !reading.done) {
			reading.busy = true;
			void (async () => {
				try {
					while (true) {
						const lines = read.reader.lines.filter((l) => l.track === track.number);
						const count = Math.min(25, lines.length - reading.read - (read.reader.done ? 0 : 1));
						if (count <= 0) break;
						const batch = lines.slice(reading.read, reading.read + count + 1);
						const cues = await readMkvPictures(track, batch, count);
						reading.cues.push(...cues);
						reading.read += count;
					}
					if (read.reader.done && reading.read === read.reader.lines.filter((l) => l.track === track.number).length) {
						saveOrderCache(keptKey, toSrt(reading.cues), Date.now());
						reading.done = true;
						pictureReadings.delete(url);
					}
				} catch (e) {
					console.warn('[nyaa] reading pictures failed:', e);
				} finally {
					reading.busy = false;
				}
			})();
		}
		return { text: toSrt(reading.cues), complete: reading.done };
	}
	return { text: subtitleFile(track, read.reader.lines).text, complete: read.reader.done };
}
