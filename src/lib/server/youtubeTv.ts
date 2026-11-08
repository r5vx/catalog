/*
 * YouTube's own rows for a Roku: the places YouTube's TV app has (Music, Gaming, News, Sports,
 * Live, Movies, Podcasts), a channel's page, a playlist. Asked of YouTube as its TV app asks them
 * (TVHTML5) and turned into plain rows of videos, channels and playlists. Playing goes through
 * the computer's hidden YouTube player as before (youtube.ts, electron/youtubeHelper.cjs).
 * Signed out (no account on the Roku yet), so Home, Subscriptions and Library aren't here.
 */
import { isVideoId } from './youtube';

const AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36';
const CLIENT = {
	clientName: 'TVHTML5',
	clientVersion: '7.20261102.18.00',
	hl: 'en',
	gl: 'US',
	deviceMake: 'Samsung',
	deviceModel: 'SmartTV',
	osName: 'Tizen',
	osVersion: '8.0',
	platform: 'TV',
	userAgent: AGENT + ',gzip(gfe)'
};

export type Tile = { kind: 'video' | 'channel' | 'playlist'; id: string; title: string; line: string; thumb: string; length: string };
export type Row = { title: string; items: Tile[] };

/** YouTube's places, as its TV app names them. */
export const PLACES: Record<string, string> = {
	music: 'FEtopics_music',
	gaming: 'FEtopics_gaming',
	news: 'FEtopics_news',
	sports: 'FEtopics_sports',
	live: 'FEtopics_live',
	movies: 'FEtopics_movies',
	podcasts: 'FEtopics_podcasts'
};

function find(o: unknown, key: string, out: unknown[] = []): unknown[] {
	if (!o || typeof o !== 'object') return out;
	const rec = o as Record<string, unknown>;
	if (key in rec) out.push(rec[key]);
	for (const k in rec) if (k !== key) find(rec[k], key, out);
	return out;
}

const textOf = (t: unknown): string => {
	const v = t as { simpleText?: string; runs?: { text: string }[]; content?: string } | undefined;
	return v?.simpleText ?? v?.runs?.map((r) => r.text).join('') ?? v?.content ?? '';
};

function tile(t: Record<string, unknown>): Tile | null {
	const select = (t.onSelectCommand ?? {}) as Record<string, Record<string, string> | undefined>;
	const meta = ((t.metadata as Record<string, unknown>)?.tileMetadataRenderer ?? {}) as Record<string, unknown>;
	const header = ((t.header as Record<string, unknown>)?.tileHeaderRenderer ?? {}) as Record<string, unknown>;
	const thumbs = ((header.thumbnail as { thumbnails?: { url: string; width?: number }[] })?.thumbnails ?? []).slice();
	thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
	let thumb = thumbs[0]?.url ?? '';
	if (thumb.startsWith('//')) thumb = 'https:' + thumb;
	const lines = ((meta.lines as unknown[]) ?? [])
		.map((line) =>
			(((line as Record<string, Record<string, unknown>>).lineRenderer?.items as unknown[]) ?? [])
				.map((item) => textOf((item as Record<string, Record<string, unknown>>).lineItemRenderer?.text))
				.filter((s) => s && s !== '•')
				.join(' · ')
		)
		.filter(Boolean);
	const length = textOf(find(header.thumbnailOverlays, 'thumbnailOverlayTimeStatusRenderer').map((o) => (o as Record<string, unknown>).text)[0]);
	const title = textOf(meta.title);
	// (A big picture at the top of a place has no name: not a tile.)
	if (!title) return null;
	const type = String(t.contentType ?? '');
	const watch = select.watchEndpoint;
	const reel = select.reelWatchEndpoint;
	const browse = select.browseEndpoint;
	if (type === 'TILE_CONTENT_TYPE_CHANNEL' && browse?.browseId) return { kind: 'channel', id: browse.browseId, title, line: lines.join(' · '), thumb, length: '' };
	if (type === 'TILE_CONTENT_TYPE_PLAYLIST') {
		const id = browse?.browseId?.replace(/^VL/, '') ?? watch?.playlistId ?? '';
		if (id) return { kind: 'playlist', id, title, line: lines.join(' · '), thumb, length };
	}
	const video = watch?.videoId ?? reel?.videoId ?? String(t.contentId ?? '');
	if (isVideoId(video)) return { kind: 'video', id: video, title, line: lines.join(' · '), thumb: thumb || `https://i.ytimg.com/vi/${video}/hqdefault.jpg`, length };
	return null;
}

const tilesIn = (o: unknown) => (find(o, 'tileRenderer') as Record<string, unknown>[]).map(tile).filter((t): t is Tile => t !== null);

/** YouTube's answer as rows: its shelves, and a playlist's or grid's videos in rows of 30. */
function rowsOf(answer: unknown): Row[] {
	const rows: Row[] = [];
	for (const shelf of find(answer, 'shelfRenderer') as Record<string, unknown>[]) {
		const titled = find(shelf.headerRenderer ?? {}, 'title')[0] ?? shelf.title;
		const items = tilesIn(shelf.content);
		if (items.length) rows.push({ title: textOf(titled), items });
	}
	for (const list of [...find(answer, 'playlistVideoListRenderer'), ...find(answer, 'gridRenderer')]) {
		const items = tilesIn(list);
		for (let i = 0; i < items.length; i += 30) rows.push({ title: i ? '' : 'Videos', items: items.slice(i, i + 30) });
	}
	return rows;
}

/** A place's rows (`place` from PLACES), a channel's page (`UC…`) or a playlist's videos (its id). */
export async function youtubeRows(place: string, id = ''): Promise<Row[]> {
	let browseId = PLACES[place] ?? '';
	if (place === 'channel' && /^UC[\w-]{10,}$/.test(id)) browseId = id;
	if (place === 'playlist' && /^[\w-]{10,}$/.test(id)) browseId = 'VL' + id;
	if (!browseId) return [];
	const resp = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': AGENT,
			Origin: 'https://www.youtube.com',
			Referer: 'https://www.youtube.com/tv'
		},
		body: JSON.stringify({ context: { client: CLIENT }, browseId }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!resp.ok) throw new Error(`YouTube answered ${resp.status}`);
	return rowsOf(await resp.json());
}
