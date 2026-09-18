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

export interface EpisodeInfo {
	season: number;
	episode: number;
	fid: number;
	name: string;
	size: string;
	quality: string;
}

const EP_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,3})/;
const QUALITY_PATTERN = /(\d{3,4}p)/i;

export async function listEpisodes(
	shareUrl: string
): Promise<{ seasons: number[]; episodes: EpisodeInfo[] }> {
	const folders = await listFebboxFiles(shareUrl);
	const seasonFolders = folders
		.filter((f) => f.isDir && /season\s*\d+/i.test(f.name))
		.sort((a, b) => {
			const aNum = Number(a.name.match(/\d+/)?.[0] ?? 0);
			const bNum = Number(b.name.match(/\d+/)?.[0] ?? 0);
			return aNum - bNum;
		});

	if (!seasonFolders.length) return { seasons: [], episodes: [] };

	const episodes: EpisodeInfo[] = [];
	const seasons: number[] = [];

	for (const folder of seasonFolders) {
		const seasonNum = Number(folder.name.match(/\d+/)?.[0] ?? 0);
		seasons.push(seasonNum);

		const files = await listFebboxFiles(shareUrl, folder.fid);
		const seen = new Map<string, EpisodeInfo>();

		for (const file of files) {
			if (file.isDir) continue;
			const epMatch = file.name.match(EP_PATTERN);
			if (!epMatch) continue;

			const ep = Number(epMatch[2]);
			const quality = file.name.match(QUALITY_PATTERN)?.[1] ?? '';
			const key = `${seasonNum}-${ep}`;

			const existing = seen.get(key);
			if (!existing || preferQuality(quality, existing.quality)) {
				seen.set(key, {
					season: seasonNum,
					episode: ep,
					fid: file.fid,
					name: file.name,
					size: file.size,
					quality
				});
			}
		}

		episodes.push(...seen.values());
	}

	episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
	return { seasons, episodes };
}

function preferQuality(candidate: string, current: string): boolean {
	const rank = (q: string) => {
		const n = parseInt(q);
		if (n >= 2160) return 3;
		if (n >= 1080) return 2;
		if (n >= 720) return 1;
		return 0;
	};
	return rank(candidate) > rank(current);
}

/* -------------------------------------------------------- stream resolution */

const VIDEO_EXTS = /\.(mp4|mkv|avi|m4v|webm)$/i;
const PREFER_EXTS = /\.(mp4|m4v|webm)$/i;

export function pickBestFile(files: FebboxFile[]): FebboxFile | null {
	const videos = files.filter((f) => !f.isDir && VIDEO_EXTS.test(f.name));
	if (!videos.length) return null;

	const playable = videos.filter((f) => PREFER_EXTS.test(f.name));
	const pool = playable.length ? playable : videos;

	return (
		pool.sort((a, b) => {
			const aq = parseInt(a.name.match(QUALITY_PATTERN)?.[1] ?? '0');
			const bq = parseInt(b.name.match(QUALITY_PATTERN)?.[1] ?? '0');
			return bq - aq;
		})[0] ?? null
	);
}

export async function findMovieFile(shareUrl: string): Promise<FebboxFile | null> {
	const root = await listFebboxFiles(shareUrl);
	const direct = pickBestFile(root);
	if (direct) return direct;

	for (const dir of root.filter((f) => f.isDir)) {
		const contents = await listFebboxFiles(shareUrl, dir.fid);
		const found = pickBestFile(contents);
		if (found) return found;
	}
	return null;
}

export async function getStreamUrl(
	shareKey: string,
	fid: number,
	token: string
): Promise<string | null> {
	try {
		const resp = await fetch(
			`https://www.febbox.com/file/share_download?share_key=${shareKey}&fid=${fid}`,
			{
				headers: { Cookie: token },
				signal: AbortSignal.timeout(15000)
			}
		);
		if (!resp.ok) return null;
		const data = (await resp.json()) as { data?: { download_url?: string } };
		return data?.data?.download_url ?? null;
	} catch {
		return null;
	}
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
