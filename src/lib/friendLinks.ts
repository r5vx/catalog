/**
 * Links and small actions shared by the Friends page, friends' profiles and libraries, the room's
 * "started" box and the chat: where a title opens, and adding one to Want to watch.
 */

export type Watchable = { title: string; type: string; year?: string | number | null; season?: number; episode?: number };

/** The player, opening this film or episode by itself. */
export function watchHref(w: Watchable): string {
	const params = new URLSearchParams({ title: w.title, type: w.type === 'tv' ? 'tv' : 'movie', year: String(w.year ?? ''), auto: '1' });
	if (w.type === 'tv' && w.season) {
		params.set('resume_s', String(w.season));
		params.set('resume_e', String(w.episode ?? 1));
	}
	return `/watch?${params}`;
}

/** A title's own page from its key: "tmdb:movie:550" opens /title/tmdb/movie:550. */
export function titleHref(key: string): string {
	const at = key.indexOf(':');
	return `/title/${key.slice(0, at)}/${encodeURIComponent(key.slice(at + 1))}`;
}

/**
 * Into the library as Want to watch: by its key when there is one ("tmdb:movie:550"), else by
 * name and year (a friend's "Watching now" only has those). True when it was added.
 */
export async function wantToWatch(what: { key?: string; title: string; year?: string | number | null; type?: string }): Promise<boolean> {
	const at = what.key ? what.key.indexOf(':') : -1;
	const body =
		what.key && at > 0
			? { source: what.key.slice(0, at), sourceId: what.key.slice(at + 1), status: 'planned' }
			: { title: what.title, year: String(what.year ?? ''), type: what.type ?? '', status: 'planned' };
	try {
		const response = await fetch('/api/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		return response.ok;
	} catch {
		return false;
	}
}

/** "Joined March 2026", "Friends since 3 days ago": a date as a month and year. */
export const monthYear = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
