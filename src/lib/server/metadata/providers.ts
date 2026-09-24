import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { normalizeTitle } from './types';
import { searchTmdb } from './tmdb';

/**
 * Where you can actually watch something.
 *
 * TMDB carries JustWatch's availability data, per country, per title: what's
 * included with a subscription, what's free with adverts, and what you'd have
 * to rent or buy. It's the one piece of information a library can't tell you
 * and a streaming app won't — "I own this, where has it gone?"
 *
 * Availability is *regional*, so the country matters and there's no sensible
 * universal answer. It also changes constantly, which is why what's stored is
 * treated as stale after a week rather than kept forever.
 */

export type WatchOffer = { name: string; logo: string | null };

export type WatchWhere = {
	/** The country this answer is for — availability means nothing without it. */
	region: string;
	/** JustWatch's page for the title, which TMDB hands back with the data. */
	link: string | null;
	/** Included with a subscription you already pay for. */
	stream: WatchOffer[];
	/** Free, usually with adverts. */
	free: WatchOffer[];
	rent: WatchOffer[];
	buy: WatchOffer[];
};

const LOGO = 'https://image.tmdb.org/t/p/w92';

const tmdbKey = () => (readSettings().tmdbApiKey || env.TMDB_API_KEY || '').trim();

/**
 * Which country to ask about.
 *
 * Your own, unless you've said otherwise — a UK answer is worse than useless
 * to someone in Australia. Windows tells us the region through the locale,
 * and Settings can override it when that's wrong.
 */
export function detectedRegion(): string {
	try {
		const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
		const region = new Intl.Locale(locale).maximize().region;
		if (region && /^[A-Z]{2}$/.test(region)) return region;
	} catch {}
	return 'US';
}

export function watchRegion(): string {
	const chosen = (readSettings().watchRegion || '').trim().toUpperCase();
	if (/^[A-Z]{2}$/.test(chosen)) return chosen;
	return detectedRegion();
}

function authorize(url: URL, key: string): RequestInit {
	if (key.startsWith('eyJ')) return { headers: { Authorization: `Bearer ${key}` } };
	url.searchParams.set('api_key', key);
	return {};
}

const offers = (list: unknown): WatchOffer[] =>
	(Array.isArray(list) ? list : [])
		.map((one: Record<string, unknown>) => ({
			name: String(one?.provider_name ?? ''),
			logo: one?.logo_path ? `${LOGO}${one.logo_path}` : null
		}))
		.filter((one) => one.name);

/** True when the answer came back with nothing in it — asked, but not available. */
export const nowhere = (where: WatchWhere) =>
	where.stream.length === 0 &&
	where.free.length === 0 &&
	where.rent.length === 0 &&
	where.buy.length === 0;

/**
 * AniList has no availability data of its own, so an anime added from there
 * has to be found on TMDB first. Matching by name is less certain than by id,
 * which is why the year has to agree too — the wrong season of the wrong show
 * would be worse than no answer at all.
 */
async function tmdbIdForAnime(title: string, year: number | null): Promise<string | null> {
	const results = await searchTmdb(title);
	const wanted = normalizeTitle(title);

	const match = results.find(
		(one) =>
			normalizeTitle(one.title) === wanted &&
			(year == null || one.year == null || Math.abs(one.year - year) <= 1)
	);

	return match?.sourceId ?? null;
}

/**
 * Asks where a title is streaming.
 *
 * **Returns null when it couldn't ask** — no key, no match, or the request
 * failed — as opposed to an answer with empty lists, which means it asked and
 * the title isn't available here. The two look the same on screen and must
 * not be stored the same way, or one failed request would stamp a title as
 * unavailable for a week.
 */
export async function fetchProviders(
	source: string,
	sourceId: string,
	options: { title?: string; year?: number | null; region?: string } = {}
): Promise<WatchWhere | null> {
	const key = tmdbKey();
	if (!key) return null;

	const region = options.region ?? watchRegion();

	try {
		let id = sourceId;

		if (source === 'anilist') {
			if (!options.title) return null;
			const found = await tmdbIdForAnime(options.title, options.year ?? null);
			if (!found) return null;
			id = found;
		}

		const [kind, number] = id.split(':');
		if (!number || (kind !== 'movie' && kind !== 'tv')) return null;

		const url = new URL(`https://api.themoviedb.org/3/${kind}/${number}/watch/providers`);
		const init = authorize(url, key);

		const response = await fetch(url, init);
		if (!response.ok) return null;

		const here = (await response.json())?.results?.[region];

		// No entry for this country is a real answer: nobody is carrying it here.
		if (!here) return { region, link: null, stream: [], free: [], rent: [], buy: [] };

		return {
			region,
			link: here.link ?? null,
			stream: offers(here.flatrate),
			// TMDB splits genuinely free from ad-supported; both are free to watch.
			free: [...offers(here.free), ...offers(here.ads)],
			rent: offers(here.rent),
			buy: offers(here.buy)
		};
	} catch {
		return null;
	}
}
