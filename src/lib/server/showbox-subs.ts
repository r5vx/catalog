import { fetchImdbId, fetchEnglishTitle } from './metadata/tmdb';

const OS_REST = 'https://rest.opensubtitles.org/search';
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
				fileName: s.SubFileName ?? ''
			});
		};

		const collectResults = (results: OSResult[]) => {
			const matched = results.filter(matchesEpisode);
			return matched.length > 0 ? matched : results;
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
				const terms = t.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
				if (!terms) continue;

				const [engText, allText] = await Promise.all([
					queryOS(`query-${terms}/sublanguageid-eng`),
					queryOS(`query-${terms}`)
				]);
				for (const s of collectResults(engText)) addSub(s);
				for (const s of collectResults(allText)) addSub(s);
				if (subs.length > 0) break;
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

export async function downloadSubtitle(url: string): Promise<string> {
	try {
		const resp = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(15000)
		});
		if (!resp.ok) return '';

		const buf = Buffer.from(await resp.arrayBuffer());
		if (buf[0] === 0x1f && buf[1] === 0x8b) {
			const { gunzipSync } = await import('node:zlib');
			return gunzipSync(buf).toString('utf-8');
		}
		return buf.toString('utf-8');
	} catch {
		return '';
	}
}
