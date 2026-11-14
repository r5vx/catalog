import { json } from '@sveltejs/kit';
import { cloud } from '$lib/server/online';
import type { RequestHandler } from './$types';

/** Problem reports Catalogs sent by themselves, read with the owner's key (Settings → Online). ?id= for one in full. */
export const GET: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	const answer = await cloud(id ? `/v1/reports/${id}` : '/v1/reports', { admin: true });
	return answer.ok ? json(answer.data) : json({ error: answer.error }, { status: answer.status || 502 });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const answer = await cloud(`/v1/reports/${Number(url.searchParams.get('id'))}`, { method: 'DELETE', admin: true });
	return answer.ok ? json({ ok: true }) : json({ error: answer.error }, { status: answer.status || 502 });
};
