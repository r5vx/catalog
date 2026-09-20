import { db, plain, plainAll, toInt } from './index';
import type { Category, Entry, EntryCard } from './types';

/**
 * Every database query in the app lives here, as plain SQL. If you want to
 * change what the library shows or how it's ordered, this is the file.
 */

/** As it comes out of SQLite, where booleans are still 0 and 1. */
type Stored<T extends { favorite: boolean }> = Omit<T, 'favorite'> & { favorite: number };

// The columns of `entries`, aliased to the names the rest of the app uses.
const ENTRY_COLUMNS = `
	id,
	category_id      AS categoryId,
	title,
	year,
	status,
	rating,
	rewatches,
	favorite,
	notes,
	started_on       AS startedOn,
	finished_on      AS finishedOn,
	poster_url       AS posterUrl,
	overview,
	source,
	source_id        AS sourceId,
	runtime_minutes  AS runtimeMinutes,
	episodes_total   AS episodesTotal,
	episodes_watched AS episodesWatched,
	external_rating  AS externalRating,
	external_votes   AS externalVotes,
	last_season      AS lastSeason,
	last_episode     AS lastEpisode,
	show_status      AS showStatus,
	season_counts    AS seasonCounts,
	next_air_date    AS nextAirDate,
	checked_at       AS checkedAt,
	imdb_id          AS imdbId,
	imdb_rating      AS imdbRating,
	imdb_votes       AS imdbVotes,
	rt_score         AS rtScore,
	metascore,
	content_rating   AS contentRating,
	awards,
	box_office       AS boxOffice,
	scores_checked_at AS scoresCheckedAt,
	details_checked_at AS detailsCheckedAt,
	providers,
	providers_checked_at AS providersCheckedAt,
	created_at       AS createdAt,
	updated_at       AS updatedAt
`;

/* ----------------------------------------------------------------- categories */

export function listCategories(): Category[] {
	return plainAll<Category>(
		db
			.prepare('SELECT id, name, slug, emoji, sort_order AS sortOrder FROM categories ORDER BY sort_order')
			.all()
	);
}

export function categoryIdForSlug(slug: string): number {
	const match = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug) as
		| { id: number }
		| undefined;

	if (match) return match.id;

	const first = db.prepare('SELECT id FROM categories ORDER BY sort_order LIMIT 1').get() as {
		id: number;
	};
	return first.id;
}

/* -------------------------------------------------------------------- reading */

type ListOptions = {
	search?: string;
	categoryId?: number | null;
	status?: string;
	tagIds?: number[];
	/** Must be one of SORT_COLUMNS below — never raw user input. */
	sortColumn?: string;
	sortDir?: 'asc' | 'desc';
};

/** Only these columns can be sorted on, so the sort value can't inject SQL. */
const SORT_COLUMNS: Record<string, string> = {
	created_at: 'e.created_at',
	updated_at: 'e.updated_at',
	rating: 'e.rating',
	title: 'e.title',
	year: 'e.year',
	rewatches: 'e.rewatches',
	finished_on: 'e.finished_on',
	external_rating: 'e.external_rating',
	external_votes: 'e.external_votes',
	runtime_minutes: 'e.runtime_minutes',
	// Filled in from OMDb, so these are null until a title has been looked up.
	imdb_rating: 'e.imdb_rating',
	rt_score: 'e.rt_score',
	metascore: 'e.metascore',
	box_office: 'e.box_office'
};

export function listEntries(options: ListOptions = {}): EntryCard[] {
	const where: string[] = [];
	const params: (string | number)[] = [];

	if (options.search) {
		// Titles, your own notes, and who's in it — so typing an actor's name
		// finds everything of theirs you've watched.
		const needle = `%${options.search}%`;

		// Cast names match word by word, so "samuel jackson" finds
		// "Samuel L. Jackson" despite the middle initial.
		const words = options.search.trim().split(/\s+/).filter(Boolean);
		const nameMatch = words.map(() => 'p.name LIKE ?').join(' AND ') || '1 = 0';

		where.push(`(
			e.title LIKE ? OR e.notes LIKE ?
			OR e.id IN (
				SELECT ec.entry_id FROM entry_cast ec
				JOIN people p ON p.id = ec.person_id
				WHERE ${nameMatch}
			)
		)`);
		params.push(needle, needle, ...words.map((w) => `%${w}%`));
	}

	if (options.categoryId) {
		where.push('e.category_id = ?');
		params.push(options.categoryId);
	}

	if (options.status) {
		where.push('e.status = ?');
		params.push(options.status);
	}

	// Every selected tag must apply, so filters narrow rather than widen.
	for (const tagId of options.tagIds ?? []) {
		where.push('e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?)');
		params.push(tagId);
	}

	const column = SORT_COLUMNS[options.sortColumn ?? 'created_at'] ?? 'e.created_at';
	const direction = options.sortDir === 'asc' ? 'ASC' : 'DESC';

	/**
	 * Two things matter here beyond the column itself.
	 *
	 * Unrated entries sort LAST rather than mixing in — "highest rated" should
	 * show what you've actually rated, not a wall of blanks.
	 *
	 * And ties break on title. Without it, everything unrated tied with
	 * everything else and the database fell back to insertion order — which,
	 * after an alphabetical import, looked exactly like sorting alphabetically
	 * and made the sort appear broken.
	 */
	const ordering = `(${column} IS NULL) ASC, ${column} ${direction}, e.title ASC`;

	const sql = `
		SELECT
			e.id,
			e.title,
			e.year,
			e.status,
			e.rating,
			e.rewatches,
			e.favorite,
			e.poster_url AS posterUrl,
			e.external_rating AS externalRating,
			e.external_votes  AS externalVotes,
			e.last_season AS lastSeason,
			e.last_episode AS lastEpisode,
			e.episodes_total AS episodesTotal,
			e.show_status AS showStatus,
			e.season_counts AS seasonCounts,
			e.next_air_date AS nextAirDate,
			e.runtime_minutes AS runtimeMinutes,
			e.box_office      AS boxOffice,
			e.imdb_rating     AS imdbRating,
			e.rt_score        AS rtScore,
			e.metascore,
			e.created_at  AS createdAt,
			e.updated_at  AS updatedAt,
			e.finished_on AS finishedOn,
			e.category_id AS categoryId,
			c.name  AS categoryName,
			c.emoji AS categoryEmoji
		FROM entries e
		JOIN categories c ON c.id = e.category_id
		${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		ORDER BY ${ordering}
		LIMIT 1000
	`;

	const rows = plainAll<Stored<EntryCard>>(db.prepare(sql).all(...params));
	return rows.map((row) => ({ ...row, favorite: Boolean(row.favorite) }));
}

export function countsByCategory(): Record<number, number> {
	const rows = db
		.prepare('SELECT category_id AS categoryId, COUNT(*) AS n FROM entries GROUP BY category_id')
		.all() as { categoryId: number; n: number }[];

	return Object.fromEntries(rows.map((row) => [row.categoryId, row.n]));
}

export function getEntry(id: number): Entry | null {
	const row = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`).get(id);
	if (!row) return null;

	const entry = plain<Stored<Entry>>(row);
	return { ...entry, favorite: Boolean(entry.favorite) };
}

/** Used by the importer to avoid adding the same thing twice. */
export function existingSourceKeys(): Set<string> {
	const rows = db
		.prepare('SELECT source, source_id AS sourceId FROM entries WHERE source_id IS NOT NULL')
		.all() as { source: string; sourceId: string }[];

	return new Set(rows.map((row) => `${row.source}:${row.sourceId}`));
}

/* -------------------------------------------------------------------- writing */

export type EntryInput = {
	categoryId: number;
	title: string;
	year?: number | null;
	status?: string;
	rating?: number | null;
	rewatches?: number;
	favorite?: boolean;
	notes?: string;
	startedOn?: string | null;
	finishedOn?: string | null;
	posterUrl?: string | null;
	overview?: string | null;
	source?: string;
	sourceId?: string | null;
	runtimeMinutes?: number | null;
	episodesTotal?: number | null;
	externalRating?: number | null;
	externalVotes?: number | null;
	lastSeason?: number | null;
	lastEpisode?: number | null;
};

export function insertEntry(input: EntryInput): number {
	const now = new Date().toISOString();

	const result = db
		.prepare(
			`INSERT INTO entries (
				category_id, title, year, status, rating, rewatches, favorite, notes,
				started_on, finished_on, poster_url, overview, source, source_id,
				runtime_minutes, episodes_total, external_rating, external_votes,
				last_season, last_episode, created_at, updated_at
			) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
		)
		.run(
			input.categoryId,
			input.title,
			input.year ?? null,
			input.status ?? 'completed',
			input.rating ?? null,
			input.rewatches ?? 0,
			toInt(input.favorite ?? false),
			input.notes ?? '',
			input.startedOn ?? null,
			input.finishedOn ?? null,
			input.posterUrl ?? null,
			input.overview ?? null,
			input.source ?? 'manual',
			input.sourceId ?? null,
			input.runtimeMinutes ?? null,
			input.episodesTotal ?? null,
			input.externalRating ?? null,
			input.externalVotes ?? null,
			input.lastSeason ?? null,
			input.lastEpisode ?? null,
			now,
			now
		);

	return Number(result.lastInsertRowid);
}

export function updateEntry(id: number, input: EntryInput): void {
	db.prepare(
		`UPDATE entries SET
			category_id = ?, title = ?, year = ?, status = ?, rating = ?, rewatches = ?,
			favorite = ?, notes = ?, started_on = ?, finished_on = ?, poster_url = ?,
			last_season = ?, last_episode = ?, updated_at = ?
		WHERE id = ?`
	).run(
		input.categoryId,
		input.title,
		input.year ?? null,
		input.status ?? 'completed',
		input.rating ?? null,
		input.rewatches ?? 0,
		toInt(input.favorite ?? false),
		input.notes ?? '',
		input.startedOn ?? null,
		input.finishedOn ?? null,
		input.posterUrl ?? null,
		input.lastSeason ?? null,
		input.lastEpisode ?? null,
		new Date().toISOString(),
		id
	);
}

export function deleteEntry(id: number): void {
	db.prepare('DELETE FROM entries WHERE id = ?').run(id);
}

/* --------------------------------------------------------------- exporting */

/**
 * A whole row, flattened for export: the category and tags come out as their
 * names, not ids, so the file makes sense on its own in a spreadsheet or on
 * paper. Unlike `listEntries` there is no limit — an export is everything.
 */
export type ExportRow = {
	title: string;
	year: number | null;
	category: string;
	status: string;
	rating: number | null;
	externalRating: number | null;
	rewatches: number;
	favorite: number;
	startedOn: string | null;
	finishedOn: string | null;
	lastSeason: number | null;
	lastEpisode: number | null;
	episodesTotal: number | null;
	tags: string | null;
	notes: string | null;
	addedOn: string;
	posterUrl: string | null;
	imdbRating: number | null;
	rtScore: number | null;
	metascore: number | null;
	/**
	 * Which database it came from, and its id there.
	 *
	 * Not for the spreadsheet — for the share file. Without them a shared list
	 * is only text, and nothing in it can be opened, read about or added; with
	 * them every title someone sends you is a title you can look into.
	 */
	source: string;
	sourceId: string | null;
	runtimeMinutes: number | null;
	boxOffice: number | null;
	externalVotes: number | null;
};

export function listForExport(
	options: {
		categoryId?: number | null;
		status?: string;
		sortColumn?: string;
		sortDir?: 'asc' | 'desc';
	} = {}
): ExportRow[] {
	const where: string[] = [];
	const params: (string | number)[] = [];

	if (options.categoryId) {
		where.push('e.category_id = ?');
		params.push(options.categoryId);
	}

	if (options.status) {
		where.push('e.status = ?');
		params.push(options.status);
	}

	const column = SORT_COLUMNS[options.sortColumn ?? 'title'] ?? 'e.title';
	const direction = options.sortDir === 'asc' ? 'ASC' : 'DESC';

	// Category first, so a printed list comes out already grouped under its
	// own heading; the chosen sort then orders the titles within each group.
	const ordering = `c.sort_order ASC, (${column} IS NULL) ASC, ${column} ${direction}, e.title ASC`;

	const sql = `
		SELECT
			e.title,
			e.year,
			c.name AS category,
			e.status,
			e.rating,
			e.external_rating AS externalRating,
			e.rewatches,
			e.favorite,
			e.started_on  AS startedOn,
			e.finished_on AS finishedOn,
			e.last_season   AS lastSeason,
			e.last_episode  AS lastEpisode,
			e.episodes_total AS episodesTotal,
			(
				SELECT group_concat(t.name, ', ')
				FROM entry_tags et JOIN tags t ON t.id = et.tag_id
				WHERE et.entry_id = e.id
			) AS tags,
			e.notes,
			e.created_at AS addedOn,
			e.poster_url AS posterUrl,
			e.imdb_rating AS imdbRating,
			e.rt_score    AS rtScore,
			e.metascore,
			e.source,
			e.source_id       AS sourceId,
			e.runtime_minutes AS runtimeMinutes,
			e.box_office      AS boxOffice,
			e.external_votes  AS externalVotes
		FROM entries e
		JOIN categories c ON c.id = e.category_id
		${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		ORDER BY ${ordering}
	`;

	return plainAll<ExportRow>(db.prepare(sql).all(...params));
}

/* ------------------------------------------------------------------- scores */

/**
 * Scores from IMDb, Rotten Tomatoes and Metacritic, saved against the entry.
 *
 * They're written once and read forever after: the page shows what's stored
 * instantly, and only asks OMDb again when the stamp is old. Nobody's IMDb
 * score moves enough to be worth a network round trip on every page view.
 */
export function saveScores(
	id: number,
	scores: {
		imdbId: string | null;
		imdbRating: number | null;
		imdbVotes: number | null;
		rtScore: number | null;
		metascore: number | null;
		contentRating: string | null;
		awards: string | null;
		boxOffice: number | null;
	}
): void {
	db.prepare(
		`UPDATE entries SET
			imdb_id = ?, imdb_rating = ?, imdb_votes = ?, rt_score = ?,
			metascore = ?, content_rating = ?, awards = ?, box_office = ?,
			scores_checked_at = ?
		 WHERE id = ?`
	).run(
		scores.imdbId,
		scores.imdbRating,
		scores.imdbVotes,
		scores.rtScore,
		scores.metascore,
		scores.contentRating,
		scores.awards,
		scores.boxOffice,
		new Date().toISOString(),
		id
	);
}

/** Fills in a synopsis for an older entry that was added before we kept one. */
export function saveOverview(id: number, overview: string): void {
	db.prepare('UPDATE entries SET overview = ? WHERE id = ?').run(overview, id);
}

/**
 * Runtime and episode counts, which the *search* endpoints don't return.
 *
 * TMDB gives a runtime only on the detail endpoint, so anything added by
 * search arrives without one — which is why sorting by "Longest" had nothing
 * to work with. Saved whenever details are fetched.
 *
 * `checked` says the database answered, which is not the same as it having
 * something to say. Plenty of titles have no runtime at all — a series TMDB
 * has no episode length for, a short nobody timed. Recording the *asking*
 * is what stops those being counted as missing for the rest of time.
 */
export function saveFacts(
	id: number,
	facts: { runtimeMinutes: number | null; episodesTotal: number | null; checked?: boolean }
): void {
	db.prepare(
		`UPDATE entries
		 SET runtime_minutes    = COALESCE(?, runtime_minutes),
		     episodes_total     = COALESCE(?, episodes_total),
		     details_checked_at = COALESCE(?, details_checked_at)
		 WHERE id = ?`
	).run(
		facts.runtimeMinutes,
		facts.episodesTotal,
		facts.checked ? new Date().toISOString() : null,
		id
	);
}

/** Where to stream something, kept so the page doesn't ask on every view. */
export function saveProviders(id: number, providers: string | null): void {
	db.prepare('UPDATE entries SET providers = ?, providers_checked_at = ? WHERE id = ?').run(
		providers,
		new Date().toISOString(),
		id
	);
}

/** Forget when the outside scores were last checked, so they're fetched again. */
export function clearScoreStamp(id: number): void {
	db.prepare('UPDATE entries SET scores_checked_at = NULL WHERE id = ?').run(id);
}

/** Whether something is already in the library, and which entry it is. */
export function entryIdForSource(source: string, sourceId: string): number | null {
	const row = db
		.prepare('SELECT id FROM entries WHERE source = ? AND source_id = ?')
		.get(source, sourceId) as { id: number } | undefined;

	return row?.id ?? null;
}

export function findEntryByTitle(title: string): { id: number; status: string } | null {
	const row = db
		.prepare('SELECT id, status FROM entries WHERE title = ? COLLATE NOCASE LIMIT 1')
		.get(title) as { id: number; status: string } | undefined;
	return row ? { ...row } : null;
}

export interface WatchProgress {
	title: string;
	type: string;
	season: number;
	episode: number;
	currentTime: number;
	duration: number;
	subUrl: string;
	subDelay: number;
	subFileName: string;
}

export function saveWatchProgress(
	title: string,
	type: string,
	season: number,
	episode: number,
	currentTime: number,
	duration: number,
	subUrl?: string,
	subDelay?: number,
	subFileName?: string
): void {
	db.prepare(`
		INSERT INTO watch_progress (title, type, season, episode, current_time, duration, sub_url, sub_delay, sub_file_name, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (title, type, season, episode)
		DO UPDATE SET current_time = excluded.current_time, duration = excluded.duration,
			sub_url = excluded.sub_url, sub_delay = excluded.sub_delay, sub_file_name = excluded.sub_file_name,
			updated_at = excluded.updated_at
	`).run(title, type, season, episode, currentTime, duration, subUrl ?? '', subDelay ?? 0, subFileName ?? '');
}

export function getWatchProgress(
	title: string,
	type: string,
	season: number,
	episode: number
): WatchProgress | null {
	const row = db
		.prepare('SELECT title, type, season, episode, "current_time" AS currentTime, duration, sub_url AS subUrl, sub_delay AS subDelay, sub_file_name AS subFileName FROM watch_progress WHERE title = ? AND type = ? AND season = ? AND episode = ?')
		.get(title, type, season, episode) as WatchProgress | undefined;
	return row ? { ...row } : null;
}

export function listAllWatchProgress(): (WatchProgress & { updatedAt: string })[] {
	return db
		.prepare('SELECT title, type, season, episode, "current_time" AS currentTime, duration, updated_at AS updatedAt FROM watch_progress ORDER BY updated_at DESC LIMIT 50')
		.all() as unknown as (WatchProgress & { updatedAt: string })[];
}

export function clearAllWatchProgress(): void {
	db.prepare('DELETE FROM watch_progress').run();
}

export function deleteWatchProgress(title: string, type: string, season: number, episode: number): void {
	db.prepare('DELETE FROM watch_progress WHERE title = ? AND type = ? AND season = ? AND episode = ?')
		.run(title, type, season, episode);
}

export function listAllWatchProgressFull(): (WatchProgress & { updatedAt: string })[] {
	return db
		.prepare('SELECT title, type, season, episode, "current_time" AS currentTime, duration, sub_url AS subUrl, sub_delay AS subDelay, sub_file_name AS subFileName, updated_at AS updatedAt FROM watch_progress ORDER BY updated_at DESC')
		.all() as unknown as (WatchProgress & { updatedAt: string })[];
}
