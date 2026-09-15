import { json } from '@sveltejs/kit';
import { bestMatch } from '$lib/server/metadata';
import type { RequestHandler } from './$types';

type Incoming = {
	title: string;
	year?: number | null;
	season?: number | null;
	episode?: number | null;
};

/**
 * Used by the bulk importer. The browser sends a small batch of titles at a
 * time so you get a live progress bar instead of one long silent wait.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { titles } = (await request.json()) as { titles: Incoming[] };

	const matches = await Promise.all(
		(titles ?? []).slice(0, 20).map(async (item) => ({
			title: item.title,
			season: item.season ?? null,
			episode: item.episode ?? null,
			options: await bestMatch(item.title, item.year ?? null)
		}))
	);

	return json({ matches });
};
