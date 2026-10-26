import { error, json } from '@sveltejs/kit';
import { getWatchProgress } from '$lib/server/db/queries';
import { PREFERRED_QUALITY, pickFile } from '$lib/watch';
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
		ask<{ title: string; shareKey?: string; files?: FileOption[]; episodes?: { episodes: Episode[] }; posterUrl?: string; error?: string }>(`/api/watch/resolve?${params}`),
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
	const files = (type === 'tv' ? episode!.files : (found.files ?? [])).filter((f) => !f.hevc);
	const audio = anime?.anime ? 'Japanese' : '';

	// The copy Catalog's player would pick first, then the rest.
	const first = pickFile(files, PREFERRED_QUALITY, audio);
	const order = first ? [first, ...files.filter((f) => f !== first)] : files;
	let chosen: { file: FileOption; url: string } | null = null;
	for (const file of order.slice(0, 4)) {
		const share = file.shareKey || episode?.shareKey || found.shareKey || '';
		if (!share) continue;
		const stream = await ask<{ url?: string }>(`/api/watch/stream?share_key=${encodeURIComponent(share)}&fid=${file.fid}${fresh && file === first ? '&refresh=1' : ''}`);
		if (stream?.url) {
			chosen = { file, url: new URL(stream.url, url.origin).href };
			break;
		}
	}
	if (!chosen) return json({ error: "That can't be played right now." });

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
	// English subtitles (/api/roku/subtitles), unless they're part of the picture.
	const subtitles = new URLSearchParams({ title: found.title, type, year, share: chosen.file.source ? shareKey : '' });
	if (episode) {
		subtitles.set('season', String(season));
		subtitles.set('episode', String(number));
	}

	return json({
		url: chosen.url,
		format: /\.mp4(\?|$)/i.test(chosen.url) ? 'mp4' : 'hls',
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
