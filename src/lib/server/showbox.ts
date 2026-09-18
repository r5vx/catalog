import { electronFetch, electronGetVideoUrl } from './electron-fetch';

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
}

export async function searchShowbox(query: string): Promise<ShowboxResult[]> {
	const resp = await fetch(`${BASE}/search/autocomplate2`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `keyword=${encodeURIComponent(query)}`
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
	const m = url.match(/\/share\/([A-Za-z0-9]+)/);
	return m?.[1] ?? null;
}

export async function listFebboxFiles(
	shareUrl: string,
	parentId = 0
): Promise<FebboxFile[]> {
	const key = extractShareKey(shareUrl);
	if (!key) return [];

	const resp = await fetch(
		`https://www.febbox.com/file/file_share_list?share_key=${key}&pwd=&parent_id=${parentId}`
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

	for (const folder of seasonFolders) {
		const seasonNum = Number(folder.name.match(/\d+/)?.[0] ?? 0);
		seasons.push(seasonNum);

		const files = await listFebboxFiles(shareUrl, folder.fid);
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

export function bestMatch(
	items: ShowboxResult[],
	query: string,
	wantType: string,
	wantYear: string
): ShowboxResult | null {
	if (!items.length) return null;
	const want = query.toLowerCase().trim();

	for (const r of items) {
		const t = r.title.toLowerCase();
		if (t === want && (!wantType || r.type === wantType) && (!wantYear || r.info.includes(wantYear)))
			return r;
	}

	for (const r of items) {
		if (r.title.toLowerCase() === want && (!wantType || r.type === wantType)) return r;
	}

	if (wantType) {
		const typed = items.filter((r) => r.type === wantType);
		if (typed.length) return typed[0];
	}

	return items[0];
}
