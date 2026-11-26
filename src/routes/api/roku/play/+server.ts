import { videoFromShare } from '$lib/youtubeDevice';
import { error, json } from '@sveltejs/kit';
import { getWatchProgress } from '$lib/server/db/queries';
import { PREFERRED_QUALITY, pickFile } from '$lib/watch';
import { readSettings } from '$lib/server/settings';
import { seasonEpisodes } from '$lib/server/tvEpisodes';
import { qualitiesAt, rokuScreen } from '$lib/server/rokuQualities';
import { reportProblem } from '$lib/server/online';
import { reportScreen } from '$lib/server/reportScreen';
import type { RequestHandler } from './$types';

/**
 * What the Roku plays (roku/README.md): ?title=&type=tv|movie&year=&season=&episode=. Found the
 * way Catalog's own player finds it (/api/watch/resolve, then /api/watch/stream), asked as the
 * Roku (its PIN cookie and profile), with the copy picked the same way: Showbox's best, else
 * another source's (Japanese audio for anime). If a copy's link can't be had, the next one.
 *
 * Answers the video's address and the headers it needs, where to start (where it was left,
 * unless that was the end), the next episode, and whether it's anime (Japanese audio and
 * English subtitles on, as in Catalog's player). The Roku saves its place with
 * /api/watch/progress, as the player does.
 */
type FileOption = { fid: number; quality: string; name: string; size: string; source?: string; shareKey?: string; audio?: string; hevc?: boolean; burnedIn?: boolean };
type Episode = { season: number; episode: number; files: FileOption[]; shareKey?: string; available?: boolean; name?: string };

export const GET: RequestHandler = async ({ url, request }) => {
	const title = url.searchParams.get('title')?.trim() ?? '';
	const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const year = url.searchParams.get('year') ?? '';
	const wanted = { season: Number(url.searchParams.get('season') ?? 0), episode: Number(url.searchParams.get('episode') ?? 0) };
	// A fresh link (the last one stopped working on the Roku).
	const fresh = url.searchParams.get('refresh') === '1';
	if (!title) return error(400, 'What to play?');

	// Couldn't be played: said on the Roku, and sent to the owner as a problem report too.
	const cantPlay = (message: string, why: Record<string, unknown> = {}) => {
		const name = type === 'tv' && wanted.episode ? `${title} S${wanted.season}E${wanted.episode}` : title;
		reportProblem('error', `Roku: ${name}`.slice(0, 160), { ...reportScreen(request), error: message, ...why });
		return json({ error: message });
	};

	// Asked of this same Catalog as the Roku, so its PIN and profile carry over.
	const forward: Record<string, string> = {};
	for (const name of ['cookie', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) forward[name] = value;
	}
	const ask = <T>(path: string): Promise<T | null> =>
		fetch(new URL(path, url.origin), { headers: forward, signal: AbortSignal.timeout(90_000) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);

	const params = new URLSearchParams({ title, type, nostream: '1' });
	if (year) params.set('year', year);
	if (wanted.season || wanted.episode) params.set('resume_s', String(wanted.season));
	if (wanted.episode) params.set('resume_e', String(wanted.episode));
	const [found, anime] = await Promise.all([
		ask<{ title: string; shareKey?: string; files?: FileOption[]; episodes?: { episodes: Episode[] }; posterUrl?: string; error?: string; audioLanguage?: string }>(`/api/watch/resolve?${params}`),
		ask<{ anime?: boolean }>(`/api/watch/is-anime?${new URLSearchParams({ title, type, year })}`)
	]);
	if (!found || found.error) return cantPlay("Couldn't find that to play.", { why: found?.error ?? 'no answer from the title lookup' });

	// Only an unspecific Play request can fall back to the first episode.
	const playable = (found.episodes?.episodes ?? []).filter((ep) => ep.available !== false && ep.files.some(f => !videoFromShare(f.shareKey)));
	const episode =
		type === 'tv'
			? wanted.episode > 0
				? playable.find((ep) => ep.season === wanted.season && ep.episode === wanted.episode)
				: playable.find((ep) => ep.season > 0) ?? playable[0]
			: null;
	if (type === 'tv' && !episode) return cantPlay(wanted.episode > 0 ? 'That episode can’t be played right now.' : 'No episode of that can be played right now.');
	const listed = (type === 'tv' ? episode!.files : (found.files ?? [])).filter((f) => !f.hevc && !videoFromShare(f.shareKey));
	// Showbox is optional: not signed in to Febbox, its copies go whenever another source has it
	// (the same as the computer's and Fire TV's player).
	const others = listed.filter((f) => f.source);
	const files = readSettings().febboxToken || !others.length ? listed : others;
	const audio = anime?.anime ? 'Japanese' : '';

	// The copy Catalog's player would pick first, then the rest.
	// This profile's audio language first, when there's a dubbed copy in it (the original next).
	// (Never a 4K file for its 1080p: the Roku picks its quality itself and would play the 4K.)
	// A copy picked in the player's menu (?fid=&copy=) comes first; the rest only if it won't play.
	const pickedFid = url.searchParams.get('fid');
	const pickedCopy = url.searchParams.get('copy') ?? '';
	const byHand = pickedFid !== null ? files.find((f) => String(f.fid) === pickedFid && (!pickedCopy || (f.shareKey ?? '') === pickedCopy || !f.source)) : undefined;
	const first = byHand ?? files.find((f) => found.audioLanguage && f.audio === found.audioLanguage) ?? pickFile(files, PREFERRED_QUALITY, audio, () => false);
	const order = first ? [first, ...files.filter((f) => f !== first)] : files;
	// How long the episode is (TMDB), to turn down another source's copy that's some other video:
	// Movy answered The Odyssey (1968)'s 50-minute first episode with a 2-hour film (2026-11-08).
	const tmdbShow = Number(/:tv:(\d+):/.exec(listed.find((f) => /:tv:\d+:/.test(f.shareKey ?? ''))?.shareKey ?? '')?.[1] ?? 0);
	const runtime = type === 'tv' && episode && tmdbShow ? ((await seasonEpisodes(tmdbShow, episode.season).catch(() => [])).find((e) => e.episode === episode.episode)?.runtime ?? 0) : 0;
	const headersAt = (address: URL) => address.origin === url.origin ? forward : { 'user-agent': forward['user-agent'] ?? '' };
	let chosen: { file: FileOption; url: URL; format: StreamFormat } | null = null;
	let wrongVideo = false;
	for (const file of order.slice(0, 4)) {
		const share = file.shareKey || episode?.shareKey || found.shareKey || '';
		if (!share) continue;
		const stream = await ask<{ url?: string; debug?: string }>(`/api/watch/stream?share_key=${encodeURIComponent(share)}&fid=${file.fid}${fresh && file === first ? '&refresh=1' : ''}`);
		if (stream?.url) {
			const address = URL.parse(stream.url, url.origin);
			if (!address || !['http:', 'https:'].includes(address.protocol)) continue;
			const format = formatOf(address.pathname) ?? (address.origin !== url.origin ? formatOf(stream.debug ?? '') : undefined) ?? 'hls';
			// Far longer than the episode (more than double, and 10 minutes over): another video.
			if (runtime > 0 && file.source && format === 'hls') {
				const length = await playlistLength(address, headersAt);
				if (length > runtime * 60 * 2 + 600) {
					wrongVideo = true;
					continue;
				}
			}
			chosen = { file, url: address, format };
			break;
		}
	}
	if (!chosen) return cantPlay(wrongVideo ? 'The only copy found of this episode is a different video.' : "That can't be played right now.", { copiesTried: order.slice(0, 4).map((f) => `${f.source ?? 'Showbox'} ${f.quality}`) });

	const season = episode?.season ?? 0;
	const number = episode?.episode ?? 0;
	const saved = getWatchProgress(found.title, type, season, number);
	const start = saved && saved.duration > 0 && saved.currentTime > 10 && saved.currentTime / saved.duration < 0.95 ? Math.floor(saved.currentTime) : 0;
	const at = episode ? playable.indexOf(episode) : -1;
	// Its number counted from the show's first episode (how AniSkip counts), for /api/roku/skips.
	let overall = number;
	for (const s of new Set(playable.map((ep) => ep.season))) {
		if (s < 1 || s >= season) continue;
		overall += Math.max(0, ...playable.filter((ep) => ep.season === s).map((ep) => ep.episode));
	}
	const next = at >= 0 ? (playable.slice(at + 1).find((ep) => ep.season > 0 || episode!.season === 0) ?? null) : null;
	// Showbox's own video server wants Febbox's Referer (what the desktop app and the TV app add).
	const fromShowbox = !chosen.file.source && chosen.url.origin !== url.origin;
	const shareKey = chosen.file.shareKey || episode?.shareKey || found.shareKey || '';
	const { format } = chosen;
	// Showbox's own playlist goes through /api/roku/hls: its top quality with AAC sound only (the
	// ec-3 one it was held to played on no Roku: every title "finished" at once). One quality, so
	// no MinBandwidth for it.
	const plainShowbox = fromShowbox && format === 'hls';
	const address = plainShowbox ? new URL(`/api/roku/hls?${new URLSearchParams({ u: chosen.url.href })}`, url.origin).href : chosen.url.href;
	// The qualities it can show, best first (server/rokuQualities.ts): held at the first, the rest to
	// step down to if that won't start.
	const qualities = format === 'hls' && !plainShowbox ? await qualitiesAt(chosen.url.href, headersAt(chosen.url), rokuScreen(request)) : [];
	const minBandwidth = qualities.length > 1 ? qualities[0] : 0;
	// English subtitles (/api/roku/subtitles), unless they're part of the picture.
	const subtitles = new URLSearchParams({ title: found.title, type, year, share: chosen.file.source ? shareKey : '' });
	if (episode) {
		subtitles.set('season', String(season));
		subtitles.set('episode', String(number));
	}

	// Preview pictures while fast-forwarding (/api/roku/bif, from the computer's for this copy):
	// the computer is asked to make them now if it hasn't, without waiting, so nothing starts later.
	const which = { title: found.title, type, season: String(season), episode: String(number), fid: String(chosen.file.fid), share: shareKey };
	const bif = format === 'hls' ? new URL(`/api/roku/bif?${new URLSearchParams(which)}`, url.origin).href : null;
	if (bif) {
		fetch(new URL('/api/watch/strip/prepare', url.origin), {
			method: 'POST',
			headers: { ...forward, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...which, year, share: chosen.file.source ? shareKey : undefined })
		}).catch(() => {});
	}

	// Every copy, for the player menu's Source (as the Fire TV's lists them).
	const copies = files.map((f) => ({
		fid: f.fid,
		copy: f.shareKey ?? '',
		label: [f.source ?? 'Showbox', f.quality, f.audio, f.size].filter(Boolean).join(' · ')
	}));

	// What the Roku falls back to when it can't play Showbox's one quality: its playlist with all
	// its AAC qualities. (Other sources step down `qualities` instead.)
	const fallback = plainShowbox ? `${address}&all=1` : null;

	return json({
		url: address,
		fallback,
		copies,
		format,
		minBandwidth,
		qualities,
		bif,
		headers: fromShowbox ? ['Referer: https://www.febbox.com/'] : [],
		title: found.title,
		type,
		year,
		season,
		episode: number,
		episodeName: episode?.name ?? '',
		source: chosen.file.source ?? 'Showbox',
		shareKey,
		fid: chosen.file.fid,
		overall,
		// What the computer's own intro-and-credits finding keeps it under (skipKeyOf).
		copy: chosen.file.source ? shareKey : String(chosen.file.fid),
		poster: found.posterUrl ?? '',
		start,
		anime: Boolean(anime?.anime),
		subtitles: chosen.file.burnedIn ? null : new URL(`/api/roku/subtitles?${subtitles}`, url.origin).href,
		next: next ? { season: next.season, episode: next.episode } : null
	});
};

type StreamFormat = 'hls' | 'mp4' | 'mkv' | 'dash';

function formatOf(name: string): StreamFormat | undefined {
	if (/\.m3u8$/i.test(name)) return 'hls';
	if (/\.(mp4|m4v|mov)$/i.test(name)) return 'mp4';
	if (/\.mkv$/i.test(name)) return 'mkv';
	if (/\.mpd$/i.test(name)) return 'dash';
}

/** A playlist's length in seconds (its first quality's pieces added up); 0 when it can't be read. */
async function playlistLength(address: URL, headersAt: (url: URL) => Record<string, string>): Promise<number> {
	try {
		const read = async (at: URL) => {
			const r = await fetch(at, { headers: headersAt(at), signal: AbortSignal.timeout(15_000) });
			return { text: r.ok ? await r.text() : '', base: r.url || at.href };
		};
		let { text, base } = await read(address);
		if (/#EXT-X-STREAM-INF/.test(text)) {
			const next = text.split('\n').find((l) => l.trim() && !l.startsWith('#'));
			text = next ? (await read(new URL(next.trim(), base))).text : '';
		}
		return [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
	} catch {
		return 0;
	}
}
