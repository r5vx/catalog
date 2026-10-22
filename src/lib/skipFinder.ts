/**
 * Intro and credits found by comparing an episode's sound with a neighbouring episode's (the
 * matching is introFinder.ts). Only the first 6 and last 5 minutes of each are used, and the
 * answer is kept for both episodes, so watching in order costs one comparison per episode or less.
 *
 * Works on every source:
 *   - the neighbour is read from any copy with a separate sound track (Showbox's, or 7Movies'
 *     Orion copy), about 10 MB;
 *   - the episode being watched is read from its own separate sound track when it has one, and
 *     otherwise heard from what the player downloads anyway (`DownloadedSound`: 7Movies' H.264
 *     copy, Movy, Aniwave), so nothing extra is fetched for it. Then the intro is found once the
 *     first minutes have downloaded, and the credits once the last ones have.
 *
 * Tried on Delicious in Dungeon S1E2–4: the intro is 0:00–1:30 in each (AniSkip, for the one
 * episode it has, says 1:40, which is why its Skip Intro stayed up after the song), and the
 * credits the last 1½ minutes.
 */
import { RATE } from './introFinder';
import { readSoundTrack, soundBetween, soundTrackIn } from './soundTrack';
import type { DownloadedSound } from './downloadedSound';

export const HEAD = 6 * 60;
export const TAIL = 5 * 60;

export type Found = { type: 'intro' | 'credits'; start: number; end: number };
type Shared = { a: number; b: number; length: number };
type Sound = { at: number; samples: Float32Array };

/**
 * What a copy's found intro and credits are kept under: a Showbox file's number, or another
 * source's share key (which says the show, the episode and the version: their file numbers are
 * the same for every episode).
 */
export function skipKeyOf(file: { fid: number; source?: string; shareKey?: string }): string {
	return file.source ? (file.shareKey ?? '') : String(file.fid);
}

/** The longest shared runs near the start and near the end of two episodes (in a worker). */
async function compare(heads: [Float32Array, Float32Array], tails: [Float32Array, Float32Array], signal: AbortSignal) {
	const worker = new Worker(new URL('./skipFinder.worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<{ intro: Shared | null; credits: Shared | null }>((resolve, reject) => {
			worker.onmessage = (event) => resolve(event.data);
			worker.onerror = reject;
			signal.addEventListener('abort', () => reject(new Error('stopped')));
			worker.postMessage({ heads, tails });
		});
	} finally {
		worker.terminate();
	}
}

const empty = new Float32Array(0);

/** Turns the shared runs into what each episode has, given where each piece of sound began. */
function answers(result: { intro: Shared | null; credits: Shared | null }, head: [number, number], tail: [number, number]): [Found[], Found[]] {
	const forEach = (which: 'a' | 'b', i: 0 | 1): Found[] => {
		const found: Found[] = [];
		const { intro, credits } = result;
		// An opening song is a minute or two; anything far longer is something else shared.
		if (intro && intro.length <= 180) found.push({ type: 'intro', start: head[i] + intro[which], end: head[i] + intro[which] + intro.length });
		if (credits && credits.length <= 240) found.push({ type: 'credits', start: tail[i] + credits[which], end: tail[i] + credits[which] + credits.length });
		return found;
	};
	return [forEach('a', 0), forEach('b', 1)];
}

/** What was found in each of two episodes, from their separate sound tracks; null if unreadable. */
export async function findSkips(
	playlistA: string,
	playlistB: string,
	canFetch: () => boolean,
	signal: AbortSignal
): Promise<[Found[], Found[]] | null> {
	const [a, b] = await Promise.all([readSoundTrack(playlistA, signal), readSoundTrack(playlistB, signal)]);
	if (!a || !b) return null;
	const pieces: Sound[] = [];
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
	const result = await compare([headA.samples, headB.samples], [tailA.samples, tailB.samples], signal);
	return answers(result, [headA.at, headB.at], [tailA.at, tailB.at]);
}

type EpisodeFiles = {
	season: number;
	episode: number;
	files: { fid: number; quality: string; source?: string; shareKey?: string; hevc?: boolean }[];
	shareKey?: string;
	available?: boolean;
};

async function keep(found: { key: string; segments: Found[] }[]) {
	await fetch('/api/watch/skip-found', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ found })
	}).catch(() => {});
}


/** A copy's kept intro and credits (null: not looked for yet). */
async function kept(key: string, signal: AbortSignal): Promise<Found[] | null> {
	const resp = await fetch(`/api/watch/skip-found?key=${encodeURIComponent(key)}`, { signal }).catch(() => null);
	if (!resp?.ok) return null;
	return ((await resp.json()) as { segments: Found[] | null }).segments;
}

const playable = (e: EpisodeFiles | undefined, season: number): e is EpisodeFiles =>
	!!e && e.season === season && e.available !== false && e.files.length > 0;

/**
 * Finds one episode's intro and credits by comparing it with the next episode of its season
 * (or the one before, when there's no next or they share nothing), keeps the answer for both,
 * and returns this episode's. Used by the player, and by the computer for a TV (/skip-maker).
 * `master`: the main playlist of the copy being played (`key`: skipKeyOf it). `heard`: what the
 * player downloads of it, for a copy with no separate sound track.
 */
export async function findAndKeepSkips(options: {
	episodes: EpisodeFiles[];
	season: number;
	episode: number;
	key: string;
	quality: string;
	master: string;
	mainShareKey: string;
	language: string;
	heard?: DownloadedSound | null;
	/** Told what's found so far, before the rest (from downloads: the intro comes first). */
	onFound?: (found: Found[]) => void;
	/**
	 * A neighbour's intro and credits worked out elsewhere (a TV asks the computer), for an
	 * episode heard from downloads: null if they couldn't be had. Without it, worked out here.
	 */
	referenceFrom?: (neighbour: EpisodeFiles & { copy: string }) => Promise<Found[] | null>;
	/** What's kept for this copy already but incomplete (an intro without the credits). */
	known?: Found[];
	canFetch: () => boolean;
	signal: AbortSignal;
}): Promise<Found[] | null> {
	const { episodes, season, episode, master, language, signal } = options;
	const at = episodes.findIndex((e) => e.season === season && e.episode === episode);
	// (Only a playlist has a separate sound track to read; a plain MP4 would be downloaded whole.
	// The relay's playlists have no ".m3u8" in their address.)
	const isPlaylist = master.includes('.m3u8') || master.startsWith('/api/watch/relay');
	const mineTrack = isPlaylist ? await soundTrackIn(master, language, signal).catch(() => null) : null;
	if (!mineTrack) return options.heard ? fromDownloads(options, at, options.heard) : null;

	const neighbours = [episodes[at + 1], episodes[at - 1]].filter((e) => playable(e, season));
	for (const [n, other] of neighbours.entries()) {
		const theirs = await neighbourTrack(other, options.quality, options.mainShareKey, language, signal);
		if (!theirs) continue;
		const result = await findSkips(mineTrack, theirs.playlist, options.canFetch, signal);
		if (!result || signal.aborted) return null;
		const [forMine, forTheirs] = result;
		// Nothing in common (a new opening song from this episode on): try the other side.
		if (!forMine.length && n < neighbours.length - 1) continue;
		await keep([{ key: options.key, segments: forMine }, ...(forTheirs.length ? [{ key: theirs.key, segments: forTheirs }] : [])]);
		return forMine;
	}
	return null;
}

/**
 * For a copy whose sound comes inside the picture (7Movies' H.264 copy, Movy, Aniwave), heard
 * only as the player downloads it — about half a minute ahead of what's on screen:
 *   1. the intro and credits of a copy with a separate sound track — this same episode's
 *      (Showbox's, or 7Movies' Orion copy) if there is one, else a neighbouring episode's — kept
 *      from before, or worked out by comparing it with the episode beside it;
 *   2. that intro's sound looked for in what's been downloaded of this one. ~20 s of a match
 *      places it, so it's found before it's on screen. Copies of one episode differ only by a
 *      shift (7Movies' Dungeon Meshi E4 runs 1 s later than Showbox's, Movy's E5 11 s), so with
 *      this episode's own copy the credits are placed at once by the same shift, then checked
 *      when the end has downloaded.
 * The sound tracks read are small (a few MB, from other servers than the video's), so they aren't
 * held back for the video's buffer: waiting for 30 s of it kept Movy and 7Movies from ever
 * getting there (the intro only came once paused).
 */
async function fromDownloads(
	options: Parameters<typeof findAndKeepSkips>[0],
	at: number,
	heard: DownloadedSound
): Promise<Found[] | null> {
	const { episodes, season, language, signal } = options;
	const anyTime = () => true;
	const trackOf = (e: EpisodeFiles) => neighbourTrack(e, options.quality, options.mainShareKey, language, signal);

	/** A copy's intro and credits: kept, from the computer (a TV), or worked out against `beside`. */
	const referenceOf = async (episode: EpisodeFiles, copy: { playlist: string; key: string }, beside: number[]) => {
		let reference = await kept(copy.key, signal);
		// A TV leaves the comparing (two whole sound tracks' worth) to the computer, and waits.
		if (reference === null && options.referenceFrom) return options.referenceFrom({ ...episode, copy: copy.key });
		for (const index of beside) {
			if (reference !== null || signal.aborted) break;
			const other = episodes[index];
			const third = playable(other, season) ? await trackOf(other) : null;
			if (!third) continue;
			const result = await findSkips(copy.playlist, third.playlist, anyTime, signal);
			if (!result) return null;
			await keep([{ key: copy.key, segments: result[0] }, ...(result[1].length ? [{ key: third.key, segments: result[1] }] : [])]);
			if (result[0].length) reference = result[0];
		}
		return reference;
	};

	// This episode's own copy with a separate sound track.
	const me = episodes[at];
	const twin = me ? await trackOf(me) : null;
	if (twin && twin.key !== options.key) {
		const reference = await referenceOf(me, twin, [at + 1, at - 1]);
		if (signal.aborted) return null;
		// Part of this copy known already (its intro, kept before): the shift from the twin's is
		// clear without hearing anything, so the rest follow at once — even resumed past the intro.
		const anchor = options.known?.find((k) => reference?.some((r) => r.type === k.type));
		const twinPart = anchor && reference?.find((r) => r.type === anchor.type);
		if (anchor && twinPart && reference) {
			const shift = anchor.start - twinPart.start;
			const duration = (await heard.duration(signal)) || Infinity;
			const rest = reference
				.filter((r) => !options.known!.some((k) => k.type === r.type))
				.map((r) => ({ type: r.type, start: Math.max(0, r.start + shift), end: Math.min(duration, r.end + shift) }))
				.filter((r) => r.end > r.start);
			const all = [...options.known!, ...rest];
			options.onFound?.(all);
			return finish(all);
		}
		if (reference?.length) return finish(await locate(heard, twin.playlist, reference, signal, options.onFound, true));
	}
	// Else a neighbour's, compared with the episode on its far side (never this one).
	for (const step of [1, -1]) {
		const other = episodes[at + step];
		if (!playable(other, season)) continue;
		const theirs = await trackOf(other);
		if (!theirs) continue;
		const reference = await referenceOf(other, theirs, [at + 2 * step]);
		if (signal.aborted) return null;
		if (reference?.length) return finish(await locate(heard, theirs.playlist, reference, signal, options.onFound, false));
	}
	return null;

	async function finish(found: Found[] | null) {
		if (found?.length) await keep([{ key: options.key, segments: found }]);
		return found;
	}
}

/**
 * Where another copy's intro and credits (`reference`, in its sound track `playlist`) are in this
 * one, from what's been downloaded of it: each is looked for again as more arrives, until all are
 * found or it's stopped. `sameEpisode`: the other copy is of this episode, so once one part is
 * placed the rest follow by the same shift (shown at once, then checked as their sound arrives).
 * Returns what was found (null if nothing).
 */
async function locate(
	heard: DownloadedSound,
	playlist: string,
	reference: Found[],
	signal: AbortSignal,
	onFound: ((found: Found[]) => void) | undefined,
	sameEpisode: boolean
): Promise<Found[] | null> {
	const track = await readSoundTrack(playlist, signal);
	if (!track) return null;
	const parts = await Promise.all(
		reference.map(async (seg) => ({ seg, sound: await soundBetween(track, seg.start, seg.end, RATE, signal) }))
	);
	/** Placed by their own sound. */
	const found: Found[] = [];
	/** Placed by the shift of one that was (same episode only), until their own sound confirms them. */
	let shifted: Found[] = [];
	/** How many seconds of this episode each part was last looked for in. */
	const lookedAt = new Map<string, number>();
	let running = false;
	let again = false;
	const all = () => [...found, ...shifted.filter((s) => !found.some((f) => f.type === s.type))];

	return new Promise<Found[] | null>((resolve) => {
		let stopListening = () => {};
		const done = () => {
			stopListening();
			signal.removeEventListener('abort', done);
			const answer = all();
			resolve(answer.length ? answer : null);
		};
		const look = async () => {
			if (running) {
				again = true;
				return;
			}
			running = true;
			try {
				const duration = (await heard.duration(signal)) || Infinity;
				for (const { seg, sound } of parts) {
					if (found.some((f) => f.type === seg.type) || signal.aborted) continue;
					const length = seg.end - seg.start;
					// The start of this episode for its intro, its end for the credits.
					const region = seg.type === 'intro' ? heard.longestWithin(0, HEAD) : heard.longestWithin(duration - TAIL - 2, duration);
					if (!region || region.samples.length < 15 * RATE) continue;
					// Looked at again only once 15 s more has come (light enough for a TV).
					const seconds = region.samples.length / RATE;
					if (seconds < (lookedAt.get(seg.type) ?? 0) + 15) continue;
					lookedAt.set(seg.type, seconds);
					const { intro: shared } = await compare([region.samples, sound.samples], [empty, empty], signal);
					// Enough of it matched (15 s, or nearly all of a short one) to be sure.
					if (!shared || shared.length < Math.min(15, length - 2)) continue;
					// Where the other copy's part begins, in this copy's time.
					const start = region.at + shared.a - (sound.at + shared.b - seg.start);
					found.push({ type: seg.type, start: Math.max(0, start), end: Math.min(duration, start + length) });
					if (sameEpisode && !shifted.length) {
						const shift = start - seg.start;
						shifted = reference
							.filter((r) => r.type !== seg.type)
							.map((r) => ({ type: r.type, start: Math.max(0, r.start + shift), end: Math.min(duration, r.end + shift) }))
							.filter((r) => r.end > r.start);
					}
					onFound?.(all());
				}
			} catch {
				// Stopped: done() below.
			} finally {
				running = false;
			}
			if (signal.aborted || found.length === parts.length) done();
			else if (again) {
				again = false;
				void look();
			}
		};
		if (signal.aborted) return done();
		signal.addEventListener('abort', done);
		stopListening = heard.onHeard(() => void look());
		void look();
	});
}

/**
 * A neighbouring episode's sound track (and what it's kept under): Showbox's copies first, the
 * same quality as this one first (some are single MP4 files with no separate track), then
 * 7Movies' Orion copy, whose sound is a separate track too. The rest pack their sound in with
 * the picture, which would mean downloading the video.
 */
async function neighbourTrack(other: EpisodeFiles, quality: string, mainShareKey: string, language: string, signal: AbortSignal) {
	const showbox = other.files.filter((f) => !f.source).sort((a, b) => Number(b.quality === quality) - Number(a.quality === quality));
	const separate = other.files.filter((f) => f.source === '7Movies' && f.hevc);
	for (const copy of [...showbox.slice(0, 3), ...separate]) {
		const share = copy.source ? (copy.shareKey ?? '') : other.shareKey || mainShareKey;
		const resp = await fetch(`/api/watch/stream?share_key=${encodeURIComponent(share)}&fid=${copy.fid}`, { signal }).catch(() => null);
		const url = resp?.ok ? (((await resp.json()) as { url?: string }).url ?? '') : '';
		if (!url) continue;
		const playlist = await soundTrackIn(url, language, signal).catch(() => null);
		if (playlist) return { playlist, key: skipKeyOf(copy) };
	}
	return null;
}
