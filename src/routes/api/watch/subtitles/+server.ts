import { json, error } from '@sveltejs/kit';
import { fetchSubtitlesForTitle, type SubtitleOption } from '$lib/server/showbox-subs';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { nexusSubtitlesFor, tmdbEpisodeOfAniwave } from '$lib/server/sources';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import type { RequestHandler } from './$types';

/**
 * `default`: turns itself on when nothing was chosen before.
 * `check`: not a subtitle — anime.nexus wants its human check before it hands over its list.
 */
type Option = SubtitleOption & { default?: boolean; check?: boolean };

const ANIWAVE_LANGUAGES: Record<string, string> = {
	ENG: 'English', ARA: 'Arabic', FRE: 'French', GER: 'German', ITA: 'Italian',
	POL: 'Polish', POR: 'Portuguese', RUS: 'Russian', SPA: 'Spanish'
};

/**
 * Subtitles for what's playing. For anime, anime.nexus's come first: on Japanese audio its
 * "English" (on by default), on the English dub its "English CC", which follows the dub's
 * words. Then the player's own (Aniwave S-Sub), then OpenSubtitles and the rest.
 */
export const GET: RequestHandler = async ({ url }) => {
	const title = url.searchParams.get('title')?.trim();
	const type = (url.searchParams.get('type') ?? 'movie') as 'movie' | 'tv';
	const season = Number(url.searchParams.get('season') ?? 0) || undefined;
	const episode = Number(url.searchParams.get('episode') ?? 0) || undefined;
	const year = url.searchParams.get('year') ?? '';
	const dub = url.searchParams.get('audio') === 'dub';
	const share = parseAniwaveShareKey(url.searchParams.get('share') ?? '');
	const ref = parseAniwaveShareKey(url.searchParams.get('ref') ?? '');

	if (!title) return error(400, 'Missing title');

	// A later season's year isn't when the show started, so without the year if that finds nothing.
	let show = type === 'tv' ? await tmdbShow(title, year) : null;
	if (type === 'tv' && year && !show?.anime) show = (await tmdbShow(title, '')) ?? show;
	const anime = Boolean(show?.anime);

	// anime.nexus goes by TMDB's numbering; Showbox's can differ (Re:Zero), so the episode is
	// found through its Aniwave copy when there is one.
	const tmdb = show && ref ? await tmdbEpisodeOfAniwave(show, title, ref.id, ref.episode) : null;
	const nexusSeason = tmdb?.season ?? season;
	const nexusEpisode = tmdb?.episode ?? episode;

	// anime.nexus gets 8 seconds; a slower answer is still kept for next time.
	const nexusInTime = show && anime && nexusSeason && nexusEpisode
		? Promise.race([
				nexusSubtitlesFor(show, title, nexusSeason, nexusEpisode),
				new Promise<[]>((resolve) => setTimeout(() => resolve([]), 8000))
			])
		: Promise.resolve([]);

	const [nexusAnswer, playerTracks, others] = await Promise.all([
		nexusInTime,
		share?.kind === 'ssub'
			? aniwaveStream(share.id, share.episode, 'ssub').then((s) => s?.tracks ?? [])
			: Promise.resolve([]),
		fetchSubtitlesForTitle(title, type, season, episode)
	]);

	const nexus = nexusAnswer === 'check' ? [] : nexusAnswer;
	const english = (label: string) => /^english/i.test(label);
	// Dub: the captions that follow the dub first. Japanese audio: the plain translation first.
	const rank = (label: string) => {
		const order = dub ? ['english cc', 'english', 'english signs'] : ['english', 'english cc', 'english signs'];
		const at = order.indexOf(label.toLowerCase());
		return at >= 0 ? at : english(label) ? 3 : 4;
	};

	const fromNexus: Option[] = [...nexus]
		.sort((a, b) => rank(a.label) - rank(b.label))
		.map((s, i) => ({
			id: `nexus-${i}-${s.src.split('/').pop()}`,
			url: s.src,
			lang: s.lang,
			language: english(s.label) ? 'English' : s.label,
			fileName: s.label,
			source: 'anime.nexus'
		}));

	const fromPlayer: Option[] = playerTracks.map((t, i) => ({
		id: `aniwave-${i}`,
		url: t.file,
		lang: t.label.toLowerCase(),
		language: ANIWAVE_LANGUAGES[t.label.toUpperCase()] ?? t.label,
		fileName: `Aniwave ${t.label}`,
		source: 'Aniwave'
	}));

	// Passing anime.nexus's check (like a sign-in) gets its subtitles; the player offers it.
	const askCheck: Option[] =
		nexusAnswer === 'check'
			? [{ id: 'nexus-check', url: '', lang: 'en', language: 'English', fileName: 'Get anime.nexus subtitles', source: 'anime.nexus', check: true }]
			: [];

	// Aniwave's own subtitle server often doesn't answer, so its files go last.
	const list: Option[] = [...askCheck, ...fromNexus, ...others, ...fromPlayer];

	// Anime in Japanese: subtitles on from the start, the best English there is. (The player
	// moves on to the next English one if this one won't download.)
	if (anime && !dub) {
		const usable = list.filter((s) => !s.check);
		const pick =
			usable.find((s) => s.source === 'anime.nexus' && s.fileName === 'English') ??
			usable.find((s) => s.language === 'English' && s.source !== 'Aniwave') ??
			usable.find((s) => s.language === 'English');
		if (pick) pick.default = true;
	}

	return json(list);
};
