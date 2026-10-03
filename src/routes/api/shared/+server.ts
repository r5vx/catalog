import { json } from '@sveltejs/kit';
import { listSharedCatalogs, importSharedCatalog, removeSharedCatalog, getSharedCatalog } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');

	if (id) {
		const catalog = getSharedCatalog(Number(id));
		if (!catalog) return json({ error: 'Not found' }, { status: 404 });
		return json({ name: catalog.name, titles: JSON.parse(catalog.data) });
	}

	return json({ catalogs: listSharedCatalogs() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if (!body?.catalogShare || !Array.isArray(body.titles)) {
		return json({ error: 'Not a valid shared catalog.' }, { status: 400 });
	}

	const name = body.from || 'Unknown';
	const id = importSharedCatalog(name, JSON.stringify(body.titles), body.titles.length);
	return json({ id, name });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	removeSharedCatalog(id);
	return json({ ok: true });
};
