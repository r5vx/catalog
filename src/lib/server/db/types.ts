export type Category = {
	id: number;
	name: string;
	slug: string;
	emoji: string;
	sortOrder: number;
};

export type Entry = {
	id: number;
	categoryId: number;
	title: string;
	year: number | null;

	// Your own opinions — the part no database can give you.
	status: string;
	rating: number | null;
	rewatches: number;
	favorite: boolean;
	notes: string;

	startedOn: string | null;
	finishedOn: string | null;

	// Filled in from TMDB / AniList when you add something by search.
	posterUrl: string | null;
	overview: string | null;
	source: string;
	sourceId: string | null;
	runtimeMinutes: number | null;
	episodesTotal: number | null;
	episodesWatched: number | null;

	/** The public score out of 10, and how many people voted. */
	externalRating: number | null;
	externalVotes: number | null;

	/** How far you got: season 1, episode 23. Blank when you didn't say. */
	lastSeason: number | null;
	lastEpisode: number | null;

	/** Refreshed from the databases so we can spot new episodes. */
	showStatus: string | null;
	/** JSON like {"1":7,"2":13} — episodes per season. */
	seasonCounts: string | null;
	nextAirDate: string | null;
	checkedAt: string | null;

	/** Scores from everywhere else, via OMDb. Null until they're looked up. */
	imdbId: string | null;
	imdbRating: number | null;
	imdbVotes: number | null;
	/** Rotten Tomatoes, as a percentage. */
	rtScore: number | null;
	/** Metacritic, out of 100. */
	metascore: number | null;
	/** "PG-13", "TV-MA". */
	contentRating: string | null;
	awards: string | null;
	/** Worldwide gross in dollars. Films only. */
	boxOffice: number | null;
	scoresCheckedAt: string | null;

	/**
	 * When the detail endpoint last answered about this title.
	 *
	 * Not every title has a runtime or a synopsis to give — a five-minute short
	 * or an obscure series often has neither. Without this, those look
	 * identical to the ones that simply haven't been looked up, so they were
	 * counted as missing forever and asked about on every pass.
	 */
	detailsCheckedAt: string | null;

	/** Where to stream it, as stored JSON. See `metadata/providers.ts`. */
	providers: string | null;
	providersCheckedAt: string | null;

	createdAt: string;
	updatedAt: string;
};

/**
 * What a library card needs — deliberately less than a whole Entry, but it
 * does carry every value you can sort by, so the card can show the one you
 * sorted on without opening the title.
 */
export type EntryCard = Pick<
	Entry,
	| 'id' | 'title' | 'year' | 'status' | 'rating' | 'rewatches' | 'favorite' | 'posterUrl'
	| 'externalRating' | 'externalVotes' | 'lastSeason' | 'lastEpisode'
	| 'episodesTotal' | 'showStatus' | 'seasonCounts' | 'nextAirDate'
	| 'runtimeMinutes' | 'boxOffice' | 'imdbRating' | 'rtScore' | 'metascore'
	| 'createdAt' | 'updatedAt' | 'finishedOn'
> & {
	categoryId: number;
	categoryName: string;
	categoryEmoji: string;
};
