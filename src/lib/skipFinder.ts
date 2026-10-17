/**
 * Intro and credits found by comparing an episode's sound with a neighbouring episode's (the
 * matching is introFinder.ts). Only the first 6 and last 5 minutes of each are fetched, from the
 * stereo sound track (about 10 MB an episode), and the answer is kept for both episodes, so
 * watching in order costs one comparison per episode or less.
 *
 * Tried on Delicious in Dungeon S1E2–4: the intro is 0:00–1:30 in each (AniSkip, for the one
 * episode it has, says 1:40, which is why its Skip Intro stayed up after the song), and the
 * credits the last 1½ minutes.
 */
import { RATE } from './introFinder';
import { readSoundTrack, soundBetween, soundTrackIn } from './soundTrack';

const HEAD = 6 * 60;
const TAIL = 5 * 60;

export type Found = { type: 'intro' | 'credits'; start: number; end: number };

/** What was found in each of the two episodes; null if a sound track couldn't be read. */
export async function findSkips(
	playlistA: string,
	playlistB: string,
	canFetch: () => boolean,
	signal: AbortSignal
): Promise<[Found[], Found[]] | null> {
	const [a, b] = await Promise.all([readSoundTrack(playlistA, signal), readSoundTrack(playlistB, signal)]);
	if (!a || !b) return null;
	const pieces = [];
	for (const [track, from, to] of [
		[a, 0, HEAD],
		[b, 0, HEAD],
		[a, a.duration - TAIL, a.duration],
		[b, b.duration - TAIL, b.duration]
	] as const) {
		// Only while the video has plenty to play, so it never causes a stop.
		while (!canFetch()) {
			await new Promise((r) => setTimeout(r, 1000));
			if (signal.aborted) return null;
		}
		pieces.push(await soundBetween(track, Math.max(0, from), to, RATE, signal));
	}
	const [headA, headB, tailA, tailB] = pieces;

	const worker = new Worker(new URL('./skipFinder.worker.ts', import.meta.url), { type: 'module' });
	try {
		const result = await new Promise<{ intro: Shared | null; credits: Shared | null }>((resolve, reject) => {
			worker.onmessage = (event) => resolve(event.data);
			worker.onerror = reject;
			signal.addEventListener('abort', () => reject(new Error('stopped')));
			worker.postMessage({ heads: [headA.samples, headB.samples], tails: [tailA.samples, tailB.samples] });
		});
		const forEach = (which: 'a' | 'b', head: number, tail: number): Found[] => {
			const found: Found[] = [];
			const { intro, credits } = result;
			// An opening song is a minute or two; anything far longer is something else shared.
			if (intro && intro.length <= 180) found.push({ type: 'intro', start: head + intro[which], end: head + intro[which] + intro.length });
			if (credits && credits.length <= 240) found.push({ type: 'credits', start: tail + credits[which], end: tail + credits[which] + credits.length });
			return found;
		};
		return [forEach('a', headA.at, tailA.at), forEach('b', headB.at, tailB.at)];
	} finally {
		worker.terminate();
	}
}

type Shared = { a: number; b: number; length: number };

type EpisodeFiles = {
	season: number;
	episode: number;
	files: { fid: number; quality: string; source?: string }[];
	shareKey?: string;
	available?: boolean;
};

/**
 * Finds one episode's intro and credits by comparing it with the next episode of its season
 * (or the one before, when there's no next or they share nothing), keeps the answer for both,
 * and returns this episode's. Used by the player, and by the computer for a TV (/skip-maker).
 * `master`: the main playlist of the copy `fid` being played.
 */
export async function findAndKeepSkips(options: {
	episodes: EpisodeFiles[];
	season: number;
	episode: number;
	fid: number;
	quality: string;
	master: string;
	mainShareKey: string;
	language: string;
	canFetch: () => boolean;
	signal: AbortSignal;
}): Promise<Found[] | null> {
	const { episodes, season, episode, master, language, signal } = options;
	// Only a video with a separate sound track (a playlist) can be compared this way.
	if (!master.includes('.m3u8')) return null;
	const at = episodes.findIndex((e) => e.season === season && e.episode === episode);
	const neighbours = [episodes[at + 1], episodes[at - 1]].filter(
		(e): e is EpisodeFiles => !!e && e.season === season && e.available !== false && e.files.length > 0
	);
	for (const [n, other] of neighbours.entries()) {
		const found = await neighbourPlaylist(other, options.quality, options.mainShareKey, signal);
		if (!found) continue;
		const [mine, theirs] = await Promise.all([soundTrackIn(master, language, signal), soundTrackIn(found.url, language, signal)]);
		if (!mine || !theirs) return null;
		const result = await findSkips(mine, theirs, options.canFetch, signal);
		if (!result || signal.aborted) return null;
		const [forMine, forTheirs] = result;
		// Nothing in common (a new opening song from this episode on): try the other side.
		if (!forMine.length && n < neighbours.length - 1) continue;
		const keep = [{ fid: options.fid, segments: forMine }, ...(forTheirs.length ? [{ fid: found.fid, segments: forTheirs }] : [])];
		await fetch('/api/watch/skip-found', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ found: keep })
		}).catch(() => {});
		return forMine;
	}
	return null;
}

/**
 * A playlist link for one of another episode's Showbox copies, the same quality as this one
 * first (some copies are single MP4 files, with no separate sound track to compare).
 */
async function neighbourPlaylist(other: EpisodeFiles, quality: string, mainShareKey: string, signal: AbortSignal) {
	const copies = other.files.filter((f) => !f.source).sort((a, b) => Number(b.quality === quality) - Number(a.quality === quality));
	for (const copy of copies.slice(0, 3)) {
		const resp = await fetch(`/api/watch/stream?share_key=${other.shareKey || mainShareKey}&fid=${copy.fid}`, { signal });
		const url = resp.ok ? (((await resp.json()) as { url?: string }).url ?? '') : '';
		if (url.includes('.m3u8')) return { url, fid: copy.fid };
	}
	return null;
}
