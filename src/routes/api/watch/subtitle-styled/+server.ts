import { downloadSubtitleWhole } from '$lib/server/showbox-subs';
import { hasStyledLines, keepStyled, readStyled } from '$lib/server/styledSubtitles';
import type { RequestHandler } from './$types';

/**
 * A subtitle file whole, as made (fonts, signs, karaoke), for drawing its signs and songs over
 * the video (src/lib/styledSubs.ts). The same questions as subtitle-content. 204 when it has
 * nothing to draw (an SRT, or an .ass that's only talking).
 */
export const GET: RequestHandler = async ({ url }) => {
	const subUrl = url.searchParams.get('url');
	if (!subUrl) return new Response(null, { status: 400 });
	const season = Number(url.searchParams.get('season')) || undefined;
	const episode = Number(url.searchParams.get('episode')) || undefined;
	const lang = url.searchParams.get('lang')?.trim() || undefined;
	const key = season && episode ? `${subUrl}#${season}x${episode}` : subUrl;

	let text = readStyled(key);
	if (text === null) {
		// Kept by subtitle-content as it downloaded, unless that was before this existed.
		const whole = await downloadSubtitleWhole(subUrl, season, episode, lang);
		if (!hasStyledLines(whole)) return new Response(null, { status: 204 });
		keepStyled(key, whole);
		text = whole;
	}
	return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
};
