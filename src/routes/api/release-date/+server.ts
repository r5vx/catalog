import { json } from '@sveltejs/kit';
import { getOrderCache } from '$lib/server/db/queries';
import { fetchDetails, type TitleDetails } from '$lib/server/metadata/details';
import type { RequestHandler } from './$types';

/**
 * The day a film came out, for its library page (the title page has it from its own details).
 * ?source=tmdb&id=movie:550. From the details kept for it, else asked of TMDB once.
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const id = url.searchParams.get('id') ?? '';
	if (source !== 'tmdb' || !/^movie:\d+$/.test(id)) return json({ releaseDate: null });
	const kept = getOrderCache(`details|${source}|${id}`)?.value as TitleDetails | undefined;
	if (kept?.releaseDate) return json({ releaseDate: kept.releaseDate });
	const details = await fetchDetails(source, id).catch(() => null);
	return json({ releaseDate: details?.releaseDate ?? null });
};
