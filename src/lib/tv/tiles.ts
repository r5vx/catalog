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
};

export type TileRow = { label: string; tiles: Tile[] };

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
		note: item.status === 'watching' ? reached : null
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
		overview: result.overview
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
};

export function fromContinue(item: Continuing, overview: string | null = null): Tile {
	const episode = item.type === 'tv' && item.season ? `S${item.season}E${item.episode}` : null;
	const left = item.duration > 0 ? Math.max(0, Math.round((item.duration - item.currentTime) / 60)) : null;
	return {
		key: `cw-${item.type}-${item.title}`,
		href: playHref(item.title, item.type, null, item.season, item.episode),
		title: item.title,
		poster: item.posterUrl,
		meta: [episode, left !== null && left > 0 ? `${left} min left` : null].filter(Boolean).join(' · ') || 'Continue watching',
		overview,
		note: episode,
		progress: item.duration > 0 ? item.currentTime / item.duration : null
	};
}
