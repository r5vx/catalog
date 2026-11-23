import { json } from '@sveltejs/kit';
import { ListProblem, loadList, type ListSite } from '$lib/server/listImport';
import type { RequestHandler } from './$types';

const SITES: ListSite[] = ['mal', 'anilist', 'kitsu', 'letterboxd', 'imdb'];

/** { site, user } or { site, file }: someone's list from another site (src/lib/server/listImport.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const sent = (await request.json().catch(() => ({}))) as { site?: string; user?: string; file?: string };
	const site = SITES.find((s) => s === sent.site);
	if (!site) return json({ error: 'Pick a site first.' }, { status: 400 });
	try {
		const items = await loadList(site, String(sent.user ?? ''), String(sent.file ?? '').slice(0, 20_000_000));
		if (!items.length) return json({ error: 'That list is empty.' }, { status: 404 });
		return json({ items });
	} catch (problem) {
		return json({ error: problem instanceof ListProblem ? problem.message : "The list couldn't be read." }, { status: 502 });
	}
};
