import { fetchImdbId, fetchEnglishTitle } from './metadata/tmdb';
import { readSettings } from './settings';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const OS_REST = 'https://rest.opensubtitles.org/search';
const SUBDL_API = 'https://api.subdl.com/api/v1/subtitles';
const SUBDL_DL = 'https://dl.subdl.com';
const UA = 'Catalog v1.0';

const SUBDL_LANG_MAP: Record<string, string> = {
	EN: 'eng', ES: 'spa', FR: 'fre', DE: 'ger', IT: 'ita', PT: 'por',
	JA: 'jpn', KO: 'kor', ZH: 'chi', AR: 'ara', RU: 'rus', HI: 'hin',
	NL: 'dut', PL: 'pol', TR: 'tur', SV: 'swe', NO: 'nor', DA: 'dan',
	FI: 'fin', EL: 'gre', HE: 'heb', HU: 'hun', CS: 'cze', RO: 'rum',
	ID: 'ind', TH: 'tha', VI: 'vie', MS: 'may', HR: 'hrv', BG: 'bul',
	UK: 'ukr', FA: 'per', BN: 'ben', SK: 'slo', SQ: 'alb', BS: 'bos',
};

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

interface SubDLSub {
	release_name?: string;
	name?: string;
	lang?: string;
	language?: string;
	url?: string;
}

async function fetchSubDL(params: URLSearchParams): Promise<SubtitleOption[]> {
	try {
		const resp = await fetch(`${SUBDL_API}?${params}`, {
			signal: AbortSignal.timeout(12000)
		});
		if (!resp.ok) return [];
		const data = await resp.json();
		if (!Array.isArray(data.subtitles)) return [];

		return data.subtitles.map((s: SubDLSub, i: number) => {
			const iso = (s.language ?? 'EN').toUpperCase();
			const osLang = SUBDL_LANG_MAP[iso] ?? iso.toLowerCase();
			const display = s.lang
				? s.lang.charAt(0).toUpperCase() + s.lang.slice(1)
				: langName(osLang);
			const cleanUrl = s.url ? s.url.split('?')[0] : '';
			return {
				id: `subdl-${i}`,
				url: cleanUrl ? `${SUBDL_DL}${cleanUrl}` : '',
				lang: osLang,
				language: display,
				fileName: s.release_name ?? s.name ?? '',
				source: 'SubDL'
			};
		}).filter((s: SubtitleOption) => s.url);
	} catch {
		return [];
	}
}

async function querySubDL(
	imdbId: string | null,
	title: string,
	type: 'movie' | 'tv',
	season?: number,
	episode?: number
): Promise<SubtitleOption[]> {
	const key = readSettings().subdlApiKey;
	if (!key) return [];

	const base: Record<string, string> = { api_key: key, subs_per_page: '30', type };
	if (type === 'tv' && season) base.season_number = String(season);
	if (type === 'tv' && episode) base.episode_number = String(episode);

	if (imdbId) {
		const results = await fetchSubDL(new URLSearchParams({ ...base, imdb_id: imdbId }));
		if (results.length > 0) return results;
	}

	return fetchSubDL(new URLSearchParams({ ...base, film_name: title }));
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


export async function fetchSubtitlesForTitle(
	title: string,
	type: 'movie' | 'tv',
	season?: number,
	episode?: number
): Promise<SubtitleOption[]> {
	try {
		let imdbId = await fetchImdbId(title, type);
		if (!imdbId) {
			const alt = type === 'tv' ? 'movie' : 'tv';
			imdbId = await fetchImdbId(title, alt);
		}

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

		if (imdbId) {
			const numericId = imdbId.replace(/^tt/, '');
			const [engResults, allResults] = await Promise.all([
				queryOS(`imdbid-${numericId}/sublanguageid-eng`),
				queryOS(`imdbid-${numericId}`)
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
						queryOS(`query-${terms}/sublanguageid-eng`),
						queryOS(`query-${terms}`)
					]);
					for (const s of collectResults(engText)) addSub(s);
					for (const s of collectResults(allText)) addSub(s);
				}
				if (subs.length > 0) break;
			}
		}

		const subdlSubs = await querySubDL(imdbId, title, type, season, episode);
		for (const s of subdlSubs) {
			const key = s.fileName.toLowerCase();
			if (!seen.has(key) && !seen.has(s.url)) {
				seen.add(key);
				seen.add(s.url);
				subs.push(s);
			}
		}

		const langCount = new Map<string, number>();
		return subs.filter((s) => {
			const count = (langCount.get(s.lang) ?? 0) + 1;
			langCount.set(s.lang, count);
			return s.lang === 'eng' ? count <= 25 : count <= 5;
		});
	} catch {
		return [];
	}
}

function extractFromZip(buf: Buffer): string {
	const SUB_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub'];
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

export async function downloadSubtitle(url: string): Promise<string> {
	try {
		const resp = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(15000)
		});
		if (!resp.ok) return '';

		const buf = Buffer.from(await resp.arrayBuffer());
		if (buf[0] === 0x50 && buf[1] === 0x4b) return extractFromZip(buf);
		if (buf[0] === 0x1f && buf[1] === 0x8b) {
			return gunzipSync(buf).toString('utf-8');
		}
		return buf.toString('utf-8');
	} catch {
		return '';
	}
}
