import { json, error } from '@sveltejs/kit';
import { finishedOf, searchFranchises } from '$lib/server/watchOrders';
import { addWatchOrder, removeWatchOrder, setExtraWatched, setTitleSkipped } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

const VALID_ID = /^(?:[a-z0-9-]+|collection-\d+)$/;

/** Franchises to add, by name. */
export const GET: RequestHandler = async ({ url }) => {
	const hits = await searchFranchises(url.searchParams.get('q')?.trim() ?? '');
	// (Checked against the library each time, so it isn't kept with the search.)
	const finished = await finishedOf(hits.map((hit) => hit.id));
	return json(hits.map((hit) => ({ ...hit, finished: finished.has(hit.id) })));
};

export const POST: RequestHandler = async ({ request }) => {
	const { id, name } = await request.json();
	if (typeof id !== 'string' || !VALID_ID.test(id) || typeof name !== 'string' || !name.trim()) {
		return error(400, 'Missing id or name');
	}
	addWatchOrder(id, name.trim().slice(0, 120));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (typeof id !== 'string') return error(400, 'Missing id');
	removeWatchOrder(id);
	return json({ ok: true });
};

/**
 * { extra: "movie:76122", watched } ticks an extra (a One-Shot, say) as seen without putting it
 * in the library. { skip: "movie:1726:1", skipped } skips a title, or brings it back.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const { extra, watched, skip, skipped } = await request.json();
	if (typeof skip === 'string') {
		if (!/^(movie|tv):\d+:\d+$/.test(skip)) return error(400, 'Bad title');
		setTitleSkipped(skip, Boolean(skipped));
		return json({ ok: true });
	}
	if (typeof extra !== 'string' || !/^movie:\d+$/.test(extra)) return error(400, 'Missing extra');
	setExtraWatched(extra, Boolean(watched));
	return json({ ok: true });
};
