import { json, error } from '@sveltejs/kit';
import { getFebboxLink, listEpisodes } from '$lib/server/showbox';

export async function GET({ url }) {
	const id = Number(url.searchParams.get('id'));
	const type = url.searchParams.get('type');

	if (!id || type !== 'tv') return error(400, 'Missing id or type must be tv');

	const link = await getFebboxLink(id, 'tv');
	if (!link) return error(502, 'No link available');

	const data = await listEpisodes(link);
	return json(data);
}
