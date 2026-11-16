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
 *   POST { kinds, deep, library, quick }   keeps them (`quick`: no box to open, the pick at once).
 */
type Kind = 'movies' | 'tv' | 'anime';
type Prefs = { kinds: Kind[]; deep: boolean; library: boolean; quick: boolean };
const KINDS: Kind[] = ['movies', 'tv', 'anime'];

/** The kinds kept: one or more (`kinds`), or the single `kind` kept before 2026-11-16. */
function kindsOf(sent: { kinds?: unknown; kind?: unknown }): Kind[] {
	const asked = Array.isArray(sent.kinds) ? sent.kinds : [sent.kind];
	const kinds = KINDS.filter((k) => asked.includes(k));
	return kinds.length ? kinds : ['movies'];
}

function prefs(): Prefs | null {
	try {
		const saved = JSON.parse(readSettings().randomPrefs ?? 'null') as (Partial<Prefs> & { kind?: string }) | null;
		if (!saved) return null;
		return { kinds: kindsOf(saved), deep: saved.deep === true, library: saved.library === true, quick: saved.quick === true };
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
	const sent = (await request.json().catch(() => ({}))) as Partial<Prefs> & { kind?: string };
	const kept: Prefs = { kinds: kindsOf(sent), deep: sent.deep === true, library: sent.library === true, quick: sent.quick === true };
	updateSettings({ randomPrefs: JSON.stringify(kept) });
	return json({ ok: true });
};
