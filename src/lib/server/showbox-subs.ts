import { fetchImdbId, fetchEnglishTitle } from './metadata/tmdb';
import { slimSubtitle } from './subtitleFonts';
import { readSettings } from './settings';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import xz from 'xz-decompress';

const OS_REST = 'https://rest.opensubtitles.org/search';
const GESTDOWN_API = 'https://api.gestdown.info';
const UA = 'Catalog v1.0';

const LANG_NAMES: Record<string, string> = {
	eng: 'English', spa: 'Spanish', fre: 'French', ger: 'German',
	ita: 'Italian', por: 'Portuguese', jpn: 'Japanese', kor: 'Korean',
	chi: 'Chinese', ara: 'Arabic', rus: 'Russian', hin: 'Hindi',
	dut: 'Dutch', pol: 'Polish', tur: 'Turkish', swe: 'Swedish',
	nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', gre: 'Greek',
	heb: 'Hebrew', hun: 'Hungarian', cze: 'Czech', rum: 'Romanian',
	ind: 'Indonesian', tha: 'Thai', vie: 'Vietnamese', may: 'Malay',
	hrv: 'Croatian', slv: 'Slovenian', bul: 'Bulgarian', ukr: 'Ukrainian',
	scc: 'Serbian', per: 'Persian', ben: 'Bengali', tam: 'Tamil',
	tel: 'Telugu', pob: 'Portuguese (BR)', zht: 'Chinese (Traditional)',
	nld: 'Dutch', ell: 'Greek', slo: 'Slovak', mac: 'Macedonian',
	srp: 'Serbian', slk: 'Slovak', alb: 'Albanian', bos: 'Bosnian',
};

function langName(code: string): string {
	return LANG_NAMES[code] ?? code;
}

export interface SubtitleOption {
	id: string;
	url: string;
	lang: string;
	language: string;
	fileName: string;
	source?: string;
}

interface OSResult {
	IDSubtitleFile?: string;
	SubDownloadLink?: string;
	SubLanguageID?: string;
	SubFileName?: string;
	SubFormat?: string;
	SeriesSeason?: string;
	SeriesEpisode?: string;
}

async function queryOS(path: string): Promise<OSResult[]> {
	try {
		const resp = await fetch(`${OS_REST}/${path}`, {
			headers: { 'User-Agent': UA },
			redirect: 'manual',
			signal: AbortSignal.timeout(12000)
		});
		if (!resp.ok) return [];
		return resp.json();
	} catch {
		return [];
	}
}


async function queryGestdown(
	title: string,
	type: 'movie' | 'tv',
	season?: number,
	episode?: number
): Promise<SubtitleOption[]> {
	if (type !== 'tv' || !season || !episode) return [];
	try {
		const q = title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
		const resp = await fetch(`${GESTDOWN_API}/shows/search/${encodeURIComponent(q)}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!resp.ok) return [];
		const data = await resp.json();
		const shows = data?.shows;
		if (!Array.isArray(shows) || shows.length === 0) return [];

		const show = shows[0];
		const subResp = await fetch(
			`${GESTDOWN_API}/subtitles/get/${show.id}/${season}/${episode}/english`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!subResp.ok) return [];
		const subData = await subResp.json();
		const subs = subData?.matchingSubtitles;
		if (!Array.isArray(subs)) return [];

		return subs.slice(0, 10).map((s: any, i: number) => ({
			id: `addic7ed-${i}`,
			url: `${GESTDOWN_API}${s.downloadUri}`,
			lang: 'eng',
			language: 'English',
			fileName: `${show.name} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} ${s.version || ''}`.trim(),
			source: 'Addic7ed'
		}));
	} catch {
		return [];
	}
}

/** OpenSubtitles, by IMDb id, or by name when that finds nothing. */
async function fromOpenSubtitles(
	title: string,
	type: 'movie' | 'tv',
	imdbId: string | null,
	season?: number,
	episode?: number
): Promise<SubtitleOption[]> {
	const seen = new Set<string>();
	const subs: SubtitleOption[] = [];

	const matchesEpisode = (s: OSResult) =>
		type !== 'tv' || !season || !episode ||
		(String(s.SeriesSeason) === String(season) && String(s.SeriesEpisode) === String(episode));

	const addSub = (s: OSResult) => {
		if (!s.SubDownloadLink || !s.SubLanguageID) return;
		const key = s.IDSubtitleFile ?? s.SubDownloadLink;
		if (seen.has(key)) return;
		seen.add(key);
		subs.push({
			id: s.IDSubtitleFile ?? String(subs.length),
			url: s.SubDownloadLink,
			lang: s.SubLanguageID,
			language: langName(s.SubLanguageID),
			fileName: s.SubFileName ?? '',
			source: 'OpenSubtitles'
		});
	};

	const collectResults = (results: OSResult[]) => {
		const matched = results.filter(matchesEpisode);
		if (matched.length > 0) return matched;
		return (type === 'tv' && season && episode) ? [] : results;
	};

	// Asked for the one episode: asked for the whole show, OpenSubtitles gives the first hundred
	// it has, and for a long show (Bleach, 366 episodes) the one playing is hardly ever among
	// them. The parts of the address go in alphabetical order (episode, imdbid or query, season,
	// sublanguageid); any other order is sent off to a bad address.
	const one = type === 'tv' && season && episode;
	const ep = one ? `episode-${episode}/` : '';
	const se = one ? `/season-${season}` : '';

	if (imdbId) {
		const numericId = imdbId.replace(/^tt/, '');
		const [engResults, allResults] = await Promise.all([
			queryOS(`${ep}imdbid-${numericId}${se}/sublanguageid-eng`),
			queryOS(`${ep}imdbid-${numericId}${se}`)
		]);
		for (const s of collectResults(engResults)) addSub(s);
		for (const s of collectResults(allResults)) addSub(s);
	}

	if (subs.length === 0) {
		const titlesToTry = [title];
		const engTitle = await fetchEnglishTitle(title, type);
		if (engTitle) titlesToTry.push(engTitle);

		for (const t of titlesToTry) {
			const spaced = t.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
			const spaceless = t.toLowerCase().replace(/[^a-z0-9]/g, '');
			const variants: string[] = [];
			if (spaced) variants.push(spaced);
			if (spaceless && spaced.includes('+')) variants.push(spaceless);

			for (const terms of variants) {
				const [engText, allText] = await Promise.all([
					queryOS(`${ep}query-${terms}${se}/sublanguageid-eng`),
					queryOS(`${ep}query-${terms}${se}`)
				]);
				for (const s of collectResults(engText)) addSub(s);
				for (const s of collectResults(allText)) addSub(s);
			}
			if (subs.length > 0) break;
		}
	}
	return subs;
}

/** OpenSubtitles first, then Addic7ed; no repeats, and only so many per language. */
function mergeSubtitles(lists: SubtitleOption[][]): SubtitleOption[] {
	const seen = new Set<string>();
	const subs: SubtitleOption[] = [];
	for (const s of lists.flat()) {
		const name = s.fileName.toLowerCase();
		if (seen.has(s.url) || (s.source !== 'OpenSubtitles' && name && seen.has(name))) continue;
		seen.add(s.url);
		if (name) seen.add(name);
		subs.push(s);
	}
	const langCount = new Map<string, number>();
	return subs.filter((s) => {
		const count = (langCount.get(s.lang) ?? 0) + 1;
		langCount.set(s.lang, count);
		return s.lang === 'eng' ? count <= 25 : count <= 5;
	});
}

/** Complete answers, kept for an hour, so a site that was slow the first time is there next time. */
const complete = new Map<string, { list: SubtitleOption[]; at: number }>();

/**
 * Subtitles from OpenSubtitles and Addic7ed, both asked at once. The list goes back with
 * whatever has answered — 2.5 seconds after OpenSubtitles, six at most; one slow site used to
 * hold it up for half a minute — and the rest is kept for the next time it's asked for.
 */
export async function fetchSubtitlesForTitle(
	title: string,
	type: 'movie' | 'tv',
	season?: number,
	episode?: number
): Promise<SubtitleOption[]> {
	const key = `${title.toLowerCase()}|${type}|${season ?? 0}|${episode ?? 0}`;
	const known = complete.get(key);
	if (known && Date.now() - known.at < 60 * 60 * 1000) return known.list;

	try {
		let imdbId = await fetchImdbId(title, type);
		if (!imdbId) imdbId = await fetchImdbId(title, type === 'tv' ? 'movie' : 'tv');

		// (SubDL was dropped 2026-10-20: it needed a key and added little.)
		const answered: (SubtitleOption[] | null)[] = [null, null];
		const asking = [
			fromOpenSubtitles(title, type, imdbId, season, episode),
			queryGestdown(title, type, season, episode)
		].map((p, i) => p.catch(() => []).then((list) => (answered[i] = list)));

		const all = Promise.all(asking).then((lists) => {
			const list = mergeSubtitles(lists);
			complete.set(key, { list, at: Date.now() });
			return list;
		});
		// OpenSubtitles has the most; once it has answered, the others get 2.5 seconds more.
		const afterOpenSubtitles = asking[0].then(() => new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)));
		const inTime = await Promise.race([
			all,
			afterOpenSubtitles,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
		]);
		return inTime ?? mergeSubtitles(answered.map((list) => list ?? []));
	} catch {
		return [];
	}
}

const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub'];

/** 2 = names this season and episode, 1 = names this episode, 0 = another episode or no telling. */
function episodeScore(name: string, season?: number, episode?: number): number {
	if (!episode) return 0;
	const base = name.split('/').pop() ?? name;
	const se = base.match(/s(\d{1,2})[ ._-]*e(\d{1,3})/i) ?? base.match(/\b(\d{1,2})x(\d{2,3})\b/i);
	if (se) return +se[2] === episode && (!season || +se[1] === season) ? 2 : 0;
	const ep =
		base.match(/(?:\be|\bep|episode)[ ._-]*(\d{1,3})\b/i) ??
		base.match(/^(\d{1,3})[ ._-]/) ?? //  "02 Breaking Brad.en.srt"
		base.match(/[ ._-](\d{2,3})[ ._\-[(]/);
	return ep && +ep[1] === episode ? 1 : 0;
}

function inflate(raw: Buffer, method: number): string {
	if (method === 0) return raw.toString('utf-8');
	if (method === 8) return inflateRawSync(raw).toString('utf-8');
	return '';
}

/**
 * Season packs hold every episode, so the file has to be chosen by episode — taking the first
 * one gave episode 1's captions on every episode. Reads the zip's central directory, which
 * always has the sizes; the per-file headers can leave them blank.
 */
function extractFromZip(buf: Buffer, season?: number, episode?: number): string {
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) return extractFromZipScan(buf);

	const files: { name: string; method: number; size: number; at: number }[] = [];
	let p = buf.readUInt32LE(eocd + 16);
	const count = buf.readUInt16LE(eocd + 10);
	for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
		const nameLen = buf.readUInt16LE(p + 28);
		const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
		if (SUB_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) {
			files.push({ name, method: buf.readUInt16LE(p + 10), size: buf.readUInt32LE(p + 20), at: buf.readUInt32LE(p + 42) });
		}
		p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
	}
	if (files.length === 0) return '';

	// Text formats first: a ".sub" is often a Blu-ray/DVD picture subtitle, with no text to show.
	const format = (name: string) => SUB_EXTS.findIndex((ext) => name.toLowerCase().endsWith(ext));
	const pick = files
		.map((f, i) => ({ f, score: episodeScore(f.name, season, episode), i }))
		.sort((a, b) => b.score - a.score || format(a.f.name) - format(b.f.name) || a.i - b.i)[0].f;
	const dataStart = pick.at + 30 + buf.readUInt16LE(pick.at + 26) + buf.readUInt16LE(pick.at + 28);
	const text = inflate(buf.subarray(dataStart, dataStart + pick.size), pick.method);
	// Pictures, not text (binary): nothing that can be shown.
	return text.includes('\0') ? '' : text;
}

function extractFromZipScan(buf: Buffer): string {
	let offset = 0;
	while (offset + 30 < buf.length) {
		if (buf.readUInt32LE(offset) !== 0x04034b50) break;
		const method = buf.readUInt16LE(offset + 8);
		const compSize = buf.readUInt32LE(offset + 18);
		const nameLen = buf.readUInt16LE(offset + 26);
		const extraLen = buf.readUInt16LE(offset + 28);
		const name = buf.toString('utf-8', offset + 30, offset + 30 + nameLen);
		const dataStart = offset + 30 + nameLen + extraLen;

		if (SUB_EXTS.some((ext) => name.toLowerCase().endsWith(ext)) && compSize > 0) {
			const raw = buf.subarray(dataStart, dataStart + compSize);
			if (method === 0) return raw.toString('utf-8');
			if (method === 8) {
				return inflateRawSync(raw).toString('utf-8');
			}
		}
		offset = dataStart + compSize;
	}
	return '';
}

export async function downloadSubtitle(url: string, season?: number, episode?: number): Promise<string> {
	return slimSubtitle(await downloadSubtitleText(url, season, episode));
}

async function downloadSubtitleText(url: string, season?: number, episode?: number): Promise<string> {
	try {
		const resp = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(15000)
		});
		if (!resp.ok) return '';

		const buf = Buffer.from(await resp.arrayBuffer());
		if (buf[0] === 0x50 && buf[1] === 0x4b) return extractFromZip(buf, season, episode);
		if (buf[0] === 0x1f && buf[1] === 0x8b) {
			return gunzipSync(buf).toString('utf-8');
		}
		// xz (AnimeTosho's subtitle downloads): FD 37 7A 58 5A 00.
		if (buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a && buf[3] === 0x58) {
			const stream = new Blob([buf]).stream();
			return await new Response(new xz.XzReadableStream(stream)).text();
		}
		return buf.toString('utf-8');
	} catch {
		return '';
	}
}
