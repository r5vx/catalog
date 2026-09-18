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
