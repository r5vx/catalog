import { json } from '@sveltejs/kit';
import { matchItems, type ListItem } from '$lib/server/listImport';
import { existingSourceKeys } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/**
 * { items }: up to 20 lines of a list from another site, each matched to TMDB (the page asks a
 * batch at a time, for its progress bar). `have`: the matches already in the library.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { items } = (await request.json().catch(() => ({}))) as { items?: ListItem[] };
	const matched = await matchItems((items ?? []).slice(0, 20));
	const existing = existingSourceKeys();
	const have = [...new Set(matched.flatMap((m) => m.options).filter((o) => existing.has(`${o.source}:${o.sourceId}`)).map((o) => o.key))];
	return json({ matched, have });
};
