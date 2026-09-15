import type { SearchResult } from '$lib/server/metadata/types';

export type SearchOutcome =
	| { ok: true; results: SearchResult[] }
	| { ok: false; problem: string };

/**
 * Ask the server for matching titles.
 *
 * A PIN-locked app answers an expired session with the login page rather than
 * results, so we check we actually got JSON back — otherwise the page shows an
 * empty list and you're left wondering why typing does nothing.
 */
export async function searchTitles(query: string): Promise<SearchOutcome> {
	try {
		const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
			headers: { Accept: 'application/json' }
		});

		if (response.redirected || !response.headers.get('content-type')?.includes('json')) {
			return { ok: false, problem: 'Session expired. Reload the page and enter your PIN.' };
		}

		const payload = await response.json();
		return { ok: true, results: payload.results ?? [] };
	} catch {
		return { ok: false, problem: 'Could not reach the search service.' };
	}
}
