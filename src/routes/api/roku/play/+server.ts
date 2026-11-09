import { error, json } from '@sveltejs/kit';
import { getWatchProgress } from '$lib/server/db/queries';
import { PREFERRED_QUALITY, pickFile } from '$lib/watch';
import { readSettings } from '$lib/server/settings';
import { seasonEpisodes } from '$lib/server/tvEpisodes';
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
	if (wanted.season) params.set('resume_s', String(wanted.season));
	if (wanted.season && wanted.episode) params.set('resume_e', String(wanted.episode));
	const [found, anime] = await Promise.all([
		ask<{ title: string; shareKey?: string; files?: FileOption[]; episodes?: { episodes: Episode[] }; posterUrl?: string; error?: string; audioLanguage?: string }>(`/api/watch/resolve?${params}`),
		ask<{ anime?: boolean }>(`/api/watch/is-anime?${new URLSearchParams({ title, type, year })}`)
	]);
	if (!found || found.error) return json({ error: "Couldn't find that to play." });

	// The episode: the one asked for, else the first that plays (specials aside).
	const playable = (found.episodes?.episodes ?? []).filter((ep) => ep.available !== false && ep.files.length > 0);
	const episode =
		type === 'tv'
			? (playable.find((ep) => ep.season === wanted.season && ep.episode === wanted.episode) ??
				playable.find((ep) => ep.season > 0) ??
				playable[0] ??
				null)
			: null;
	if (type === 'tv' && !episode) return json({ error: 'No episode of that can be played right now.' });
	const listed = (type === 'tv' ? episode!.files : (found.files ?? [])).filter((f) => !f.hevc);
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
	let chosen: { file: FileOption; url: string } | null = null;
	let wrongVideo = false;
	for (const file of order.slice(0, 4)) {
		const share = file.shareKey || episode?.shareKey || found.shareKey || '';
		if (!share) continue;
		const stream = await ask<{ url?: string }>(`/api/watch/stream?share_key=${encodeURIComponent(share)}&fid=${file.fid}${fresh && file === first ? '&refresh=1' : ''}`);
		if (stream?.url) {
			const address = new URL(stream.url, url.origin).href;
			// Far longer than the episode (more than double, and 10 minutes over): another video.
			if (runtime > 0 && file.source) {
				const length = await playlistLength(address, forward);
				if (length > runtime * 60 * 2 + 600) {
					wrongVideo = true;
					continue;
				}
			}
			chosen = { file, url: address };
			break;
		}
	}
	if (!chosen) return json({ error: wrongVideo ? "The only copy found of this episode is a different video." : "That can't be played right now." });

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
	const fromShowbox = !new URL(chosen.url).pathname.startsWith('/api/');
	const shareKey = chosen.file.shareKey || episode?.shareKey || found.shareKey || '';
	// Only the copy's top quality: the Roku's player would otherwise start lower and change quality
	// by itself, which Catalog never does (the player's holdLevel). In kbps, for MinBandwidth.
	const format = /\.mp4(\?|$)/i.test(chosen.url) ? 'mp4' : 'hls';
	// Showbox's own playlist goes through /api/roku/hls: its top quality with AAC sound only (the
	// ec-3 one it was held to played on no Roku: every title "finished" at once). One quality, so
	// no MinBandwidth for it.
	const plainShowbox = fromShowbox && format === 'hls';
	const address = plainShowbox ? new URL(`/api/roku/hls?${new URLSearchParams({ u: chosen.url })}`, url.origin).href : chosen.url;
	const minBandwidth = format === 'hls' && !plainShowbox ? await topBandwidth(chosen.url, forward) : 0;
	// English subtitles (/api/roku/subtitles), unless they're part of the picture.
	const subtitles = new URLSearchParams({ title: found.title, type, year, share: chosen.file.source ? shareKey : '' });
	if (episode) {
		subtitles.set('season', String(season));
		subtitles.set('episode', String(number));
	}

	// Preview pictures while fast-forwarding (/api/roku/bif, from the computer's for this copy):
	// the computer is asked to make them now if it hasn't, without waiting, so nothing starts later.
	const which = { title: found.title, type, season: String(season), episode: String(number), fid: String(chosen.file.fid), share: shareKey };
	const bif = /\.mp4(\?|$)/i.test(chosen.url) ? null : new URL(`/api/roku/bif?${new URLSearchParams(which)}`, url.origin).href;
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

	return json({
		url: address,
		copies,
		format,
		minBandwidth,
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

/** The highest H.264 quality a playlist lists, in kbps; 0 for a single-quality one or no answer. */
async function topBandwidth(playlist: string, headers: Record<string, string>): Promise<number> {
	try {
		const r = await fetch(playlist, { headers, signal: AbortSignal.timeout(5000) });
		if (!r.ok) return 0;
		const qualities = (await r.text()).match(/#EXT-X-STREAM-INF:[^\n]*/g) ?? [];
		const bandwidths = qualities
			// (Not HEVC, nor Dolby sound a Roku may not play: the top would be the only one allowed.)
			.filter((line) => !/hvc1|hev1|ec-3|ac-3/i.test(line))
			.map((line) => Number(line.match(/[:,]BANDWIDTH=(\d+)/)?.[1] ?? 0));
		return bandwidths.length > 1 ? Math.floor(Math.max(...bandwidths) / 1000) : 0;
	} catch {
		return 0;
	}
}

/** A playlist's length in seconds (its first quality's pieces added up); 0 when it can't be read. */
async function playlistLength(address: string, headers: Record<string, string>): Promise<number> {
	try {
		const read = async (at: string) => {
			const r = await fetch(at, { headers, signal: AbortSignal.timeout(15_000) });
			return r.ok ? r.text() : '';
		};
		let text = await read(address);
		if (/#EXT-X-STREAM-INF/.test(text)) {
			const next = text.split('\n').find((l) => l.trim() && !l.startsWith('#'));
			text = next ? await read(new URL(next.trim(), address).href) : '';
		}
		return [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
	} catch {
		return 0;
	}
}
