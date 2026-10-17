import { json, error } from '@sveltejs/kit';
import { getFebboxLink, listFebboxFiles, FebboxRefused } from '$lib/server/showbox';

export async function GET({ url }) {
	const id = Number(url.searchParams.get('id'));
	const type = url.searchParams.get('type');
	const fid = Number(url.searchParams.get('fid'));

	if (!id || (type !== 'movie' && type !== 'tv')) {
		return error(400, 'Missing id or type');
	}

	const link = await getFebboxLink(id, type);
	if (!link) return error(502, 'No link available');

	try {
		return json({ link, files: await listFebboxFiles(link, fid || 0) });
	} catch (e) {
		// Febbox not listing just now: say so, rather than an empty folder.
		if (e instanceof FebboxRefused) return json({ busy: true, retryIn: e.retryInSeconds }, { status: 503 });
		throw e;
	}
}
