import { electronFetch, electronGetVideoUrl, electronGetSubtitles } from './electron-fetch';

const BASE = 'https://showbox.media';

let cachedUp: boolean | null = null;
let cachedAt = 0;

export async function isShowboxUp(): Promise<boolean> {
	if (cachedUp !== null && Date.now() - cachedAt < 60_000) return cachedUp;
	try {
		const resp = await fetch(BASE, {
			method: 'HEAD',
			signal: AbortSignal.timeout(5000)
		});
		cachedUp = resp.ok;
	} catch {
		cachedUp = false;
	}
	cachedAt = Date.now();
	return cachedUp;
}

export interface ShowboxResult {
	id: number;
	type: 'movie' | 'tv';
	title: string;
	posterUrl: string;
	info: string;
	slug?: string;
}

async function rawSearch(keyword: string): Promise<ShowboxResult[]> {
	try {
		const resp = await fetch(`${BASE}/search/autocomplate2`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `keyword=${encodeURIComponent(keyword)}`,
			signal: AbortSignal.timeout(10000)
		});

		if (!resp.ok) return [];

		const html = await resp.text();
		const results: ShowboxResult[] = [];
		const linkPattern = /<a\s+href="\/(?<kind>tv|movie)\/detail\/(?<id>\d+)"[\s\S]*?<\/a>/g;

		for (const match of html.matchAll(linkPattern)) {
			const kind = match.groups!.kind as 'tv' | 'movie';
			const id = Number(match.groups!.id);
			const block = match[0];

			const titleMatch = block.match(/class="film-name"[^>]*>([^<]+)/);
			const posterMatch = block.match(/src="([^"]+)"/);
			const infoMatch = block.match(/class="film-infor"[^>]*>([\s\S]*?)<\/div>/);

			const infoText = infoMatch
				? infoMatch[1]
						.replace(/<[^>]+>/g, ' ')
						.replace(/\s+/g, ' ')
						.trim()
				: '';

			results.push({
				id,
				type: kind,
				title: titleMatch?.[1]?.trim() ?? '',
				posterUrl: posterMatch?.[1] ?? '',
				info: infoText
			});
		}

		return results;
	} catch {
		return [];
	}
}

async function rawSearchPage(keyword: string): Promise<ShowboxResult[]> {
	try {
		const resp = await fetch(`${BASE}/search?keyword=${encodeURIComponent(keyword)}`, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				Accept: 'text/html'
			},
			signal: AbortSignal.timeout(10000)
		});
		if (!resp.ok) return [];

		const html = await resp.text();
		const results: ShowboxResult[] = [];
		const itemPattern = /<div class="flw-item">([\s\S]*?)<div class="clearfix"><\/div>/g;

		for (const match of html.matchAll(itemPattern)) {
			const block = match[1];
			const linkMatch = block.match(/href="\/(movie|tv)\/(m|t)-([^"]+)"/);
			if (!linkMatch) continue;

			const kind = linkMatch[1] as 'movie' | 'tv';
			const slug = `${linkMatch[2]}-${linkMatch[3]}`;

			const titleMatch = block.match(/class="film-name"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
			const posterMatch = block.match(/class="film-poster-img"[^>]*\bsrc="([^"]+)"/);
			const infoItems: string[] = [];
			for (const m of block.matchAll(/class="fdi-item"[^>]*>([^<]+)<\/span>/g)) {
				infoItems.push(m[1].trim());
			}

			results.push({
				id: 0,
				type: kind,
				title: titleMatch?.[1]?.trim() ?? '',
				posterUrl: posterMatch?.[1] ?? '',
				info: infoItems.join(' '),
				slug
			});
		}

		return results;
	} catch {
		return [];
	}
}

export async function resolveSlugId(slug: string, type: 'movie' | 'tv'): Promise<number> {
	try {
		const resp = await fetch(`${BASE}/${type}/${slug}`, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				Accept: 'text/html'
			},
			signal: AbortSignal.timeout(10000)
		});
		if (!resp.ok) return 0;

		const html = await resp.text();
		const detailMatch = html.match(/\/(movie|tv)\/detail\/(\d+)/);
		if (detailMatch) return Number(detailMatch[2]);

		const dataIdMatch = html.match(/data-id="(\d+)"[^>]*data-type="/);
		if (dataIdMatch) return Number(dataIdMatch[1]);

		return 0;
	} catch {
		return 0;
	}
}

export async function searchShowbox(query: string): Promise<ShowboxResult[]> {
	const seenTitles = new Set<string>();
	const merged: ShowboxResult[] = [];
	const addResults = (rs: ShowboxResult[]) => {
		for (const r of rs) {
			const key = r.title.toLowerCase();
			if (seenTitles.has(key)) continue;
			seenTitles.add(key);
			merged.push(r);
		}
	};

	const [autocomplete, page] = await Promise.all([
		rawSearch(query),
		rawSearchPage(query)
	]);
	addResults(autocomplete);
	addResults(page);

	if (merged.length > 0) return merged;

	if (query.includes(':') || query.includes(' - ')) {
		const parts = query.split(/[:–—]\s*/).map((s) => s.trim()).filter(Boolean);
		for (const part of parts) {
			addResults(await rawSearch(part));
			if (merged.length > 0) return merged;
		}
	}

	const words = query.split(/\s+/).filter((w) => w.length > 0);
	if (words.length <= 1) return merged;

	const tries: string[] = [];
	if (words.length > 2) {
		tries.push(words.slice(1).join(' '));
		tries.push(words.slice(0, -1).join(' '));
	}
	if (words.length > 3) tries.push(words.slice(0, 3).join(' '));
	tries.push(words.slice(0, 2).join(' '));
	if (words.length > 2) tries.push(words.slice(-2).join(' '));

	for (const t of tries) {
		addResults(await rawSearch(t));
		if (merged.length > 0) return merged;
	}

	return [];
}

export async function getFebboxLink(id: number, type: 'movie' | 'tv'): Promise<string | null> {
	const typeNum = type === 'movie' ? 1 : 2;
	const resp = await fetch(`${BASE}/index/share_link?id=${id}&type=${typeNum}`);

	if (!resp.ok) return null;

	const data = await resp.json();
	return data?.data?.link ?? null;
}

export interface FebboxFile {
	fid: number;
	name: string;
	size: string;
	isDir: boolean;
	parentId: number;
}

export function extractShareKey(url: string): string | null {
	const m = url.match(/\/share\/([A-Za-z0-9_\-]+)/);
	return m?.[1] ?? null;
}

export async function listFebboxFiles(
	shareUrl: string,
	parentId = 0
): Promise<FebboxFile[]> {
	const key = extractShareKey(shareUrl);
	if (!key) return [];

	const resp = await fetch(
		`https://www.febbox.com/file/file_share_list?share_key=${key}&pwd=&parent_id=${parentId}`,
		{
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				Referer: 'https://www.febbox.com/'
			}
		}
	);
	if (!resp.ok) return [];

	const data = await resp.json();
	const list = data?.data?.file_list;
	if (!Array.isArray(list)) return [];

	return list.map((f: Record<string, unknown>) => ({
		fid: Number(f.fid),
		name: String(f.file_name ?? ''),
		size: String(f.file_size ?? ''),
		isDir: f.is_dir === 1,
		parentId: Number(f.parent_id ?? 0)
	}));
}

export interface FileOption {
	fid: number;
	quality: string;
	name: string;
	size: string;
}

export interface EpisodeInfo {
	season: number;
	episode: number;
	files: FileOption[];
}

const EP_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,3})/;
const QUALITY_PATTERN = /(\d{3,4}p)/i;
const VIDEO_EXTS = /\.(mp4|mkv|avi|m4v|webm)$/i;

export async function listEpisodes(
	shareUrl: string
): Promise<{ seasons: number[]; episodes: EpisodeInfo[]; qualities: string[] }> {
	const folders = await listFebboxFiles(shareUrl);
	const seasonFolders = folders
		.filter((f) => f.isDir && /season\s*\d+/i.test(f.name))
		.sort((a, b) => {
			const aNum = Number(a.name.match(/\d+/)?.[0] ?? 0);
			const bNum = Number(b.name.match(/\d+/)?.[0] ?? 0);
			return aNum - bNum;
		});

	if (!seasonFolders.length) return { seasons: [], episodes: [], qualities: [] };

	const episodes: EpisodeInfo[] = [];
	const seasons: number[] = [];
	const allQualities = new Set<string>();

	const seasonResults = await Promise.all(
		seasonFolders.map(async (folder) => {
			const seasonNum = Number(folder.name.match(/\d+/)?.[0] ?? 0);
			const files = await listFebboxFiles(shareUrl, folder.fid);
			return { seasonNum, files };
		})
	);

	for (const { seasonNum, files } of seasonResults) {
		seasons.push(seasonNum);
		const epFiles = new Map<string, FileOption[]>();

		for (const file of files) {
			if (file.isDir || !VIDEO_EXTS.test(file.name)) continue;
			const epMatch = file.name.match(EP_PATTERN);
			if (!epMatch) continue;

			const ep = Number(epMatch[2]);
			const quality = file.name.match(QUALITY_PATTERN)?.[1] ?? '';
			if (quality) allQualities.add(quality);
			const key = `${seasonNum}-${ep}`;

			const list = epFiles.get(key) ?? [];
			list.push({ fid: file.fid, quality, name: file.name, size: file.size });
			epFiles.set(key, list);
		}

		for (const [key, fileList] of epFiles) {
			const [s, e] = key.split('-').map(Number);
			fileList.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
			episodes.push({ season: s, episode: e, files: fileList });
		}
	}

	episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
	const qualities = [...allQualities].sort((a, b) => parseInt(b) - parseInt(a));
	return { seasons, episodes, qualities };
}

/* -------------------------------------------------------- stream resolution */

export async function listMovieFiles(shareUrl: string): Promise<FileOption[]> {
	const root = await listFebboxFiles(shareUrl);
	let videos = root.filter((f) => !f.isDir && VIDEO_EXTS.test(f.name));

	if (!videos.length) {
		for (const dir of root.filter((f) => f.isDir)) {
			const contents = await listFebboxFiles(shareUrl, dir.fid);
			videos.push(...contents.filter((f) => !f.isDir && VIDEO_EXTS.test(f.name)));
		}
	}

	return videos
		.map((f) => ({
			fid: f.fid,
			quality: f.name.match(QUALITY_PATTERN)?.[1] ?? '',
			name: f.name,
			size: f.size
		}))
		.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
}

function extractVideoUrl(html: string): string | null {
	const source = html.match(/<source[^>]+src=["']([^"']+)["']/i);
	if (source) return source[1];

	const videoSrc = html.match(/<video[^>]+src=["']([^"']+)["']/i);
	if (videoSrc) return videoSrc[1];

	const m3u8 = html.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i);
	if (m3u8) return m3u8[1];

	const mp4 = html.match(/(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i);
	if (mp4) return mp4[1];

	return null;
}

export async function getStreamUrl(
	shareKey: string,
	fid: number,
	token: string
): Promise<{ url: string | null; debug?: string }> {
	const debug: string[] = [];

	// Electron's net.fetch sends real browser cookies — try it first
	const electronUrl = await tryElectronStream(shareKey, fid, debug);
	if (electronUrl) return { url: electronUrl };

	// Fallback: server-side fetch with saved cookie string (for phone access)
	const headers = {
		Cookie: token,
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Referer: 'https://www.febbox.com/',
		Origin: 'https://www.febbox.com'
	};

	try {
		const resp = await fetch('https://www.febbox.com/file/player', {
			method: 'POST',
			headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `fid=${fid}&share_key=${shareKey}`,
			signal: AbortSignal.timeout(15000)
		});
		debug.push(`player ${resp.status}`);
		if (resp.ok) {
			const html = await resp.text();
			const url = extractVideoUrl(html);
			if (url) return { url };
			const preview = html.length < 300 ? html : `${html.length}ch`;
			debug.push(`player: ${preview}`);
		}
	} catch (e: unknown) {
		debug.push(`player err: ${(e as Error)?.message ?? e}`);
	}

	try {
		const resp = await fetch(
			`https://www.febbox.com/file/share_download?share_key=${shareKey}&fid=${fid}`,
			{ headers, signal: AbortSignal.timeout(15000) }
		);
		debug.push(`dl ${resp.status}`);
		if (resp.ok) {
			const text = await resp.text();
			const url = tryParseDownloadUrl(text);
			if (url) return { url };
			debug.push(`dl: ${text.slice(0, 200)}`);
		}
	} catch (e: unknown) {
		debug.push(`dl err: ${(e as Error)?.message ?? e}`);
	}

	return { url: null, debug: debug.join(' | ') };
}

async function tryElectronStream(
	shareKey: string,
	fid: number,
	debug: string[]
): Promise<string | null> {
	// Primary: hidden BrowserWindow fetches from inside the page context,
	// so it has the same cookies + localStorage + headers as the real site.
	const bw = await electronGetVideoUrl(shareKey, fid);
	if (bw.error) {
		debug.push(`bw: ${bw.error}`);
	} else {
		if (bw.playerHtml) {
			const url = extractVideoUrl(bw.playerHtml);
			if (url) return url;
			const preview = bw.playerHtml.length < 300 ? bw.playerHtml : `${bw.playerHtml.length}ch`;
			debug.push(`bw-player: ${preview}`);
		}
		if (bw.dlText) {
			const url = tryParseDownloadUrl(bw.dlText);
			if (url) return url;
			debug.push(`bw-dl: ${bw.dlText.slice(0, 200)}`);
		}
	}

	// Fallback: net.fetch with credentials: include
	const r1 = await electronFetch('https://www.febbox.com/file/player', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `fid=${fid}&share_key=${shareKey}`
	});
	if (r1.error) {
		debug.push(`net: ${r1.error}`);
		return null;
	}
	debug.push(`e-player ${r1.status}`);
	if (r1.status === 200) {
		const url = extractVideoUrl(r1.body);
		if (url) return url;
		const preview = r1.body.length < 300 ? r1.body : `${r1.body.length}ch`;
		debug.push(`e-player: ${preview}`);
	}

	return null;
}

function tryParseDownloadUrl(text: string): string | null {
	try {
		const data = JSON.parse(text);
		if (data?.data?.download_url) return data.data.download_url;
		if (data?.data?.url) return data.data.url;
		if (data?.data?.link) return data.data.link;
		if (typeof data?.data === 'string' && data.data.startsWith('http')) return data.data;
	} catch {
		return extractVideoUrl(text);
	}
	return null;
}

/* -------------------------------------------------------- subtitles */

const SUBTITLE_EXTS = /\.(srt|ass|sub|vtt|ssa)$/i;

export interface SubtitleOption {
	fid: number;
	name: string;
	language: string;
}

const LANG_MAP: Record<string, string> = {
	eng: 'English', en: 'English', english: 'English',
	spa: 'Spanish', es: 'Spanish', spanish: 'Spanish',
	fre: 'French', fr: 'French', french: 'French',
	ger: 'German', de: 'German', german: 'German',
	ita: 'Italian', it: 'Italian', italian: 'Italian',
	por: 'Portuguese', pt: 'Portuguese', portuguese: 'Portuguese',
	jpn: 'Japanese', ja: 'Japanese', japanese: 'Japanese',
	kor: 'Korean', ko: 'Korean', korean: 'Korean',
	chi: 'Chinese', zh: 'Chinese', chinese: 'Chinese',
	ara: 'Arabic', ar: 'Arabic', arabic: 'Arabic',
	rus: 'Russian', ru: 'Russian', russian: 'Russian',
	hin: 'Hindi', hi: 'Hindi', hindi: 'Hindi',
	dut: 'Dutch', nl: 'Dutch', dutch: 'Dutch',
	pol: 'Polish', pl: 'Polish', polish: 'Polish',
	tur: 'Turkish', tr: 'Turkish', turkish: 'Turkish',
	swe: 'Swedish', sv: 'Swedish', swedish: 'Swedish',
	nor: 'Norwegian', no: 'Norwegian', norwegian: 'Norwegian',
	dan: 'Danish', da: 'Danish', danish: 'Danish',
	fin: 'Finnish', fi: 'Finnish', finnish: 'Finnish',
	gre: 'Greek', el: 'Greek', greek: 'Greek',
	heb: 'Hebrew', he: 'Hebrew', hebrew: 'Hebrew',
	hun: 'Hungarian', hu: 'Hungarian', hungarian: 'Hungarian',
	cze: 'Czech', cs: 'Czech', czech: 'Czech',
	rum: 'Romanian', ro: 'Romanian', romanian: 'Romanian',
};

function detectLanguage(filename: string): string {
	const base = filename.replace(SUBTITLE_EXTS, '');
	const parts = base.split(/[.\-_\s]/);
	for (let i = parts.length - 1; i >= 0; i--) {
		const lower = parts[i].toLowerCase();
		if (LANG_MAP[lower]) return LANG_MAP[lower];
	}
	return 'Unknown';
}

export async function findSubtitles(
	shareUrl: string,
	parentId = 0
): Promise<SubtitleOption[]> {
	const files = await listFebboxFiles(shareUrl, parentId);
	const subs: SubtitleOption[] = [];

	for (const f of files) {
		if (!f.isDir && SUBTITLE_EXTS.test(f.name)) {
			subs.push({ fid: f.fid, name: f.name, language: detectLanguage(f.name) });
		}
	}

	if (!subs.length) {
		const subDirs = files.filter(
			(f) => f.isDir && /^(subs?|subtitles?)$/i.test(f.name)
		);
		for (const dir of subDirs) {
			const inner = await listFebboxFiles(shareUrl, dir.fid);
			for (const f of inner) {
				if (!f.isDir && SUBTITLE_EXTS.test(f.name)) {
					subs.push({ fid: f.fid, name: f.name, language: detectLanguage(f.name) });
				}
			}
		}
	}

	return subs;
}

export async function fetchFebboxSubtitles(
	shareKey: string,
	fid: number
): Promise<SubtitleOption[]> {
	const result = await electronGetSubtitles(shareKey, fid);
	if (result.error || !result.data) return [];

	try {
		const data = JSON.parse(result.data);
		const list = data?.data?.list ?? data?.data ?? [];
		if (!Array.isArray(list) || !list.length) return [];

		return list
			.map((s: Record<string, unknown>) => ({
				fid: Number(s.sid ?? s.id ?? s.fid ?? 0),
				name: String(s.file_name ?? s.name ?? s.title ?? ''),
				language: String(
					s.language ?? s.lang ?? detectLanguage(String(s.file_name ?? s.name ?? ''))
				)
			}))
			.filter((s: SubtitleOption) => s.name);
	} catch {
		return [];
	}
}

export async function downloadSubtitleContent(
	shareKey: string,
	fid: number,
	token: string
): Promise<string> {
	let downloadUrl = '';

	const eResp = await electronFetch(
		`https://www.febbox.com/file/share_download?share_key=${shareKey}&fid=${fid}`
	);
	if (!eResp.error && eResp.status === 200) {
		try {
			const data = JSON.parse(eResp.body);
			downloadUrl = data?.data?.download_url ?? data?.data?.url ?? data?.data?.link ?? '';
		} catch {}
	}

	if (!downloadUrl && token) {
		try {
			const resp = await fetch(
				`https://www.febbox.com/file/share_download?share_key=${shareKey}&fid=${fid}`,
				{
					headers: {
						Cookie: token,
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
						Referer: 'https://www.febbox.com/'
					},
					signal: AbortSignal.timeout(10000)
				}
			);
			if (resp.ok) {
				const data = await resp.json();
				downloadUrl = data?.data?.download_url ?? data?.data?.url ?? data?.data?.link ?? '';
			}
		} catch {}
	}

	if (!downloadUrl) return '';

	try {
		const resp = await fetch(downloadUrl, {
			headers: { Referer: 'https://www.febbox.com/' },
			signal: AbortSignal.timeout(10000)
		});
		if (!resp.ok) return '';
		return await resp.text();
	} catch {
		return '';
	}
}

function titleWords(s: string): string[] {
	return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 1);
}

function wordOverlap(a: string[], b: string[]): number {
	const setB = new Set(b);
	return a.filter((w) => setB.has(w)).length;
}

function extractYear(info: string): string | null {
	const m = info.match(/\b(19|20)\d{2}\b/);
	return m ? m[0] : null;
}

export function bestMatch(
	items: ShowboxResult[],
	query: string,
	wantType: string,
	wantYear: string
): ShowboxResult | null {
	if (!items.length) return null;
	const want = query.toLowerCase().trim();
	const wantWords = titleWords(query);

	let exactWithYear: ShowboxResult | null = null;
	let exactNoYear: ShowboxResult | null = null;
	for (const r of items) {
		const t = r.title.toLowerCase();
		if (t !== want) continue;
		if (wantType && r.type !== wantType) continue;
		if (wantYear && r.info.includes(wantYear)) { exactWithYear = r; break; }
		if (!exactNoYear) exactNoYear = r;
	}
	if (exactWithYear) return exactWithYear;
	if (exactNoYear) return exactNoYear;

	let best: ShowboxResult | null = null;
	let bestScore = 0;
	for (const r of items) {
		if (wantType && r.type !== wantType) continue;
		const t = r.title.toLowerCase();
		const rWords = titleWords(r.title);
		const overlap = wordOverlap(wantWords, rWords);
		const coverage = wantWords.length > 0 ? overlap / wantWords.length : 0;
		const reverseCoverage = rWords.length > 0 ? overlap / rWords.length : 0;
		let score = Math.min(coverage, reverseCoverage + 0.2);
		if (t.includes(want) || want.includes(t)) score = Math.max(score, 0.9);
		if (wantYear) {
			const resultYear = extractYear(r.info);
			if (r.info.includes(wantYear)) {
				score += 0.15;
			} else if (resultYear && resultYear !== wantYear) {
				score -= 0.4;
			} else if (!resultYear) {
				score -= 0.2;
			}
		}
		if (score > bestScore) {
			bestScore = score;
			best = r;
		}
	}

	if (best && bestScore >= 0.6) return best;
	return null;
}
