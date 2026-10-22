import { json, error } from '@sveltejs/kit';
import { fetchSubtitlesForTitle, type SubtitleOption } from '$lib/server/showbox-subs';
import { tmdbShow } from '$lib/server/combinedEpisodes';
import { nexusSubtitlesFor, tmdbEpisodeOfAniwave, episodesBefore, aniwaveExtra } from '$lib/server/sources';
import { aniwaveStream, parseAniwaveShareKey } from '$lib/server/sources/aniwave';
import { toshoSubtitles, toshoFilmSubtitles, keepSeasonSubtitles, type ToshoSubtitle } from '$lib/server/sources/animetosho';
import { fetchRomajiTitle } from '$lib/server/metadata/anilist';
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

/** Gives up on `work` after `ms`, answering `fallback`; the work carries on and is kept for next time. */
const within = <T>(work: Promise<T>, ms: number, fallback: T) =>
	Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/**
 * Subtitles for what's playing. For anime, the official English ones come first, found by
 * themselves: on Japanese audio "English" (on by default), on the English dub "English CC",
 * which follows the dub's words. They come from AnimeTosho (Crunchyroll's own tracks), or from
 * anime.nexus for an episode AnimeTosho doesn't have. Then OpenSubtitles and the rest, then the
 * player's own (Aniwave S-Sub).
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
	// An anime film: AniList knows it, or it plays from Aniwave (Re:Zero's Memory Snow).
	const filmRomaji = type === 'movie' ? await fetchRomajiTitle(title).catch(() => null) : null;
	const animeFilm = type === 'movie' && Boolean(share || filmRomaji);
	const anime = Boolean(show?.anime) || animeFilm;

	// anime.nexus goes by TMDB's numbering; Showbox's can differ (Re:Zero), so the episode is
	// found through its Aniwave copy when there is one.
	const tmdb = show && ref ? await tmdbEpisodeOfAniwave(show, title, ref.id, ref.episode) : null;
	const nexusSeason = tmdb?.season ?? season;
	const nexusEpisode = tmdb?.episode ?? episode;

	// A film in the show's Specials (Re:Zero's Memory Snow): looked up as that film, by its own
	// name, everywhere ("season 0" finds other episodes' subtitles).
	const extra = show && anime && url.searchParams.get('season') === '0' && ref ? await aniwaveExtra(show, title, ref.id) : null;

	// The other sites are asked straight away, alongside.
	const playerTracksSoon = share?.kind === 'ssub'
		? aniwaveStream(share.id, share.episode, 'ssub').then((s) => s?.tracks ?? [])
		: Promise.resolve([]);
	// Subtitle sites mostly number episodes the TMDB way (Bleach S6E13 is episode 122 there), so a
	// show the player numbers its own way is asked for under both.
	const othersSoon = extra?.film
		? fetchSubtitlesForTitle(extra.name, 'movie')
		: Promise.all([
				fetchSubtitlesForTitle(title, type, season, episode),
				tmdb && (tmdb.season !== season || tmdb.episode !== episode)
					? fetchSubtitlesForTitle(title, type, tmdb.season, tmdb.episode).catch(() => [])
					: Promise.resolve([]),
				// Not a series anywhere (One Piece Heroines: a one-episode special to AniList, a film
				// to everyone else): asked for as the film too.
				type === 'tv' && !show && (episode ?? 1) === 1
					? fetchSubtitlesForTitle(title, 'movie').catch(() => [])
					: Promise.resolve([])
			]).then(([ours, theirs, asFilm]) => {
				const all = [...ours];
				for (const s of [...theirs, ...asFilm]) if (!all.some((o) => o.url === s.url)) all.push(s);
				return all;
			});

	// The official English subtitles: AnimeTosho first — it never asks for a check, so they're
	// there every time — and anime.nexus only for an episode AnimeTosho has none for. Each gets
	// 8 seconds; slower answers are kept for next time. AnimeTosho goes by the release names,
	// which number seasons the way the player does; the rest of the season's are kept on this PC
	// in the background.
	let tosho: ToshoSubtitle[] = [];
	if (extra?.film) {
		tosho = await within(toshoFilmSubtitles([extra.name]), 8000, []);
	} else if (show && anime && season && episode) {
		const romaji = await fetchRomajiTitle(title).catch(() => null);
		const names = [...new Set([title, show.name, ...(romaji ? [romaji] : [])])];
		// Its number counting from the show's first episode, which long shows' releases go by.
		const overall = tmdb ? episodesBefore(show, tmdb.season) + tmdb.episode : undefined;
		tosho = await within(toshoSubtitles(names, season, episode, overall), 8000, []);
		keepSeasonSubtitles(title, names, season, episode, overall);
	} else if (animeFilm) {
		tosho = await within(toshoFilmSubtitles([...new Set([title, ...(filmRomaji ? [filmRomaji] : [])])]), 8000, []);
	}
	const nexusAnswer =
		!tosho.length && show && anime && nexusSeason && nexusEpisode
			? await within(nexusSubtitlesFor(show, title, nexusSeason, nexusEpisode), 8000, [])
			: [];

	const [playerTracks, kept] = await Promise.all([playerTracksSoon, othersSoon]);
	// Copies: the lists are kept between requests, and marking one `default` here mustn't carry
	// over to the next (the Japanese-audio pick showed as on for the dub).
	// Subtitles made for a recording from the cinema (CAM, TS, HDTS…, and c1nem4/SUNSCREEN's
	// pre-release rips) go last: they're timed to another version of the film. Venom 2's top one
	// was 22 s out for its first 20 minutes; the BluRay and WEB ones fit throughout.
	const fromCinema = (s: Option) => /(^|[^a-z])(hd)?(cam|ts|tc|telesync|telecine|hdts|hdtc|hqcam)([^a-z]|$)|c1nem4|sunscreen/i.test(s.fileName);
	const others: Option[] = kept
		.map((s) => ({ ...s, default: undefined }))
		.sort((a, b) => Number(fromCinema(a)) - Number(fromCinema(b)));

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

	const fromTosho: Option[] = [...tosho]
		.sort((a, b) => rank(a.label) - rank(b.label))
		.map((t, i) => ({
			id: `tosho-${i}-${t.url.split('/').pop()}`,
			url: t.url,
			lang: t.lang,
			language: 'English',
			fileName: t.label,
			source: 'AnimeTosho'
		}));

	const fromPlayer: Option[] = playerTracks.map((t, i) => ({
		id: `aniwave-${i}`,
		url: t.file,
		lang: t.label.toLowerCase(),
		language: ANIWAVE_LANGUAGES[t.label.toUpperCase()] ?? t.label,
		fileName: `Aniwave ${t.label}`,
		source: 'Aniwave'
	}));

	// Only when nothing official was found by itself: passing anime.nexus's check (like a
	// sign-in) gets its subtitles, offered first since they're the best there is then.
	const askCheck: Option[] =
		nexusAnswer === 'check'
			? [{ id: 'nexus-check', url: '', lang: 'en', language: 'English', fileName: 'Get anime.nexus subtitles ↗', source: 'anime.nexus', check: true }]
			: [];

	// English made for the Japanese release, by its name: "…S01E06.JAPANESE.WEBRip.NF.en[cc].srt" is
	// Netflix's English for the Japanese audio, timed to it. On Japanese audio it comes first (and
	// goes on by itself); on the dub it's never taken for the dub's captions.
	const madeForJapanese = (s: Option) => s.language === 'English' && /(^|[^a-z])(japanese|jpn)([^a-z]|$)/i.test(s.fileName);
	const japaneseRelease = anime && !dub ? others.filter(madeForJapanese) : [];

	// The dub with no official captions found: another site's English file named as captions
	// ("…English[CC]", "SDH") goes first instead.
	const officialCaptions = [...fromTosho, ...fromNexus].some((s) => s.fileName === 'English CC');
	const markedCaptions =
		dub && !officialCaptions
			? others.filter((s) => s.language === 'English' && /\bCC\b|\bSDH\b/i.test(s.fileName) && !madeForJapanese(s))
			: [];
	const rest = others.filter((s) => !markedCaptions.includes(s) && !japaneseRelease.includes(s));

	// Aniwave's own subtitle server often doesn't answer, so its files go last.
	const list: Option[] = [...askCheck, ...japaneseRelease, ...markedCaptions, ...fromTosho, ...fromNexus, ...rest, ...fromPlayer];

	// Anime in Japanese: subtitles on from the start, the best English there is. (The player
	// moves on to the next English one if this one won't download.)
	// Not over a picture that already has them (Aniwave's burned-in Japanese version).
	if (anime && !dub && share?.kind !== 'sub') {
		const usable = list.filter((s) => !s.check);
		const pick =
			japaneseRelease[0] ??
			usable.find((s) => (s.source === 'anime.nexus' || s.source === 'AnimeTosho') && s.fileName === 'English') ??
			usable.find((s) => s.language === 'English' && s.source !== 'Aniwave') ??
			usable.find((s) => s.language === 'English');
		if (pick) pick.default = true;
	}

	return json(list);
};
