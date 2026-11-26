import { appleMobile, catalogDesktop } from '$lib/youtubeDevice';
import { json, type RequestEvent } from '@sveltejs/kit';
import { sourceHasNot } from '$lib/server/sourceAnswers';
import { availabilityNow, isAvailable } from '$lib/server/availability';

/**
 * { available, unsure? } — `unsure`: no answer within 12 seconds yet; ask again shortly.
 * With ?now=1: { available (null while checking), sources } at once, for a page that asks every
 * second and shows each source's progress.
 */
export async function GET({ url, request }: RequestEvent) {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return json({ available: false });
	if (url.searchParams.has('now')) {
		const answer = availabilityNow(title, type, year);
		const tmdb = url.searchParams.get('tmdb');
		const ua = request.headers.get('user-agent') ?? '';
		const canOpen = catalogDesktop(ua) || appleMobile(ua) || url.searchParams.get('handoff') === '1';
		if (!answer.sources.length) return json(answer);
		const id = /^(movie|tv):([1-9]\d*)$/.exec(tmdb ?? '');
		const sources = answer.sources.filter(s => (!s.tmdb || !tmdb || s.tmdb === tmdb) && (s.name !== 'YouTube' || canOpen)).map(s => {
			if (id && s.state === 'yes' && (s.name === 'Movy' || s.name === '7Movies') && sourceHasNot(s.name, { type: id[1] === 'tv' ? 'tv' : 'movie', id: Number(id[2]), season: 1, episode: 1 })) return { ...s, state: 'no' };
			return s;
		});
		const canWatch = sources.some(s => s.state === 'yes' || (s.state === 'listed' && canOpen));
		return json({ ...answer, sources, available: canWatch || (sources.some(s => s.state === 'checking') ? null : false) });
	}
	return json(await isAvailable(title, type, year));
}
