import { noteRefusal } from './slowRequests';
import { electronFetch, electronGetVideoUrl, electronGetSubtitles } from './electron-fetch';
import { withoutQualifier } from './metadata/types';

const BASE = 'https://showbox.media';

let cachedUp: boolean | null = null;
let cachedAt = 0;

const streamCache = new Map<number, { url: string; debug: string; ts: number }>();
const streamInFlight = new Map<number, Promise<{ url: string | null; debug?: string }>>();
const STREAM_CACHE_TTL = 15 * 60 * 1000;

export function invalidateStreamCache(fid: number) {
	streamCache.delete(fid);
}

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

function searchRelevance(title: string, query: string): number {
	const t = title.toLowerCase().replace(/['']/g, '');
	const q = query.toLowerCase();
	if (t === q) return 100;
	if (t.startsWith(q + ' ') || t.startsWith(q + ':') || t.startsWith(q + "'")) return 90;
	if (t.startsWith(q)) return 85;
	const wordBoundary = new RegExp(`(^|[\\s:''"])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s:''"])`, 'i');
	if (wordBoundary.test(title)) return 70;
	if (t.includes(q)) return 50;
	return 10;
}

export async function searchShowbox(query: string): Promise<ShowboxResult[]> {
	query = withoutQualifier(query);
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

	if (merged.length > 0) return sortByRelevance(merged, query);

	if (query.includes(':') || query.includes(' - ')) {
		const parts = query.split(/[:–—]\s*/).map((s) => s.trim()).filter(Boolean);
		for (const part of parts) {
			addResults(await rawSearch(part));
			if (merged.length > 0) return sortByRelevance(merged, query);
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
		if (merged.length > 0) return sortByRelevance(merged, query);
	}

	return [];
}

function sortByRelevance(results: ShowboxResult[], query: string): ShowboxResult[] {
	return results.sort((a, b) => searchRelevance(b.title, query) - searchRelevance(a.title, query));
}

/** JSON from a URL, or null on a non-OK reply. Throws only if both attempts fail to connect. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<any> {
	const attempt = async () => {
		const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
		if (!resp.ok) return null;
		return await resp.json();
	};
	try {
		return await attempt();
	} catch {
		// A dead keep-alive connection hangs until restart without this second, fresh try.
		return await attempt();
	}
}

export async function getFebboxLink(id: number, type: 'movie' | 'tv'): Promise<string | null> {
	const typeNum = type === 'movie' ? 1 : 2;
	const data = await getJson(`${BASE}/index/share_link?id=${id}&type=${typeNum}`);
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

	// A folder comes 50 files at a time (Black Clover's season 1 has 170): every page, in turn.
	const list: Record<string, unknown>[] = [];
	for (let page = 1; page <= 20; page++) {
		const data = await getJson(
			`https://www.febbox.com/file/file_share_list?share_key=${key}&pwd=&parent_id=${parentId}&page=${page}`,
			{
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
					Referer: 'https://www.febbox.com/'
				}
			}
		);
		const files = data?.data?.file_list;
		if (!Array.isArray(files)) {
			// A reply without a file list is the host saying no (busy, too many requests…): noted on
			// /api/diagnostics, since to the player it looks just like an empty folder.
			if (data) noteRefusal('www.febbox.com', '/file/file_share_list', `answered: ${data.msg ?? data.code ?? 'no file list'}`);
			// A later page refused: what came before still counts.
			if (page === 1) return [];
			break;
		}
		const seen = new Set(list.map((f) => f.fid));
		const fresh = files.filter((f: Record<string, unknown>) => !seen.has(f.fid));
		list.push(...fresh);
		if (files.length < 50 || !fresh.length) break;
	}

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
	/** Where the file comes from, when it isn't Showbox ("Aniwave"). */
	source?: string;
	/** What another source's file plays from (`aniwave:<id>:<episode>:<ssub|dub>`). */
	shareKey?: string;
	/** "Japanese" or "English", when the source says. */
	audio?: string;
	/** English subtitles are part of the picture: Catalog's own aren't switched on over them. */
	burnedIn?: boolean;
}

export interface EpisodeInfo {
	season: number;
	episode: number;
	files: FileOption[];
}

const EP_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,3})/;
/** An episode number without a season, for files in a season folder. */
const EP_ONLY = /(?:\s-\s|\b(?:E|EP|Episode)\s?)(\d{1,3})(?:v\d)?(?=[\s._\-\[(]|$)/i;
const QUALITY_PATTERN = /(\d{3,4}p)/i;
const VIDEO_EXTS = /\.(mp4|mkv|avi|m4v|webm)$/i;

export async function listEpisodes(
	shareUrl: string
): Promise<{ seasons: number[]; episodes: EpisodeInfo[]; qualities: string[] }> {
	const folders = await listFebboxFiles(shareUrl);
	// "Season 1", or just "S01".
	const seasonFolders = folders
		.filter((f) => f.isDir && /season\s*\d+|^s\d{1,2}$/i.test(f.name.trim()))
		.sort((a, b) => {
			const aNum = Number(a.name.match(/\d+/)?.[0] ?? 0);
			const bNum = Number(b.name.match(/\d+/)?.[0] ?? 0);
			return aNum - bNum;
		});

	// A brand-new show sometimes has its episodes loose at the top, with no season folder yet.
	const looseEpisodes = folders.filter((f) => !f.isDir && VIDEO_EXTS.test(f.name) && EP_PATTERN.test(f.name));

	if (!seasonFolders.length && !looseEpisodes.length) return { seasons: [], episodes: [], qualities: [] };

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
	if (!seasonFolders.length) {
		// Each loose file says its own season (S01E03); group them like folders would be.
		const bySeason = new Map<number, FebboxFile[]>();
		for (const file of looseEpisodes) {
			const season = Number(file.name.match(EP_PATTERN)![1]);
			bySeason.set(season, [...(bySeason.get(season) ?? []), file]);
		}
		for (const [seasonNum, files] of [...bySeason].sort((a, b) => a[0] - b[0])) seasonResults.push({ seasonNum, files });
	}

	for (const { seasonNum, files } of seasonResults) {
		seasons.push(seasonNum);
		const epFiles = new Map<string, FileOption[]>();

		for (const file of files) {
			if (file.isDir || !VIDEO_EXTS.test(file.name)) continue;
			// "S01E05", or in a season folder just the episode: "… - 05 …", "E05", "Episode 5".
			const ep = Number(file.name.match(EP_PATTERN)?.[2] ?? file.name.match(EP_ONLY)?.[1]);
			if (!ep) continue;

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
	const allM3u8: string[] = [];
	const seen = new Set<string>();
	for (const m of html.matchAll(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/gi)) {
		if (!seen.has(m[1])) { seen.add(m[1]); allM3u8.push(m[1]); }
	}
	if (allM3u8.length > 1) {
		const master = allM3u8.find((u) => !/\/(360|480|720|1080|2160)p?\//i.test(u));
		if (master) return master;
	}
	if (allM3u8.length > 0) return allM3u8[0];

	const mp4 = html.match(/(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i);
	if (mp4) return mp4[1];

	return null;
}

async function probeAndUpgrade(url: string, debug: string[]): Promise<string> {
	if (!url.includes('.m3u8')) return url;
	try {
		const resp = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				Referer: 'https://www.febbox.com/',
				Origin: 'https://www.febbox.com'
			},
			signal: AbortSignal.timeout(8000)
		});
		if (!resp.ok) { debug.push(`probe ${resp.status}`); return url; }
		const text = await resp.text();
		if (text.includes('#EXT-X-STREAM-INF')) {
			const infos = text.match(/#EXT-X-STREAM-INF:[^\n]*/g) || [];
			const summary = infos.map((line) => {
				const res = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? '?';
				const codec = line.match(/CODECS="([^"]+)"/)?.[1] ?? '?';
				return `${res}/${codec}`;
			}).join(', ');
			debug.push(`master (${infos.length} lvl: ${summary})`);
			return url;
		}
		debug.push('media playlist, looking for master');
		const base = url.replace(/[?#].*$/, '');
		const parent = base.replace(/\/[^/]+$/, '');
		const grandparent = parent.replace(/\/[^/]+$/, '');
		const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
		const candidates = [
			grandparent + '/index.m3u8' + query,
			grandparent + '/playlist.m3u8' + query,
			grandparent + '/master.m3u8' + query,
			parent + '/playlist.m3u8' + query,
			parent + '/master.m3u8' + query,
			parent + '/index.m3u8' + query
		];
		const results = await Promise.allSettled(candidates.map(async (c) => {
			const r = await fetch(c, {
				headers: { Referer: 'https://www.febbox.com/', Origin: 'https://www.febbox.com' },
				signal: AbortSignal.timeout(5000)
			});
			if (!r.ok) throw new Error();
			const t = await r.text();
			if (!t.includes('#EXT-X-STREAM-INF')) throw new Error();
			return c;
		}));
		const found = results.find((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
		if (found) {
			debug.push(`found master at ${found.value.replace(/[?].*/, '?...')}`);
			return found.value;
		}
		debug.push('no master found');
	} catch (e: unknown) {
		debug.push(`probe err: ${(e as Error)?.message ?? e}`);
	}
	return url;
}

export async function getStreamUrl(
	shareKey: string,
	fid: number,
	token: string
): Promise<{ url: string | null; debug?: string }> {
	const cached = streamCache.get(fid);
	if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
		return { url: cached.url, debug: cached.debug + ' | cached' };
	}

	const existing = streamInFlight.get(fid);
	if (existing) return existing;

	const promise = doGetStreamUrl(shareKey, fid, token);
	streamInFlight.set(fid, promise);
	try {
		return await promise;
	} finally {
		streamInFlight.delete(fid);
	}
}

async function doGetStreamUrl(
	shareKey: string,
	fid: number,
	token: string
): Promise<{ url: string | null; debug?: string }> {
	const debug: string[] = [];

	function cacheAndReturn(url: string, dbg: string) {
		streamCache.set(fid, { url, debug: dbg, ts: Date.now() });
		return { url, debug: dbg };
	}

	// Electron's net.fetch sends real browser cookies — try it first
	const electronUrl = await tryElectronStream(shareKey, fid, debug);
	if (electronUrl) {
		const upgraded = await probeAndUpgrade(electronUrl, debug);
		return cacheAndReturn(upgraded, debug.join(' | '));
	}

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
			if (url) {
				const upgraded = await probeAndUpgrade(url, debug);
				return cacheAndReturn(upgraded, debug.join(' | '));
			}
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
			if (url) return cacheAndReturn(url, debug.join(' | '));
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
	// Hidden BrowserWindow: load the player page, wait for JW Player,
	// and read its source URL (the real HD m3u8).
	const bw = await electronGetVideoUrl(shareKey, fid);
	if (bw.error) {
		debug.push(`bw: ${bw.error}`);
	} else {
		if (bw.videoInfo) debug.push(`vi: ${bw.videoInfo.slice(0, 300)}`);
		if (bw.capturedUrl) {
			debug.push('hd:' + bw.capturedUrl.substring(0, 150));
			return bw.capturedUrl;
		}
		if (bw.playerHtml) {
			const url = extractVideoUrl(bw.playerHtml);
			if (url) return url;
			const preview = bw.playerHtml.length < 300 ? bw.playerHtml : `${bw.playerHtml.length}ch`;
			debug.push(`bw-player: ${preview}`);
		}
	}

	// Fallback: net.fetch player page with credentials
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

export function prefetchStreamUrls(shareKey: string, fids: number[], token: string) {
	let chain = Promise.resolve<unknown>(undefined);
	for (const fid of fids) {
		const cached = streamCache.get(fid);
		if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) continue;
		chain = chain.then(() => getStreamUrl(shareKey, fid, token).catch(() => {}));
	}
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
	return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 1 || /^\d$/.test(w));
}

function trailingNumber(s: string): string | null {
	const m = s.trim().match(/\b(\d+)$/);
	return m ? m[1] : null;
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
	query = withoutQualifier(query);
	const want = query.toLowerCase().trim();
	const wantWords = titleWords(query);
	const wantNum = trailingNumber(want);

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
	if (exactNoYear && !wantYear) return exactNoYear;
	if (exactNoYear && wantYear) {
		const ey = extractYear(exactNoYear.info);
		if (!ey && Number(wantYear) >= 2000) return exactNoYear;
		if (ey && Math.abs(Number(ey) - Number(wantYear)) <= 5) return exactNoYear;
	}

	let best: ShowboxResult | null = null;
	let bestScore = 0;
	for (const r of items) {
		if (wantType && r.type !== wantType) continue;
		const t = r.title.toLowerCase();
		const rWords = titleWords(r.title);

		if (wantNum) {
			const resultNum = trailingNumber(t);
			if (resultNum !== wantNum) continue;
		}

		const overlap = wordOverlap(wantWords, rWords);
		const coverage = wantWords.length > 0 ? overlap / wantWords.length : 0;
		const reverseCoverage = rWords.length > 0 ? overlap / rWords.length : 0;
		let score = Math.min(coverage, reverseCoverage + 0.2);
		if (t === want) {
			score = Math.max(score, 0.95);
		} else if (want.includes(t) && t.length / want.length > 0.6) {
			score = Math.max(score, 0.9);
		} else if (t.includes(want) && want.length / t.length > 0.6) {
			score = Math.max(score, 0.85);
		}
		if (wantYear) {
			const resultYear = extractYear(r.info);
			if (r.info.includes(wantYear)) {
				score += 0.15;
			} else if (resultYear && resultYear !== wantYear) {
				if (t === want && Math.abs(Number(resultYear) - Number(wantYear)) <= 5) {
					// close enough year for exact title match
				} else {
					continue;
				}
			} else if (!resultYear) {
				if (t === want && Number(wantYear) >= 2000) {
					// no year info + exact title + modern request = trust it
				} else {
					score -= 0.4;
				}
			}
		}
		if (score > bestScore) {
			bestScore = score;
			best = r;
		}
	}

	if (best && bestScore >= 0.65) return best;
	return null;
}
