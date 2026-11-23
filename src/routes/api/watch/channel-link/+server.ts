import { json } from '@sveltejs/kit';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { handCopy, setHandLink, videoIdOf } from '$lib/server/sources/channels';
import type { RequestHandler } from './$types';

/**
 * A video link added to an episode by hand, from the player's Files menu (sources/channels.ts):
 * POST { title, year, season, episode, link } → { copy } to play now; `link: ''` takes it away.
 * Played the same way as the trusted collections' videos, in Catalog's own player.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { title?: string; year?: string; season?: number; episode?: number; link?: string } | null;
	const title = String(body?.title ?? '').trim();
	const season = Number(body?.season) || 0;
	const episode = Number(body?.episode) || 0;
	if (!title || !episode) return json({ error: 'Pick an episode first' }, { status: 400 });
	const show = (await tmdbShow(title, String(body?.year ?? ''))) ?? (await tmdbShow(title, ''));
	if (!show) return json({ error: "TMDB doesn't know this show" }, { status: 404 });
	const link = String(body?.link ?? '').trim();
	if (!link) {
		setHandLink(show.id, season, episode, null);
		return json({ ok: true });
	}
	const video = videoIdOf(link);
	if (!video) return json({ error: "That isn't a YouTube video link" }, { status: 400 });
	setHandLink(show.id, season, episode, video);
	return json({ copy: handCopy(video) });
};
