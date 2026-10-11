/**
 * Everything a TV screen shows as a poster, in one shape: where OK goes, and what the banner
 * above the rows says about it while it's highlighted.
 */
export type Tile = {
	key: string;
	href: string;
	title: string;
	poster: string | null;
	/** Under the name in the banner: "2016 · Anime". */
	meta: string;
	overview: string | null;
	/** Small text over the poster: "S2E6". */
	note?: string | null;
	progress?: number | null;
	/** What the remote's menu button offers for it (src/lib/tv/TvMenu.svelte). */
	menu?: TileMenu;
};

/** Which kind of poster it is, and what's needed to act on it from its menu. */
export type TileMenu =
	| { kind: 'continue'; title: string; type: string; entryId: number | null; link: { source: string; id: string } | null }
	| { kind: 'library'; id: number; status: string }
	| { kind: 'result'; source: string; sourceId: string };

export type TileRow = { label: string; tiles: Tile[] };

/**
 * A poster at a size fit for filling half a TV: the library keeps small ones (TMDB's 342 or 500
 * pixels wide, AniList's "large", 230 wide), which looked blurry blown up behind the banner.
 */
export function bigPicture(url: string | null): string | null {
	if (!url) return url;
	return url
		.replace(/(image\.tmdb\.org\/t\/p\/)w\d+\//, '$1w780/')
		.replace(/\/cover\/(small|medium|large)\//, '/cover/extraLarge/');
}

/** A title's own TV page. */
export const titleHref = (source: string, sourceId: string) => `/tv/title/${source}/${encodeURIComponent(sourceId)}`;

/** Straight into the player, picking up where it was left. */
export function playHref(title: string, type: string, year?: number | string | null, season?: number, episode?: number) {
	const params = new URLSearchParams({ title, type, auto: '1' });
	if (year) params.set('year', String(year));
	if (type === 'tv' && season && episode) {
		params.set('resume_s', String(season));
		params.set('resume_e', String(episode));
	}
	return `/watch?${params}`;
}

const CATEGORY_TYPE: Record<string, string> = { movies: 'movie' };

type LibraryItem = {
	id: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	source: string;
	sourceId: string | null;
	category: string;
	categoryName: string;
	lastSeason: number | null;
	lastEpisode: number | null;
	status: string;
};

const STATUS_WORDS: Record<string, string> = {
	watching: 'Watching',
	completed: 'Watched',
	planned: 'Want to watch',
	paused: 'On hold',
	dropped: 'Dropped'
};

export function fromLibrary(item: LibraryItem): Tile {
	const reached = item.lastSeason && item.lastEpisode ? `S${item.lastSeason}E${item.lastEpisode}` : null;
	const filmFromTmdb = item.sourceId?.startsWith('movie:');
	return {
		key: `lib-${item.id}`,
		// Its own page when Catalog knows where it's from; otherwise straight to playing it.
		href:
			item.source !== 'manual' && item.sourceId
				? titleHref(item.source, item.sourceId)
				: playHref(item.title, CATEGORY_TYPE[item.category] ?? (filmFromTmdb ? 'movie' : 'tv'), item.year),
		title: item.title,
		poster: item.posterUrl,
		meta: [item.year, item.categoryName, STATUS_WORDS[item.status], reached].filter(Boolean).join(' · '),
		overview: item.overview,
		note: item.status === 'watching' ? reached : null,
		menu: { kind: 'library', id: item.id, status: item.status }
	};
}

type Result = {
	key: string;
	source: string;
	sourceId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	overview: string | null;
	kind: string;
};

export function fromResult(result: Result): Tile {
	return {
		key: result.key,
		href: titleHref(result.source, result.sourceId),
		title: result.title,
		poster: result.posterUrl,
		meta: [result.year, result.kind].filter(Boolean).join(' · '),
		overview: result.overview,
		menu: { kind: 'result', source: result.source, sourceId: result.sourceId }
	};
}

type Continuing = {
	title: string;
	type: string;
	season: number;
	episode: number;
	currentTime: number;
	duration: number;
	posterUrl: string | null;
	/** The library entry it belongs to, if any. */
	entryId?: number | null;
	/** Its own page, when it's known which title it is. */
	link?: { source: string; id: string } | null;
};

export function fromContinue(item: Continuing, overview: string | null = null): Tile {
	const episode = item.type === 'tv' && item.season ? `S${item.season}E${item.episode}` : null;
	const left = item.duration > 0 ? Math.max(0, Math.round((item.duration - item.currentTime) / 60)) : null;
	return {
		key: `cw-${item.type}-${item.title}`,
		href: item.link ? titleHref(item.link.source, item.link.id) : playHref(item.title, item.type, null, item.season, item.episode),
		title: item.title,
		poster: item.posterUrl,
		meta: [episode, left !== null && left > 0 ? `${left} min left` : null].filter(Boolean).join(' · ') || 'Continue watching',
		overview,
		note: episode,
		progress: item.duration > 0 ? item.currentTime / item.duration : null,
		menu: { kind: 'continue', title: item.title, type: item.type, entryId: item.entryId ?? null, link: item.link ?? null }
	};
}
