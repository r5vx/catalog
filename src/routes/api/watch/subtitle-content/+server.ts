import { json, error } from '@sveltejs/kit';
import { downloadSubtitleWhole, isScrambled, joinsOf } from '$lib/server/showbox-subs';
import { slimSubtitle } from '$lib/server/subtitleFonts';
import { keepStyled } from '$lib/server/styledSubtitles';
import { forgetSubtitle, savedSubtitle, saveSubtitle } from '$lib/server/db/queries';
import { fileSubtitleText } from '$lib/server/sources/nyaa';
import { kitsunekkoText } from '$lib/server/sources/kitsunekko';
import type { RequestHandler } from './$types';

/**
 * Whether a download is really subtitles: SRT/VTT timings, ASS lines, or MicroDVD frames.
 * OpenSubtitles' download server answered with its own error page instead, as an ordinary
 * success ("Sorry. We have problem with network connection to database server", 2026-10-17):
 * that page was kept as Madagascar's subtitles, which then showed nothing — even once
 * OpenSubtitles was back.
 */
const isSubtitles = (text: string) => /-->|^\s*Dialogue:|^\s*\{\d+\}\{\d+\}/m.test(text);

/**
 * A subtitle file's text. Kept on this PC (for `show`) the first time, so it loads instantly
 * after that; kept copies go once the show is done with (forgetFinishedSubtitles).
 * `content` is empty when it couldn't be had — never something that isn't subtitles.
 */
export const GET: RequestHandler = async ({ url }) => {
	const subUrl = url.searchParams.get('url');
	if (!subUrl) return error(400, 'Missing url');
	// Which episode to take out of a season-pack zip.
	const season = Number(url.searchParams.get('season')) || undefined;
	const episode = Number(url.searchParams.get('episode')) || undefined;
	const show = url.searchParams.get('show')?.trim();
	// Its language, for a file saved in an older character set (subtitleText.ts).
	const lang = url.searchParams.get('lang')?.trim() || undefined;

	// A subtitle track inside a Nyaa file (sources/nyaa.ts): read out of it as it downloads, so it
	// may not be all there yet (`partial`: the player asks again). Kept only once it's whole.
	if (subUrl.startsWith('torrent:')) {
		const inFile = await fileSubtitleText(subUrl);
		const content = slimSubtitle(inFile?.text ?? '');
		return json({ content: isSubtitles(content) ? content : '', partial: !inFile?.complete });
	}

	// Kitsunekko (sources/kitsunekko.ts): picture subtitles are read into text, and what's read so
	// far comes back with `partial` (the player asks again). Kept there once whole.
	if (subUrl.startsWith('kitsunekko:')) {
		const found = await kitsunekkoText(subUrl);
		const content = slimSubtitle(found?.text ?? '');
		return json({ content: isSubtitles(content) ? content : '', partial: Boolean(found) && !found?.complete });
	}

	// A season pack holds every episode, so its copy is only reused for the same episode.
	const key = season && episode ? `${subUrl}#${season}x${episode}` : subUrl;
	// A set joined from parts: where each part begins goes with it (`joins`, seconds), kept beside
	// it, so auto-timing can time the parts one by one. One kept before that was known is fetched again.
	const joined = subUrl.startsWith('joined:');
	const keptJoins = joined ? savedSubtitle(`${key}#joins`) : '';
	const kept = savedSubtitle(key);
	if (kept && isSubtitles(kept) && !isScrambled(kept) && (!joined || keptJoins)) return json({ content: kept, ...(joined ? { joins: JSON.parse(keptJoins!) } : {}) });
	// An error page (or a scrambled file) kept by mistake before: thrown away, and fetched again.
	if (kept) forgetSubtitle(key);

	const whole = await downloadSubtitleWhole(subUrl, season, episode, lang);
	// The whole file too, if it has signs or songs to draw (subtitle-styled): no second download.
	if (whole && isSubtitles(whole)) keepStyled(key, whole);
	const content = slimSubtitle(whole);
	if (!content || !isSubtitles(content)) return json({ content: '' });
	const joins = joined ? joinsOf(subUrl) : [];
	if (show) {
		saveSubtitle(key, show, content);
		if (joined) saveSubtitle(`${key}#joins`, show, JSON.stringify(joins));
	}
	return json({ content, ...(joined ? { joins } : {}) });
};
