/**
 * AnimeTosho (animetosho.net): subtitles for anime, with no human check.
 *
 * AnimeTosho lists anime releases — including the Crunchyroll web copies groups like VARYG and
 * ToonsHub put out with every track left in — and offers each subtitle track inside them as its
 * own download. That's where the good English subtitles come from automatically:
 *   - "English (SDH)": the dub's closed captions, word for word with the English audio (shown
 *     as "English CC", the same captions anime.nexus has);
 *   - "English": the translation for the Japanese audio;
 *   - "English (Forced)": signs and on-screen text only.
 *
 * Its search (feed.animetosho.net/json) answers plain requests; a release's page lists its
 * subtitle tracks with download links (/download/<release>/subs/file/<track>), which hand back
 * the file xz-compressed. `downloadSubtitle` unpacks those.
 */
import { getOrderCache, saveOrderCache, savedSubtitle, saveSubtitle } from '../db/queries';
import { downloadSubtitle } from '../showbox-subs';

const FEED = 'https://feed.animetosho.net/json';
const SITE = 'https://animetosho.net';
const HOUR = 60 * 60 * 1000;

export interface ToshoSubtitle {
	/** "English CC", "English" or "English Signs" (other languages keep AnimeTosho's name). */
	label: string;
	lang: string;
	url: string;
	/** Which release it's from, shown as the file name. */
	release: string;
}

type Release = { id: number; title: string; num_files?: number };

/**
 * One copy of an episode: a release of just that episode (its page is /view/<id>), or the
 * episode inside a season pack (its own page within the pack, /file/<name>.<id>).
 */
type Copy = { page: string; title: string };

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

async function getPage(path: string): Promise<string | null> {
	try {
		const resp = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(10000) });
		return resp.ok ? await resp.text() : null;
	} catch {
		return null;
	}
}

async function search(text: string): Promise<Release[]> {
	// Punctuation out: AnimeTosho reads "-word" as "without this word", and Re:Zero's name is
	// "Re:ZERO -Starting Life in Another World-".
	const query = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	const key = `tosho-search|${query.toLowerCase()}`;
	const known = saved<Release[]>(key, 6 * HOUR);
	if (known) return known;
	try {
		const resp = await fetch(`${FEED}?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) });
		if (!resp.ok) return [];
		const releases = ((await resp.json()) as Release[]).map((r) => ({ id: r.id, title: r.title, num_files: r.num_files }));
		saveOrderCache(key, releases, Date.now());
		return releases;
	} catch {
		return [];
	}
}

/** A copy's subtitle tracks, from its page: [download path, "English (SDH) [eng, SRT]"]. */
async function tracksOf(page: string): Promise<[string, string][]> {
	const key = `tosho-tracks|${page}`;
	const known = saved<[string, string][]>(key, 7 * 24 * HOUR);
	if (known) return known;
	const html = await getPage(page);
	if (html === null) return [];
	const tracks = [...html.matchAll(/<a href="(\/download\/\d+\/subs\/file\/\d+)">([^<]+)<\/a>/g)].map(
		(m) => [m[1], m[2].trim()] as [string, string]
	);
	saveOrderCache(key, tracks, Date.now());
	return tracks;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Which season a release's name says: "S02", "S02E03", "Season 2", "2nd Season". */
function seasonOf(title: string): number | null {
	const m =
		title.match(/\bS(\d{1,2})(?:E\d{1,3})?\b/i) ??
		title.match(/\bSeason\s*(\d{1,2})\b/i) ??
		title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i);
	return m ? Number(m[1]) : null;
}

/**
 * Whether a release is this one episode: "… S02E03 …", or "… - 03 …" with the season named
 * some other way ("Season 2 - 03", "2nd Season - 03"), or with no season for a first season.
 */
function isEpisode(title: string, season: number, episode: number): boolean {
	const se = title.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
	if (se) return Number(se[1]) === season && Number(se[2]) === episode;
	const dash = title.match(/\s-\s(\d{1,3})(?:v\d)?[\s[(]/);
	if (!dash || Number(dash[1]) !== episode) return false;
	const named = seasonOf(title);
	// "The Final Season Part 3 - 01" names a season without saying which number: unknown.
	if (named === null && /\bseason\b|\bpart\s*\d|\bcour\b/i.test(title)) return false;
	return (named ?? 1) === season;
}

/** A season pack for this season: several files, the season in its name (none: a first season). */
function isSeasonPack(release: Release, season: number): boolean {
	return (release.num_files ?? 1) > 1 && (seasonOf(release.title) ?? 1) === season;
}

/**
 * The episode's own page inside a season pack, found among the pack's files by "s02e03" in its
 * name, or "-03-" when that's the only file it could be. Kept for a week.
 */
async function episodeInPack(release: Release, season: number, episode: number): Promise<Copy | null> {
	const key = `tosho-pack|${release.id}`;
	let files = saved<string[]>(key, 7 * 24 * HOUR);
	if (!files) {
		const html = await getPage(`/view/${release.id}`);
		if (html === null) return null;
		files = [...new Set([...html.matchAll(/href="(\/file\/[^"]+\.\d+)"/g)].map((m) => m[1]))];
		saveOrderCache(key, files, Date.now());
	}
	const named = new RegExp(`s0?${season}e0?${episode}(?!\d)`, 'i');
	let page = files.find((f) => named.test(f));
	if (!page) {
		const numbered = files.filter((f) => new RegExp(`(?:^|[-_])0?${episode}(?:v\d)?[-_.]`).test(f.replace(/^\/file\//, '')));
		if (numbered.length === 1) page = numbered[0];
	}
	return page ? { page, title: `${release.title} — S${pad(season)}E${pad(episode)}` } : null;
}

/** Crunchyroll copies with every track (the dub captions are only in those) come first. */
function rank(title: string): number {
	let score = 0;
	if (/multi|dual/i.test(title)) score += 2;
	// Dub-only copies often carry no subtitles at all.
	if (/english dub/i.test(title)) score += 0.5;
	if (/\bCR\b|crunchyroll/i.test(title)) score += 1;
	if (/VARYG|ToonsHub/i.test(title)) score += 1;
	return score;
}

/**
 * The English subtitles AnimeTosho has for one episode, from the best copy that has them.
 * Single-episode releases first; when none of those has the dub's captions, the episode inside
 * a season pack. `names` are the show's names to search by (English and Japanese).
 *
 * `overall`: the episode's number counting from the show's first, for a later season. Long
 * shows' releases often go by it ("Black Clover - 52" is season 2's first episode).
 */
export async function toshoSubtitles(
	names: string[],
	season: number,
	episode: number,
	overall?: number
): Promise<ToshoSubtitle[]> {
	// Every search at once (each is kept for six hours).
	const ask = async (queries: string[]) => (await Promise.all(queries.map(search))).flat();
	const counted = overall && overall !== episode ? overall : 0;
	const queries = names.flatMap((n) => [
		`${n} S${pad(season)}E${pad(episode)}`,
		`${n} ${pad(episode)}`,
		...(counted ? [`${n} ${pad(counted)}`] : [])
	]);
	const singles = new Map<number, Release>();
	for (const r of await ask(queries)) {
		const single = (r.num_files ?? 1) === 1;
		if (single && (isEpisode(r.title, season, episode) || (counted && isEpisode(r.title, 1, counted)))) singles.set(r.id, r);
	}

	// Up to three copies of the episode, looked at together, best-looking first; one with the
	// dub's captions wins.
	const byRank = (a: Release, b: Release) => rank(b.title) - rank(a.title);
	const best = (lists: ToshoSubtitle[][]) =>
		lists.find((english) => english.some((t) => t.label === 'English CC')) ??
		lists.find((english) => english.some((t) => t.label === 'English')) ??
		lists.find((english) => english.length);
	const fromSingles = await Promise.all(
		[...singles.values()].sort(byRank).slice(0, 3).map((r) => englishTracks({ page: `/view/${r.id}`, title: r.title }))
	);
	const single = best(fromSingles);
	if (single?.some((t) => t.label === 'English CC')) return single;

	// No captions yet: season packs (older shows often only come whole).
	const packs = new Map<number, Release>();
	for (const r of await ask(names.flatMap((n) => [`${n} S${pad(season)}`, `${n} Season ${season}`]))) {
		if (isSeasonPack(r, season)) packs.set(r.id, r);
	}
	const fromPacks = await Promise.all(
		[...packs.values()].sort(byRank).slice(0, 4).map(async (r) => {
			const copy = await episodeInPack(r, season, episode);
			return copy ? englishTracks(copy) : [];
		})
	);
	const packed = best(fromPacks);
	if (packed?.some((t) => t.label === 'English CC')) return packed;
	return single ?? packed ?? [];
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The English subtitles AnimeTosho has for a film (Re:Zero's Memory Snow): a single-file copy
 * with every word of the film's name in it, that isn't an episode of something. `names`: the
 * film's names (English and Japanese).
 */
export async function toshoFilmSubtitles(names: string[]): Promise<ToshoSubtitle[]> {
	const copies = new Map<number, Release>();
	for (const r of (await Promise.all(names.map(search))).flat()) {
		if ((r.num_files ?? 1) !== 1) continue;
		if (/\bS\d{1,2}E\d{1,3}\b/i.test(r.title) || /\s-\s\d{1,3}(?:v\d)?[\s[(]/.test(r.title)) continue;
		const has = new Set(wordsOf(r.title));
		if (!names.some((n) => wordsOf(n).every((w) => has.has(w)))) continue;
		copies.set(r.id, r);
	}
	const lists = await Promise.all(
		[...copies.values()]
			.sort((a, b) => rank(b.title) - rank(a.title))
			.slice(0, 3)
			.map((r) => englishTracks({ page: `/view/${r.id}`, title: r.title }))
	);
	return (
		lists.find((english) => english.some((t) => t.label === 'English CC')) ??
		lists.find((english) => english.some((t) => t.label === 'English')) ??
		lists.find((english) => english.length) ??
		[]
	);
}

/** Subtitles that are text; picture-based ones (Blu-ray PGS, DVD VobSub) can't be shown. */
const TEXT = /, (ASS|SSA|SRT|VTT)\]/i;

/** The lines a subtitle speaks: an SRT's text lines, or the text of an ASS's "Dialogue:" lines. */
function spokenLines(text: string): string[] {
	const rows = text.replace(/\r/g, '').split('\n');
	return text.includes('Dialogue:')
		? rows.filter((l) => l.startsWith('Dialogue:')).map((l) => l.split(',').slice(9).join(','))
		: rows.map((l) => l.trim()).filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'));
}

/** How much of a subtitle is sound cues — "[gasps]", "♪" — which only captions have. */
function cueShare(text: string): number {
	const spoken = spokenLines(text);
	if (!spoken.length) return 0;
	return spoken.filter((l) => /\[[^\]]{2,}\]|♪/.test(l)).length / spoken.length;
}

/**
 * A release's English text subtitles, named: "English CC" (the dub's captions), "English", and
 * "English Signs". Newer releases name their tracks ("English (SDH)"). Older ones only say
 * "[eng, SRT]"; there, when it can't be told from the formats, the unnamed tracks are looked
 * inside and the one full of sound cues is the captions. Kept for a week.
 */
async function englishTracks(copy: Copy): Promise<ToshoSubtitle[]> {
	const key = `tosho-english|${copy.page}`;
	const known = saved<ToshoSubtitle[]>(key, 7 * 24 * HOUR);
	if (known) return known;

	const forced = (label: string) => /forced|signs/i.test(label);
	const english = (await tracksOf(copy.page)).filter(([, label]) => /\[eng,/i.test(label) && TEXT.test(label));
	const plain = english.filter(([, label]) => !forced(label));
	let captions = plain.filter(([, label]) => /SDH|CC|hearing/i.test(label)).map(([path]) => path);
	/** Unnamed tracks that turned out to be signs only, or that wouldn't download. */
	const signs: string[] = [];
	const broken: string[] = [];

	if (!captions.length && plain.length) {
		const ass = plain.filter(([, label]) => /, ASS\]/i.test(label));
		const srt = plain.filter(([, label]) => /, SRT\]/i.test(label));
		// Crunchyroll's usual shape: the translation is ASS, the captions SRT.
		if (plain.length === 2 && ass.length === 1 && srt.length === 1) captions = [srt[0][0]];
		else {
			// Unnamed: looked inside. Near-empty is signs only (or nothing), and the one full of
			// sound cues is the captions — even when it's the only track (a dub copy's).
			const looked = await Promise.all(plain.map(async ([path]) => [path, await downloadSubtitle(`${SITE}${path}`)] as const));
			const shares: [string, number][] = [];
			for (const [path, text] of looked) {
				const lines = spokenLines(text).length;
				if (!lines) broken.push(path);
				else if (lines < 40) signs.push(path);
				else shares.push([path, cueShare(text)]);
			}
			const best = [...shares].sort((a, b) => b[1] - a[1])[0];
			// (A lone track only needs to be full of cues; several need one clearly ahead.)
			const others = shares.filter((x) => x !== best).map((x) => x[1]);
			if (best && best[1] >= 0.08 && best[1] > 2 * Math.max(0, ...others)) captions = [best[0]];
		}
	}

	let plainCount = 0;
	const named = english.filter(([path]) => !broken.includes(path)).map(([path, label]) => {
		let name = captions.includes(path) ? 'English CC' : forced(label) || signs.includes(path) ? 'English Signs' : 'English';
		// Two plain English tracks that can't be told apart: numbered rather than identical.
		if (name === 'English' && ++plainCount > 1) name = `English ${plainCount}`;
		return { label: name, lang: 'en', url: `${SITE}${path}`, release: copy.title };
	});
	saveOrderCache(key, named, Date.now());
	return named;
}

const keeping = new Set<string>();

/**
 * Keeps this season's English subtitles on this PC, from `episode` on, so the rest of the season
 * plays with them instantly (and without AnimeTosho, should it be down). Runs in the
 * background, one episode at a time; stops after two episodes in a row with nothing (the end of
 * the season, or episodes not out yet). Files already kept aren't fetched again.
 */
export function keepSeasonSubtitles(show: string, names: string[], season: number, episode: number, overall?: number): void {
	const key = `${show.toLowerCase()}|${season}`;
	if (keeping.has(key)) return;
	keeping.add(key);
	(async () => {
		let misses = 0;
		for (let ep = episode; ep < episode + 30 && misses < 2; ep++) {
			const tracks = await toshoSubtitles(names, season, ep, overall ? overall + ep - episode : undefined);
			misses = tracks.length ? 0 : misses + 1;
			for (const track of tracks) {
				if (savedSubtitle(track.url)) continue;
				const content = await downloadSubtitle(track.url);
				if (content) saveSubtitle(track.url, show, content);
			}
			// Gentle on AnimeTosho.
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	})()
		.catch(() => {})
		.finally(() => keeping.delete(key));
}
