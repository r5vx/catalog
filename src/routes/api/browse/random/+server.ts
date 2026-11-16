import { json } from '@sveltejs/kit';
import { randomPick } from '$lib/server/metadata/tmdb';
import { existingSourceKeysWithIds } from '$lib/server/db/queries';
import { readSettings, updateSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * The Random window (src/lib/RandomPick.svelte).
 *   GET ?kind=movies|tv|anime&genre=&deep=1&library=1  one title: `deep` really random,
 *       `library` lets titles already in the library come up too (left out unless it's 1).
 *   GET ?prefs=1   the window's choices as last left (kept in settings: this app's browser
 *       storage doesn't last, see CATALOG_CONTEXT.md).
 *   POST { kind, deep, library, quick }   keeps them (`quick`: no box to open, the pick at once).
 */
type Prefs = { kind: 'movies' | 'tv' | 'anime'; deep: boolean; library: boolean; quick: boolean };

function prefs(): Prefs | null {
	try {
		const saved = JSON.parse(readSettings().randomPrefs ?? 'null') as Partial<Prefs> | null;
		if (!saved) return null;
		return { kind: saved.kind === 'tv' || saved.kind === 'anime' ? saved.kind : 'movies', deep: saved.deep === true, library: saved.library === true, quick: saved.quick === true };
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('prefs') === '1') return json({ prefs: prefs() });
	const asked = url.searchParams.get('kind');
	const kind = asked === 'tv' || asked === 'anime' ? asked : 'movies';
	const genre = Number(url.searchParams.get('genre')) || undefined;
	const skip = url.searchParams.get('library') === '1' ? new Set<string>() : new Set(Object.keys(existingSourceKeysWithIds()));
	const pick = await randomPick(kind, genre, skip, url.searchParams.get('deep') === '1');
	return json({ pick });
};

export const POST: RequestHandler = async ({ request }) => {
	const sent = (await request.json().catch(() => ({}))) as Partial<Prefs>;
	const kept: Prefs = { kind: sent.kind === 'tv' || sent.kind === 'anime' ? sent.kind : 'movies', deep: sent.deep === true, library: sent.library === true, quick: sent.quick === true };
	updateSettings({ randomPrefs: JSON.stringify(kept) });
	return json({ ok: true });
};
