/**
 * The library's remembered view (src/routes/+page.server.ts keptView). The sort is kept for good
 * (settings `libraryView`); a status, tag or year filter only while Catalog stays open. A status
 * picked once used to stay for ever: a friend's VisionQuest and Spider-Verse "disappeared" (only
 * Completed was showing) until he marked them Completed, and the owner's own library was quietly
 * showing only Want to watch (2026-11-16).
 */
import { KEPT_FILTERS } from '$lib/constants';
import { readSettings, updateSettings } from './settings';

/** Kept in settings. */
const LASTING = ['sort'];
/** status, tag, yearFrom, yearTo for this run of Catalog. */
let forNow = new URLSearchParams();

/** The view as last left: the lasting part from settings, the rest from this run. */
export function savedView(): URLSearchParams {
	const kept = new URLSearchParams(readSettings().libraryView ?? '');
	const view = new URLSearchParams();
	for (const key of KEPT_FILTERS) {
		const from = LASTING.includes(key) ? kept : forNow;
		for (const value of from.getAll(key)) if (value) view.append(key, value);
	}
	return view;
}

export function saveView(given: URLSearchParams): void {
	const lasting = new URLSearchParams();
	const rest = new URLSearchParams();
	for (const key of KEPT_FILTERS) {
		for (const value of given.getAll(key)) if (value) (LASTING.includes(key) ? lasting : rest).append(key, value);
	}
	forNow = rest;
	if ((readSettings().libraryView ?? '') !== lasting.toString()) updateSettings({ libraryView: lasting.toString() });
}
