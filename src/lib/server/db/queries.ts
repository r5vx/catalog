import { db, plain, plainAll, toInt } from './index';
import type { Category, Entry, EntryCard } from './types';
import { titleKey } from '../../titleKey';

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
	yearFrom?: number | null;
	yearTo?: number | null;
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
		const needle = `%${options.search}%`;

		const words = options.search.trim().split(/\s+/).filter(Boolean);
		const nameMatch = words.map(() => 'p.name LIKE ?').join(' AND ') || '1 = 0';

		const stripped = options.search.replace(/[^a-zA-Z0-9\s]/g, '');
		const strippedNeedle = stripped ? `%${stripped.toLowerCase()}%` : null;
		const spacelessNeedle = stripped ? `%${stripped.replace(/\s+/g, '').toLowerCase()}%` : null;

		where.push(`(
			e.title LIKE ? OR e.notes LIKE ?
			${strippedNeedle ? "OR lower(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(e.title, '-', ''), ':', ''), '.', ''), '''', ''), ' ', '')) LIKE ?" : ''}
			OR e.id IN (
				SELECT ec.entry_id FROM entry_cast ec
				JOIN people p ON p.id = ec.person_id
				WHERE ${nameMatch}
			)
		)`);
		params.push(needle, needle);
		if (spacelessNeedle) params.push(spacelessNeedle);
		params.push(...words.map((w) => `%${w}%`));
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

	if (options.yearFrom) {
		where.push('e.year >= ?');
		params.push(options.yearFrom);
	}
	if (options.yearTo) {
		where.push('e.year <= ?');
		params.push(options.yearTo);
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

export function completedCount(): number {
	const row = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE status = 'completed'").get() as { n: number };
	return row.n;
}

export function completedByCategory(): Record<number, number> {
	const rows = db
		.prepare("SELECT category_id AS categoryId, COUNT(*) AS n FROM entries WHERE status = 'completed' GROUP BY category_id")
		.all() as { categoryId: number; n: number }[];
	return Object.fromEntries(rows.map((row) => [row.categoryId, row.n]));
}

/* -------------------------------------------------------- shared catalogs */

export type SharedCatalog = {
	id: number;
	name: string;
	titlesCount: number;
	importedAt: string;
};

export function listSharedCatalogs(): SharedCatalog[] {
	return plainAll<SharedCatalog>(
		db.prepare('SELECT id, name, titles_count AS titlesCount, imported_at AS importedAt FROM shared_catalogs ORDER BY imported_at DESC').all()
	);
}

export function sharedCatalogCount(): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM shared_catalogs').get() as { n: number }).n;
}

export function getSharedCatalog(id: number): { name: string; data: string } | null {
	const row = db.prepare('SELECT name, data FROM shared_catalogs WHERE id = ?').get(id) as { name: string; data: string } | undefined;
	return row ?? null;
}

export function importSharedCatalog(name: string, data: string, titlesCount: number): number {
	const now = new Date().toISOString();
	const result = db.prepare('INSERT INTO shared_catalogs (name, data, titles_count, imported_at) VALUES (?, ?, ?, ?)').run(name, data, titlesCount, now);
	return Number(result.lastInsertRowid);
}

export function removeSharedCatalog(id: number): void {
	db.prepare('DELETE FROM shared_catalogs WHERE id = ?').run(id);
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

export function existingSourceKeysWithIds(): Record<string, number> {
	const rows = db
		.prepare('SELECT id, source, source_id AS sourceId FROM entries WHERE source_id IS NOT NULL')
		.all() as { id: number; source: string; sourceId: string }[];

	const map: Record<string, number> = {};
	for (const row of rows) map[`${row.source}:${row.sourceId}`] = row.id;

	// Browse and search show one card per show (its first season), so owning any season counts.
	const roots = db
		.prepare(`
			SELECT e.id, r.root FROM entries e
			JOIN anime_roots r ON r.id = CAST(e.source_id AS INTEGER)
			WHERE e.source = 'anilist' AND r.root != r.id
		`)
		.all() as { id: number; root: number }[];
	for (const row of roots) map[`anilist:${row.root}`] ??= row.id;

	// The same title and year from the other site (an AniList result for a TMDB entry).
	const titled = db.prepare('SELECT id, title, year FROM entries WHERE year IS NOT NULL').all() as { id: number; title: string; year: number }[];
	for (const row of titled) map[titleKey(row.title, row.year)] ??= row.id;
	return map;
}

/** Each library entry's poster, by its id: what a search result shows when it's in the library. */
export function libraryPosters(): Record<number, string> {
	const rows = db.prepare("SELECT id, poster_url AS poster FROM entries WHERE poster_url IS NOT NULL AND poster_url != ''").all() as {
		id: number;
		poster: string;
	}[];
	return Object.fromEntries(rows.map((r) => [r.id, r.poster]));
}

/** A library entry with exactly this title and year, from either site. */
export function entryIdByTitle(title: string, year: number | string | null | undefined): number | null {
	if (!title || !year) return null;
	return existingSourceKeysWithIds()[titleKey(title, year)] ?? null;
}

/** Owned entry for any season of the same show, if there is one. */
export function entryIdForShow(rootId: number): number | null {
	const row = db
		.prepare(`
			SELECT e.id FROM entries e
			LEFT JOIN anime_roots r ON r.id = CAST(e.source_id AS INTEGER)
			WHERE e.source = 'anilist' AND (e.source_id = ? OR r.root = ?)
			ORDER BY (e.source_id = ?) DESC, e.id
			LIMIT 1
		`)
		.get(String(rootId), rootId, String(rootId)) as { id: number } | undefined;
	return row?.id ?? null;
}

export function myWatchOrders(): { id: string; name: string }[] {
	return db.prepare('SELECT id, name FROM my_watch_orders ORDER BY added_at').all() as { id: string; name: string }[];
}

export function addWatchOrder(id: string, name: string): void {
	db.prepare('INSERT INTO my_watch_orders (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(id, name);
}

export function removeWatchOrder(id: string): void {
	db.prepare('DELETE FROM my_watch_orders WHERE id = ?').run(id);
}

export function getOrderCache(key: string): { value: unknown; at: number } | undefined {
	const row = db.prepare('SELECT value, saved_at AS at FROM watch_order_cache WHERE key = ?').get(key) as
		| { value: string; at: number }
		| undefined;
	return row ? { value: JSON.parse(row.value), at: row.at } : undefined;
}

export function saveOrderCache(key: string, value: unknown, at: number): void {
	db.prepare(
		'INSERT INTO watch_order_cache (key, value, saved_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, saved_at = excluded.saved_at'
	).run(key, JSON.stringify(value), at);
}

/* ---------------------------------------------------------------- saved subtitles */

export function savedSubtitle(url: string): string | undefined {
	const row = db.prepare('SELECT content FROM saved_subtitles WHERE url = ?').get(url) as { content: string } | undefined;
	return row?.content;
}

export function saveSubtitle(url: string, show: string, content: string): void {
	db.prepare(
		'INSERT INTO saved_subtitles (url, show, content) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET show = excluded.show, content = excluded.content'
	).run(url, show, content);
}

/**
 * Lets go of the subtitles kept for shows that are done with: marked completed in the library,
 * not watched for 7 days, or taken off Continue Watching. Watching it again fetches them anew.
 */
export function forgetFinishedSubtitles(): void {
	try {
		db.exec(`
			DELETE FROM saved_subtitles WHERE show IN (
				SELECT s.show FROM (SELECT DISTINCT show FROM saved_subtitles) s
				WHERE EXISTS (
						SELECT 1 FROM entries e WHERE lower(e.title) = lower(s.show) AND e.status = 'completed'
					)
					OR COALESCE(
						(SELECT max(w.updated_at) FROM watch_progress w WHERE lower(w.title) = lower(s.show)),
						(SELECT min(x.saved_at) FROM saved_subtitles x WHERE x.show = s.show)
					) < datetime('now', '-7 days')
					OR EXISTS (
						SELECT 1 FROM continue_hidden h
						WHERE lower(h.title) = lower(s.show)
							AND h.hidden_at >= COALESCE((SELECT max(w.updated_at) FROM watch_progress w WHERE lower(w.title) = lower(s.show)), '')
					)
			)
		`);
	} catch (e) {
		console.error('[forgetFinishedSubtitles]', e);
	}
}

export function skippedTitles(): Set<string> {
	const rows = db.prepare('SELECT item_key AS itemKey FROM skipped_titles').all() as { itemKey: string }[];
	return new Set(rows.map((r) => r.itemKey));
}

export function setTitleSkipped(itemKey: string, skipped: boolean): void {
	if (skipped) db.prepare('INSERT INTO skipped_titles (item_key) VALUES (?) ON CONFLICT DO NOTHING').run(itemKey);
	else db.prepare('DELETE FROM skipped_titles WHERE item_key = ?').run(itemKey);
}

export function watchedExtras(): Set<string> {
	const rows = db.prepare('SELECT source_id AS sourceId FROM watched_extras').all() as { sourceId: string }[];
	return new Set(rows.map((r) => r.sourceId));
}

export function setExtraWatched(sourceId: string, watched: boolean): void {
	if (watched) db.prepare('INSERT INTO watched_extras (source_id) VALUES (?) ON CONFLICT DO NOTHING').run(sourceId);
	else db.prepare('DELETE FROM watched_extras WHERE source_id = ?').run(sourceId);
}

export function savedAnimeRoots(ids: number[]): Map<number, number> {
	const map = new Map<number, number>();
	if (ids.length === 0) return map;
	const rows = db
		.prepare(`SELECT id, root FROM anime_roots WHERE checked_at > datetime('now', '-30 days') AND id IN (${ids.map(() => '?').join(',')})`)
		.all(...ids) as { id: number; root: number }[];
	for (const row of rows) map.set(row.id, row.root);
	return map;
}

export function saveAnimeRoots(roots: Map<number, number>) {
	const insert = db.prepare(`
		INSERT INTO anime_roots (id, root, checked_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET root = excluded.root, checked_at = excluded.checked_at
	`);
	for (const [id, root] of roots) insert.run(id, root);
}

/* -------------------------------------------------------------------- writing */

type EntryInput = {
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

export function markEntryCompleted(id: number): void {
	db.prepare('UPDATE entries SET status = ?, finished_on = ?, updated_at = ? WHERE id = ?')
		.run('completed', new Date().toISOString().slice(0, 10), new Date().toISOString(), id);
}

export function incrementRewatches(id: number): void {
	db.prepare('UPDATE entries SET rewatches = rewatches + 1, updated_at = ? WHERE id = ?')
		.run(new Date().toISOString(), id);
}

export function updateEntrySource(id: number, source: string, sourceId: string): void {
	db.prepare('UPDATE entries SET source = ?, source_id = ?, updated_at = ? WHERE id = ?')
		.run(source, sourceId, new Date().toISOString(), id);
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

export function findEntryByTitle(title: string): { id: number; status: string; posterUrl: string; lastSeason: number; lastEpisode: number } | null {
	const row = db
		.prepare('SELECT id, status, poster_url AS posterUrl, last_season AS lastSeason, last_episode AS lastEpisode FROM entries WHERE title = ? COLLATE NOCASE LIMIT 1')
		.get(title) as { id: number; status: string; posterUrl: string; lastSeason: number; lastEpisode: number } | undefined;
	return row ? { ...row } : null;
}

interface WatchProgress {
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
	subFileName?: string,
	posterUrl?: string,
	shareKey?: string,
	fid?: number
): void {
	// No length yet (duration 0) is "started this episode": it moves to the front of Continue
	// Watching, but a place already saved in it is kept.
	db.prepare(`
		INSERT INTO watch_progress (title, type, season, episode, current_time, duration, sub_url, sub_delay, sub_file_name, poster_url, share_key, fid, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (title, type, season, episode)
		DO UPDATE SET
			current_time = CASE WHEN excluded.duration > 0 THEN excluded.current_time ELSE watch_progress.current_time END,
			duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE watch_progress.duration END,
			sub_url = CASE WHEN excluded.duration > 0 THEN excluded.sub_url ELSE watch_progress.sub_url END,
			sub_delay = CASE WHEN excluded.duration > 0 THEN excluded.sub_delay ELSE watch_progress.sub_delay END,
			sub_file_name = CASE WHEN excluded.duration > 0 THEN excluded.sub_file_name ELSE watch_progress.sub_file_name END,
			poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE watch_progress.poster_url END,
			share_key = CASE WHEN excluded.share_key != '' THEN excluded.share_key ELSE watch_progress.share_key END,
			fid = CASE WHEN excluded.fid != 0 THEN excluded.fid ELSE watch_progress.fid END,
			updated_at = excluded.updated_at
	`).run(title, type, season, episode, currentTime, duration, subUrl ?? '', subDelay ?? 0, subFileName ?? '', posterUrl ?? '', shareKey ?? '', fid ?? 0);
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

export interface SavedShowboxMatch {
	showboxId: number;
	title: string;
	type: string;
	posterUrl: string;
	shareKey: string;
	startSeason: number;
}

/** A remembered Showbox match, if it's under 30 days old. */
export function getSavedShowboxMatch(lookup: string): SavedShowboxMatch | null {
	const row = db
		.prepare(`
			SELECT showbox_id AS showboxId, title, type, poster_url AS posterUrl,
			       share_key AS shareKey, start_season AS startSeason
			FROM showbox_matches
			WHERE lookup = ? AND saved_at > datetime('now', '-30 days')
		`)
		.get(lookup);
	return row ? plain<SavedShowboxMatch>(row) : null;
}

export function saveShowboxMatch(lookup: string, match: SavedShowboxMatch) {
	db.prepare(`
		INSERT INTO showbox_matches (lookup, showbox_id, title, type, poster_url, share_key, start_season, saved_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(lookup) DO UPDATE SET
			showbox_id = excluded.showbox_id, title = excluded.title, type = excluded.type,
			poster_url = excluded.poster_url, share_key = excluded.share_key,
			start_season = excluded.start_season, saved_at = excluded.saved_at
	`).run(lookup, match.showboxId, match.title, match.type, match.posterUrl, match.shareKey, match.startSeason);
}

export function forgetShowboxMatch(lookup: string) {
	db.prepare('DELETE FROM showbox_matches WHERE lookup = ?').run(lookup);
}

export function getCachedStreamInfo(title: string, type: string): { shareKey: string; fid: number } | null {
	const row = db
		.prepare("SELECT share_key AS shareKey, fid FROM watch_progress WHERE title = ? AND type = ? AND share_key != '' AND fid != 0 ORDER BY updated_at DESC LIMIT 1")
		.get(title, type) as { shareKey: string; fid: number } | undefined;
	return row ?? null;
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

export function continueWatchingList(): (WatchProgress & { updatedAt: string; posterUrl: string | null; entryId: number | null; entryStatus: string | null })[] {
	cleanupCompletedProgress();
	try {
		return db
			.prepare(`
				SELECT w.title, w.type, w.season, w.episode, w."current_time" AS currentTime, w.duration, w.updated_at AS updatedAt,
						-- The library entry with the same name; for a show, one whose name starts the other's
						-- ("Kaiju No. 8" for "Kaiju No. 8 Season 2"). Never a name found somewhere inside
						-- another: "Re:ZERO … The Frozen Bond" took Disney's Frozen's poster that way.
						COALESCE(
							(SELECT e.poster_url FROM entries e WHERE lower(e.title) = lower(w.title) LIMIT 1),
							(SELECT e.poster_url FROM entries e WHERE w.type = 'tv' AND (instr(lower(e.title), lower(w.title)) = 1 OR instr(lower(w.title), lower(e.title)) = 1) LIMIT 1),
							NULLIF(w.poster_url, '')
						) AS posterUrl,
						COALESCE(
							(SELECT e.id FROM entries e WHERE lower(e.title) = lower(w.title) LIMIT 1),
							(SELECT e.id FROM entries e WHERE w.type = 'tv' AND (instr(lower(e.title), lower(w.title)) = 1 OR instr(lower(w.title), lower(e.title)) = 1) LIMIT 1)
						) AS entryId,
						COALESCE(
							(SELECT e.status FROM entries e WHERE lower(e.title) = lower(w.title) LIMIT 1),
							(SELECT e.status FROM entries e WHERE w.type = 'tv' AND (instr(lower(e.title), lower(w.title)) = 1 OR instr(lower(w.title), lower(e.title)) = 1) LIMIT 1)
						) AS entryStatus
				FROM watch_progress w
				WHERE w.rowid = (
					SELECT w2.rowid FROM watch_progress w2
					WHERE w2.title = w.title AND w2.type = w.type
					ORDER BY w2.updated_at DESC, w2.season DESC, w2.episode DESC
					LIMIT 1
				)
				AND (
					w.type = 'tv'
					OR (w.type = 'movie' AND w.duration > 0 AND w."current_time" > 30 AND (CAST(w."current_time" AS REAL) / w.duration) < 0.95)
				)
				-- Hidden until it's watched again after being removed.
				AND NOT EXISTS (
					SELECT 1 FROM continue_hidden h
					WHERE h.title = w.title AND h.type = w.type AND h.hidden_at >= w.updated_at
				)
				ORDER BY w.updated_at DESC
				LIMIT 20
			`)
			.all() as unknown as (WatchProgress & { updatedAt: string; posterUrl: string | null; entryId: number | null; entryStatus: string | null })[];
	} catch (e) {
		console.error('[continueWatchingList]', e);
		return [];
	}
}

export function hideFromContinueWatching(title: string, type: string): void {
	db.prepare(`
		INSERT INTO continue_hidden (title, type, hidden_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT (title, type) DO UPDATE SET hidden_at = excluded.hidden_at
	`).run(title, type);
}

export function deleteTitleProgress(title: string, type: string): void {
	db.prepare('DELETE FROM watch_progress WHERE title = ? AND type = ?').run(title, type);
}

/**
 * Ticks episodes off (or back on) by hand, from the player's episode list. Only the position
 * changes — subtitles and delay saved for an episode stay. "Not watched" keeps the row at the
 * start rather than deleting it, so nothing else saved for it is lost.
 */
export function markEpisodes(title: string, episodes: { season: number; episode: number }[], watched: boolean): void {
	const upsert = db.prepare(`
		INSERT INTO watch_progress (title, type, season, episode, current_time, duration, sub_url, sub_delay, sub_file_name, poster_url, share_key, fid, updated_at)
		VALUES (?, 'tv', ?, ?, ?, 1, '', 0, '', '', '', 0, datetime('now'))
		ON CONFLICT (title, type, season, episode)
		DO UPDATE SET current_time = CASE WHEN ? THEN MAX(watch_progress.duration, 1) ELSE 0 END,
			duration = MAX(watch_progress.duration, 1),
			updated_at = CASE WHEN ? THEN datetime('now') ELSE watch_progress.updated_at END
	`);
	db.exec('BEGIN');
	try {
		for (const { season, episode } of episodes) {
			upsert.run(title, season, episode, watched ? 1 : 0, watched ? 1 : 0, watched ? 1 : 0);
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

export function watchedEpisodesForTitle(title: string): { season: number; episode: number; pct: number }[] {
	return db
		.prepare(`SELECT season, episode, CAST("current_time" AS REAL) / duration AS pct
			FROM watch_progress WHERE title = ? AND type = 'tv' AND duration > 0`)
		.all(title) as { season: number; episode: number; pct: number }[];
}

export function updateSeasonEpisodeReached(id: number, season: number, episode: number): void {
	db.prepare('UPDATE entries SET last_season = ?, last_episode = ?, updated_at = ? WHERE id = ?')
		.run(season, episode, new Date().toISOString(), id);
}

function cleanupCompletedProgress(): void {
	db.prepare("DELETE FROM watch_progress WHERE type = 'movie' AND duration > 0 AND (CAST(\"current_time\" AS REAL) / duration) >= 0.93").run();
}

export function listAllWatchProgressFull(): (WatchProgress & { updatedAt: string })[] {
	cleanupCompletedProgress();
	return db
		.prepare('SELECT title, type, season, episode, "current_time" AS currentTime, duration, sub_url AS subUrl, sub_delay AS subDelay, sub_file_name AS subFileName, updated_at AS updatedAt FROM watch_progress ORDER BY updated_at DESC')
		.all() as unknown as (WatchProgress & { updatedAt: string })[];
}
