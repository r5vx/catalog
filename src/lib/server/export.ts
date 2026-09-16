import { db } from './db';
import { listCategories, listForExport } from './db/queries';
import { SORTS, statusLabel } from '$lib/constants';
import type { ExportRow } from './db/queries';

/**
 * Turning the library into a file you can keep, print or hand to someone.
 *
 * Three shapes, for three different reasons:
 *   csv   — opens in Excel, Numbers or Google Sheets
 *   text  — a plain list, the way it looked in the Notes app
 *   json  — the full backup, the one `npm run restore` can read back
 *
 * The printable version isn't here: it's a real page at `/export`, so it can
 * be styled, and your browser's "Save as PDF" does the rest.
 */

/* ------------------------------------------------------------------- shared */

/** A printed list reads best alphabetically, so that's the export default. */
const DEFAULT_SORT = SORTS.find((sort) => sort.value === 'title') ?? SORTS[0];

/**
 * Reads `?cat=`, `?status=` and `?sort=` — the same names the library uses —
 * so every export route asks for its rows the same way.
 */
export function rowsFor(url: URL) {
	const cat = url.searchParams.get('cat') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const sort = SORTS.find((option) => option.value === url.searchParams.get('sort')) ?? DEFAULT_SORT;
	const category = listCategories().find((one) => one.slug === cat) ?? null;

	return {
		rows: listForExport({
			categoryId: category?.id ?? null,
			status,
			sortColumn: sort.column,
			sortDir: sort.dir
		}),
		category,
		status,
		sort
	};
}

const ratingOf = (row: ExportRow) => (row.rating == null ? '' : `${row.rating}/10`);

/** "S2E7", or nothing when you never said where you got to. */
function episodeMark(row: ExportRow): string {
	if (row.lastSeason == null && row.lastEpisode == null) return '';
	const season = row.lastSeason == null ? '' : `S${row.lastSeason}`;
	const episode = row.lastEpisode == null ? '' : `E${row.lastEpisode}`;
	return season + episode;
}

/** A filename with the date in it, so two exports never overwrite each other. */
export function exportFilename(extension: string): string {
	return `catalog-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/* ---------------------------------------------------------------------- csv */

const CSV_COLUMNS = [
	'Title',
	'Year',
	'Category',
	'Status',
	'My rating',
	'Public rating',
	'Rewatches',
	'Favourite',
	'Left off',
	'Started',
	'Finished',
	'Added',
	'Tags',
	'Notes'
] as const;

function csvCell(value: unknown): string {
	const text = value == null ? '' : String(value);

	// A cell starting with a formula character is run as one by Excel and
	// Sheets. No real title begins with these, so a leading quote is safe.
	const safe = /^[=+@]/.test(text) ? `'${text}` : text;

	return /["\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ExportRow[]): string {
	const lines = [CSV_COLUMNS.join(',')];

	for (const row of rows) {
		lines.push(
			[
				row.title,
				row.year ?? '',
				row.category,
				statusLabel(row.status),
				row.rating ?? '',
				// TMDB gives three decimals; one is all anyone reads.
				row.externalRating == null ? '' : row.externalRating.toFixed(1),
				row.rewatches || '',
				row.favorite ? 'yes' : '',
				episodeMark(row),
				row.startedOn ?? '',
				row.finishedOn ?? '',
				(row.addedOn ?? '').slice(0, 10),
				row.tags ?? '',
				row.notes ?? ''
			]
				.map(csvCell)
				.join(',')
		);
	}

	// Excel reads a plain UTF-8 file as Latin-1 and mangles every accent unless
	// the file starts with a byte-order mark.
	return '﻿' + lines.join('\r\n') + '\r\n';
}

/* --------------------------------------------------------------------- text */

const longDate = (date: Date) =>
	date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function toText(rows: ExportRow[]): string {
	const out: string[] = [`Catalog — ${longDate(new Date())}`, `${rows.length} titles`, ''];

	// Rows arrive already grouped by category, so a heading goes in whenever
	// the category changes rather than needing a second pass.
	let current = '';
	let number = 0;

	for (const row of rows) {
		if (row.category !== current) {
			current = row.category;
			number = 0;
			const count = rows.filter((other) => other.category === current).length;
			out.push('', `${current.toUpperCase()} · ${count}`, '─'.repeat(28));
		}

		number += 1;

		const parts = [`${String(number).padStart(3, ' ')}. ${row.title}`];
		if (row.year) parts.push(`(${row.year})`);

		const trailing: string[] = [];
		const rating = ratingOf(row);
		if (rating) trailing.push(rating);

		const mark = episodeMark(row);
		if (mark) trailing.push(mark);

		// Completed is the common case and saying so on every line is noise.
		if (row.status !== 'completed') trailing.push(statusLabel(row.status));
		if (row.rewatches) trailing.push(`×${row.rewatches + 1}`);

		out.push(parts.join(' ') + (trailing.length ? ` — ${trailing.join(' · ')}` : ''));
	}

	return out.join('\r\n') + '\r\n';
}

/* --------------------------------------------------------------------- json */

const allRows = (sql: string) =>
	(db.prepare(sql).all() as Record<string, unknown>[]).map((row) => ({ ...row }));

/**
 * Everything, in the same shape `scripts/backup.mjs` writes — so a file saved
 * from the app can be restored with `npm run restore`, and so moving to a new
 * PC is one download and one restore.
 *
 * The `settings` table is deliberately left out. It holds the TMDB key, and
 * this file is meant to be shareable.
 */
export function fullExport() {
	return {
		exportedAt: new Date().toISOString(),
		formatVersion: 1,
		categories: allRows('SELECT * FROM categories ORDER BY id'),
		entries: allRows('SELECT * FROM entries ORDER BY id'),
		tags: allRows('SELECT * FROM tags ORDER BY id'),
		entryTags: allRows('SELECT * FROM entry_tags ORDER BY entry_id, tag_id'),
		notes: allRows('SELECT * FROM notes ORDER BY id'),
		people: allRows('SELECT * FROM people ORDER BY id'),
		entryCast: allRows('SELECT * FROM entry_cast ORDER BY entry_id, ord')
	};
}

/* -------------------------------------------------------------- sharing */

/**
 * A copy of your library made to hand to someone else.
 *
 * Deliberately not the full backup: no ids, no note pages, no settings, and
 * your own ratings and reviews only if you say so. What's left is the list
 * itself — what you watched and what the world scored it — which is the part
 * worth comparing.
 */
export function shareExport(options: { ratings: boolean; notes: boolean; from?: string }) {
	const rows = listForExport({ sortColumn: 'title', sortDir: 'asc' });

	return {
		catalogShare: 1,
		sharedAt: new Date().toISOString(),
		from: options.from?.trim() || null,
		includes: { ratings: options.ratings, notes: options.notes },
		titles: rows.map((row) => ({
			title: row.title,
			year: row.year,
			category: row.category,
			status: row.status,
			posterUrl: row.posterUrl,
			externalRating: row.externalRating,
			imdbRating: row.imdbRating,
			rtScore: row.rtScore,
			metascore: row.metascore,
			tags: row.tags ? row.tags.split(', ') : [],
			...(options.ratings
				? { rating: row.rating, favorite: Boolean(row.favorite), rewatches: row.rewatches }
				: {}),
			...(options.notes && row.notes ? { notes: row.notes } : {})
		}))
	};
}

/** Named so nobody confuses a share file with a restorable backup. */
export function shareFilename(from: string | null): string {
	const who = (from ?? '').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
	const date = new Date().toISOString().slice(0, 10);

	return `${who ? `${who}-` : ''}catalog-share-${date}.json`;
}
