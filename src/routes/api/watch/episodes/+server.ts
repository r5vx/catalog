import { json, error } from '@sveltejs/kit';
import { getFebboxLink, listEpisodes, FebboxRefused } from '$lib/server/showbox';

export async function GET({ url }) {
	const id = Number(url.searchParams.get('id'));
	const type = url.searchParams.get('type');

	if (!id || type !== 'tv') return error(400, 'Missing id or type must be tv');

	const link = await getFebboxLink(id, 'tv');
	if (!link) return error(502, 'No link available');

	try {
		return json(await listEpisodes(link));
	} catch (e) {
		// Febbox not listing just now: say so, rather than an empty show.
		if (e instanceof FebboxRefused) return json({ busy: true, retryIn: e.retryInSeconds }, { status: 503 });
		throw e;
	}
}
