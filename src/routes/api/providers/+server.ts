import { json } from '@sveltejs/kit';
import { getEntry, saveProviders } from '$lib/server/db/queries';
import { fetchProviders, watchRegion, type WatchWhere } from '$lib/server/metadata/providers';
import type { RequestHandler } from './$types';

/**
 * Where a title is streaming, asked for after the page has rendered.
 *
 * Availability is two extra network calls for anime and one for everything
 * else, and nobody should wait on a poster for it. For something in the
 * library the answer is kept on the entry, so opening the same title again
 * costs nothing.
 */

/** How long a stored answer is trusted. Catalogues change monthly, not daily. */
const FRESH_FOR_DAYS = 7;

const isStale = (stamp: string | null) =>
	!stamp || Date.now() - new Date(stamp).getTime() > FRESH_FOR_DAYS * 86_400_000;

/**
 * Titles you don't own have nowhere to be stored, so they're held in memory
 * instead — enough to survive clicking back and forth between a film and its
 * cast, and gone when the app closes.
 */
const loose = new Map<string, { at: number; where: WatchWhere | null }>();
const LOOSE_FOR = 60 * 60_000;
/** An evening of browsing shouldn't leave the app holding a thousand answers. */
const LOOSE_MAX = 200;

function remember(key: string, where: WatchWhere | null) {
	// Insertion order, so the first key out is the oldest one in.
	if (loose.size >= LOOSE_MAX) {
		const oldest = loose.keys().next().value;
		if (oldest !== undefined) loose.delete(oldest);
	}

	loose.set(key, { at: Date.now(), where });
}

export const GET: RequestHandler = async ({ url }) => {
	const region = watchRegion();
	const entryId = Number(url.searchParams.get('entry') ?? 0);

	if (entryId > 0) {
		const entry = getEntry(entryId);
		if (!entry?.sourceId) return json({ where: null, region });

		// Stored, and recent enough, and for the country we're asking about.
		if (entry.providers && !isStale(entry.providersCheckedAt)) {
			try {
				const saved = JSON.parse(entry.providers) as WatchWhere;
				if (saved?.region === region) return json({ where: saved, region });
			} catch {
				// Unreadable, so go and ask again.
			}
		}

		const where = await fetchProviders(entry.source, entry.sourceId, {
			title: entry.title,
			year: entry.year,
			region
		});

		// Only a real answer is stored. A failed request must not stamp a title
		// as unavailable for a week.
		if (where) saveProviders(entry.id, JSON.stringify(where));

		return json({ where, region });
	}

	const source = url.searchParams.get('source') ?? '';
	const sourceId = url.searchParams.get('id') ?? '';
	if (!source || !sourceId) return json({ where: null, region });

	const key = `${source}:${sourceId}:${region}`;
	const held = loose.get(key);
	if (held && Date.now() - held.at < LOOSE_FOR) return json({ where: held.where, region });

	const where = await fetchProviders(source, sourceId, {
		title: url.searchParams.get('title') ?? undefined,
		year: Number(url.searchParams.get('year')) || null,
		region
	});

	remember(key, where);
	return json({ where, region });
};
