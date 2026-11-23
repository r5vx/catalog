import Hls from 'hls.js';
import { RELAY_PIECE_TIMEOUT_MS } from './relayTimeout';
import type { FragmentLoaderConstructor, FragmentLoaderContext, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';

/**
 * The player's video pieces, fetched a couple ahead.
 *
 * hls.js asks for one piece at a time. When a video server is busy (evenings, on several sites
 * at once — Showbox and 7Movies both stopped to load on two connections at 7–8 pm while the
 * house connection was fine), each single download slows down, and one at a time can fall
 * behind the video even though the connection could carry far more. So while the player fetches
 * a piece, the next two are fetched alongside it — three downloads at once — and handed over
 * from memory when it asks for them.
 *
 * The pieces of Catalog's relay are fetched ahead on the computer (relayReadAhead.ts), so on the
 * computer itself they're left alone. A TV gets them over the house's Wi-Fi, though, and that's
 * where one at a time fell behind: one episode had only Movy (about 6 Mbps; 7Movies' HEVC,
 * her usual, is 1.6), the computer had it downloaded minutes ahead, and single pieces reached the
 * TV at 5–11 Mbps, "0 of the last 6 from memory", buffering (2026-10-30). So on any other device
 * they're fetched ahead too.
 *
 * When the connection is shared with something greedy (a Steam download, 2026-10-25: Showbox
 * pieces came at 0.4–1.3 Mbps, the video needs 1.9), each download only gets its share, and more
 * at once get more of it. Measured with ten big downloads running: one piece at a time 6–15
 * Mbps, three 20–57, six 42–57 (195 / 350 Mbps with the line free). So while single pieces come
 * in less than three times as fast as they play, five are fetched ahead instead of two. (Lower
 * quality isn't picked by itself: the owner turned that down.)
 *
 * Every piece's download is also noted (`recentPieces`), for the stats and the stop log.
 */
const AHEAD = 2;
const AHEAD_WHEN_SLOW = 5;
/** Single downloads this many times as fast as the video plays, or slower, count as slow. */
const SLOW_SPEED = 3;
const KEEP_MS = 2 * 60 * 1000;
/**
 * A busy server now and then leaves one download hanging while the rest come fast (an SVU
 * piece took 53 s on 2026-10-20, every other under a second). No answer after this long: the
 * same piece is asked for again alongside, and the first answer is used.
 */
const ASK_AGAIN_MS = 4_000;
/** No answer at all after this long, or no new data for HUNG_MS: given up, and the player asks itself. */
const GIVE_UP_MS = 20_000;
const HUNG_MS = 12_000;

export type PieceNote = {
	/** When it finished (ms since the page opened). */
	at: number;
	host: string;
	bytes: number;
	ms: number;
	/** Fetched ahead, so the player had it from memory. */
	ahead: boolean;
	kind: 'video' | 'audio';
	/** Seconds of video in it (0: not known). */
	seconds: number;
};

/** The last pieces downloaded, newest last. */
export const recentPieces: PieceNote[] = [];

/**
 * Told whenever bytes come in (the player's stall watch). Its downloads by hls.js tell it
 * themselves; these didn't, so a slow piece arriving in parts looked like silence, and after 10 s
 * the watch restarted the loading and then the whole video (2026-11-14), throwing the piece away.
 */
let bytesCame: () => void = () => {};

/** Reads a download through, telling `bytesCame` as it goes. */
async function readAll(response: Response, onChunk?: (size: number) => void): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array(await response.arrayBuffer());
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
		bytesCame();
		onChunk?.(size);
	}
	const all = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		all.set(chunk, at);
		at += chunk.byteLength;
	}
	return all;
}

function note(piece: PieceNote) {
	recentPieces.push(piece);
	if (recentPieces.length > 120) recentPieces.splice(0, recentPieces.length - 120);
}

const hostOf = (url: string) => {
	try {
		return new URL(url, location.href).host;
	} catch {
		return '';
	}
};

/** How a download ahead is going: bytes so far, its size when the server said, when bytes last came. */
type Progress = { got: number; total: number; firstAt: number; lastAt: number };
/** `forNext`: the next episode's first piece (keepNextStart), kept for when it starts. */
type Fetched = { at: number; bytes: Promise<ArrayBuffer | null>; kind: PieceNote['kind']; stop: AbortController; progress: Progress; forNext?: boolean };
const fetched = new Map<string, Fetched>();
const NEXT_KEEP_MS = 10 * 60 * 1000;

/*
 * Pieces are kept by address. Febbox's playlists are made afresh each time they're asked for,
 * with new signatures after the "?" (and sometimes another server), so the next episode's first
 * piece fetched ahead would never match the one its player asks for later: its pieces are known
 * by their path alone (/video/<file>/video_1080p_000.m4s, /hls/…/audio_1_0.m4s).
 */
const FEBBOX_PIECE = /\/(video\/\d+\/video_[a-z0-9]+_\d+|hls\/.+\/audio_\d+_\d+)\.m4s$/i;
function keyOf(url: string): string {
	try {
		const parsed = new URL(url, location.href);
		return FEBBOX_PIECE.test(parsed.pathname) ? parsed.pathname : url;
	} catch {
		return url;
	}
}

function drop(key: string, entry: Fetched) {
	entry.stop.abort();
	fetched.delete(key);
}

function forgetOld() {
	const now = Date.now();
	for (const [key, entry] of fetched) if (now - entry.at > (entry.forNext ? NEXT_KEEP_MS : KEEP_MS)) drop(key, entry);
	for (const [key, entry] of fetched) {
		if (fetched.size <= 2 * (AHEAD_WHEN_SLOW + 1) + 2) break;
		if (!entry.forNext) drop(key, entry);
	}
}

/**
 * Stops every download ahead (another episode is starting: the last one's pieces only take its
 * line), except the next episode's first pieces, which are what it starts with.
 */
export function stopFetchingAhead(): void {
	for (const [key, entry] of fetched) if (!entry.forNext) drop(key, entry);
}

/**
 * The next episode's first pieces, fetched while this one ends (WatchPlayer `keepNextStart`), so
 * autoplay into it starts from memory instead of waiting on Febbox's server: its first piece took
 * 3–7 s there on 2026-11-14. About 4 MB, once per episode.
 */
export function fetchNextStart(pieces: { url: string; kind: PieceNote['kind']; seconds: number }[]): void {
	for (const piece of pieces) {
		const key = keyOf(piece.url);
		if (fetched.has(key)) continue;
		const stop = new AbortController();
		const progress: Progress = { got: 0, total: 0, firstAt: 0, lastAt: 0 };
		fetched.set(key, { at: Date.now(), bytes: fetchPiece(piece.url, piece.kind, piece.seconds, stop.signal, progress), kind: piece.kind, stop, progress, forNext: true });
	}
}

/** More than half of it here already: cheaper to let it finish than to throw it away. */
const mostlyHere = (p: Progress) => p.total > 0 && p.got >= p.total / 2;

/**
 * A download that is going about as fast as the others is left alone: asking for the same piece
 * again only splits the line between two copies of it. Asked again: nothing came for 2 s, or it
 * comes at under a third of the speed the last pieces came at (one stuck on a busy server).
 */
function worthAskingAgain(p: Progress, kind: PieceNote['kind']): boolean {
	const now = performance.now();
	if (!p.firstAt || now - p.lastAt > 2000) return true;
	const rates = recentPieces
		.filter((n) => n.kind === kind && n.ms > 0)
		.slice(-6)
		.map((n) => n.bytes / n.ms)
		.sort((a, b) => a - b);
	if (rates.length < 2) return false;
	const typical = rates[Math.floor(rates.length / 2)];
	return p.got / Math.max(1, now - p.firstAt) < typical / 3;
}

/** How many to fetch ahead: more while the last few pieces of this kind each came in slowly. */
function aheadNow(kind: PieceNote['kind']): number {
	const recent = recentPieces.filter((p) => p.kind === kind && p.seconds > 0).slice(-4);
	if (recent.length < 2) return AHEAD;
	const speeds = recent.map((p) => (p.seconds * 1000) / Math.max(1, p.ms)).sort((a, b) => a - b);
	return speeds[Math.floor(speeds.length / 2)] < SLOW_SPEED ? AHEAD_WHEN_SLOW : AHEAD;
}

/** `stop`: aborts it from outside (no longer wanted). `progress` is kept up to date as bytes come. */
async function fetchPiece(url: string, kind: PieceNote['kind'], seconds: number, stop: AbortSignal, progress: Progress, ahead = true): Promise<ArrayBuffer | null> {
	const start = performance.now();
	const tries: AbortController[] = [];
	let stopped = false;
	const ask = () => {
		if (stopped) return Promise.reject(new Error('stopped'));
		const controller = new AbortController();
		tries.push(controller);
		return fetch(url, { signal: controller.signal }).then((response) => ({ response, controller }));
	};
	let again: ReturnType<typeof setTimeout> | undefined;
	let noSecond: (reason: Error) => void = () => {};
	// Stopped (no longer wanted, or given up): every ask ends, and the second one is never sent.
	// (It used to be sent 4 s later all the same: a whole piece nobody wanted, 2026-11-14.)
	const stopAll = () => {
		stopped = true;
		clearTimeout(again);
		noSecond(new Error('stopped'));
		tries.forEach((t) => t.abort());
	};
	stop.addEventListener('abort', stopAll);
	const giveUp = setTimeout(stopAll, GIVE_UP_MS);
	try {
		if (stop.aborted) return null;
		const second = new Promise<Awaited<ReturnType<typeof ask>>>((resolve, reject) => {
			noSecond = reject;
			again = setTimeout(() => ask().then(resolve, reject), ASK_AGAIN_MS);
		});
		const { response, controller } = await Promise.any([ask(), second]);
		clearTimeout(again);
		clearTimeout(giveUp);
		for (const t of tries) if (t !== controller) t.abort();
		if (!response.ok || !response.body) return null;
		progress.total = Number(response.headers.get('content-length')) || 0;
		progress.firstAt = progress.lastAt = performance.now();

		const reader = response.body.getReader();
		const parts: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const hung = setTimeout(() => controller.abort(), HUNG_MS);
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} finally {
				clearTimeout(hung);
			}
			if (chunk.done) break;
			parts.push(chunk.value);
			size += chunk.value.byteLength;
			progress.got = size;
			progress.lastAt = performance.now();
			bytesCame();
		}
		// A refusal can come back as a tiny reply rather than an error.
		if (size < 1000) return null;
		progress.total = size;
		const data = new Uint8Array(size);
		let at = 0;
		for (const part of parts) {
			data.set(part, at);
			at += part.byteLength;
		}
		note({ at: performance.now(), host: hostOf(url), bytes: size, ms: performance.now() - start, ahead, kind, seconds });
		return data.buffer;
	} catch {
		return null;
	} finally {
		clearTimeout(again);
		clearTimeout(giveUp);
		stop.removeEventListener('abort', stopAll);
	}
}

/*
 * The piece the video is waiting for, fetched in parts several at once. On a busy evening Showbox's
 * server sends each download at 2.5–5 Mbps whatever else is going (2026-11-14: one piece alone
 * 2.6 Mbps, five at once 2.4–2.5 each), so a 4 MB piece took 6–12 s and the video waited all that
 * time: the first piece of an episode, the next episode, a jump. In six parts of 600 KB the same
 * pieces came in 2.5–2.9 s instead of 5.5–11.9 s, byte for byte the same.
 * A server that doesn't do parts answers the first with the whole piece, which is then used as it
 * is. Anything unclear (a part that fails twice, an end it can't tell) gives null: the usual download.
 */
const PART_BYTES = 600_000;
const PARTS_AT_ONCE = 6;

async function fetchInParts(url: string, stop: AbortSignal): Promise<ArrayBuffer | null> {
	const parts: Uint8Array[] = [];
	let end = Infinity;
	let next = 1;
	const failed: number[] = [];
	// No part from the first one that failed on: past the end, a part fails at once, and taking
	// the next straight after sent twenty more in a blink.
	let failedFrom = Infinity;
	const controller = new AbortController();
	const giveUp = setTimeout(() => controller.abort(), GIVE_UP_MS);
	const onStop = () => controller.abort();
	stop.addEventListener('abort', onStop);
	/*
	 * Parts asked for past the end (before the end was known) aren't answered at all by Febbox's
	 * server: the whole piece was here in 4.5 s and still waited 9 s more on them (2026-11-14).
	 * So once the end is known, those are stopped.
	 */
	const asking = new Map<number, AbortController>();
	const endAt = (bytes: number) => {
		end = Math.min(end, bytes);
		for (const [i, ask] of asking) if (i * PART_BYTES >= end) ask.abort();
	};
	/** Part `i`: true when it came, false when it failed. */
	const getPart = async (i: number): Promise<boolean> => {
		const from = i * PART_BYTES;
		const ask = new AbortController();
		const onAbort = () => ask.abort();
		controller.signal.addEventListener('abort', onAbort);
		asking.set(i, ask);
		try {
			const response = await fetch(url, { signal: ask.signal, headers: { Range: `bytes=${from}-${from + PART_BYTES - 1}` } });
			if (response.status === 416) {
				endAt(from);
				return true;
			}
			if (response.status !== 206) return false;
			const bytes = await readAll(response);
			parts[i] = bytes;
			if (bytes.length < PART_BYTES) endAt(from + bytes.length);
			return true;
		} catch {
			return false;
		} finally {
			asking.delete(i);
			controller.signal.removeEventListener('abort', onAbort);
		}
	};
	try {
		const first = await fetch(url, { signal: controller.signal, headers: { Range: `bytes=0-${PART_BYTES - 1}` } });
		// No parts here: this answer is the whole piece.
		if (first.status === 200) return (await readAll(first)).buffer as ArrayBuffer;
		if (first.status !== 206) return null;
		// Its size, where the server lets the page read it (Febbox's doesn't: then the short last part tells).
		const total = Number(/\/(\d+)\s*$/.exec(first.headers.get('content-range') ?? '')?.[1]);
		if (total > 0) end = total;
		const reading = readAll(first).then((data) => {
			parts[0] = data;
			if (data.length < PART_BYTES) endAt(data.length);
		});
		const worker = async () => {
			while (next * PART_BYTES < end && next < failedFrom && !controller.signal.aborted) {
				const i = next++;
				if (!(await getPart(i))) {
					failed.push(i);
					failedFrom = Math.min(failedFrom, i);
				}
			}
		};
		await Promise.all([reading, ...Array.from({ length: PARTS_AT_ONCE - 1 }, worker)]);
		if (controller.signal.aborted || !Number.isFinite(end)) return null;
		// Parts past the end fail on some servers; only ones before it matter, and get one more try.
		for (const i of failed) if (i * PART_BYTES < end && !(await getPart(i))) return null;
		const count = Math.ceil(end / PART_BYTES);
		const data = new Uint8Array(end);
		for (let i = 0; i < count; i++) {
			const part = parts[i];
			const expected = Math.min(PART_BYTES, end - i * PART_BYTES);
			if (!part || part.length !== expected) return null;
			data.set(part, i * PART_BYTES);
		}
		return data.buffer;
	} catch {
		return null;
	} finally {
		clearTimeout(giveUp);
		stop.removeEventListener('abort', onStop);
		controller.abort();
	}
}

const isRelayed = (url: string) => url.includes('/api/watch/relay?');
/** The page is open on the computer Catalog runs on (its relay is next door, not over Wi-Fi). */
const onTheComputer = () => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);
const relayRequests = new Map<object, number>();
export const waitingForRelayPiece = () => [...relayRequests.values()].some((since) => performance.now() - since < RELAY_PIECE_TIMEOUT_MS);

type Base = new (config: unknown) => Loader<LoaderContext>;

/**
 * A piece loader for one player (`hls()` gives it the playlists, to know what comes next).
 * `onBytes`: told as bytes come in on its own downloads (see `bytesCame`).
 */
export function fetchAheadLoader(hls: () => Hls | null, onBytes: () => void = () => {}): FragmentLoaderConstructor {
	bytesCame = onBytes;
	const Plain = Hls.DefaultConfig.loader as unknown as Base;

	class FetchAheadLoader extends Plain {
		private relayRequest: object | null = null;

		private clearRelayRequest() {
			if (this.relayRequest) relayRequests.delete(this.relayRequest);
			this.relayRequest = null;
		}

		destroy() {
			this.clearRelayRequest();
			super.destroy();
		}

		private waiting = false;
		/** The download ahead it took over (and its address), until it's handed to the player. */
		private handed: Fetched | null = null;
		private handedUrl = '';

		load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
			const frag = (context as FragmentLoaderContext).frag;
			const kind: PieceNote['kind'] = frag?.type === 'audio' ? 'audio' : 'video';
			// (hls.js always fills these in, with 0s for a whole piece.)
			const ranged = Boolean(context.rangeEnd);
			if (!frag || ranged || (isRelayed(context.url) && onTheComputer())) return this.plain(context, config, callbacks, kind);

			forgetOld();
			/*
			 * The piece the video is waiting for (a start, a jump, the next episode) is fetched first,
			 * in parts (fetchInParts), and the ones after it only once it's here: all together came to
			 * about 13 Mbps on 2026-11-14 however many there were, so pieces fetched ahead only slowed
			 * the one waited for (Dungeon Meshi S1E24's first: 7.2 s beside four others), and a jump
			 * back waited behind pieces fetched ahead of the old spot.
			 */
			const urgent = this.waitedFor(frag);
			this.dropUnwanted(frag, kind, urgent);
			const fetchAfter = () => this.fetchNext(frag, kind);
			if (!urgent) this.fetchNext(frag, kind);
			const key = keyOf(context.url);
			let entry = fetched.get(key);
			// (Never through the relay: it serves parts straight from the site, past its own copy
			// on disk and its mending of 7Movies' frame times.)
			const inPartsHere = urgent && kind === 'video' && typeof frag.sn === 'number' && !isRelayed(context.url);
			// Coming whole and not half here yet: in parts is quicker, even starting over.
			if (entry && inPartsHere && !mostlyHere(entry.progress)) {
				drop(key, entry);
				entry = undefined;
			}
			if (!entry && inPartsHere) {
				return this.inParts(context, config, callbacks, fetchAfter);
			}
			/*
			 * Any other piece waited for (the sound at a spot jumped back to) is fetched the way the
			 * ones ahead are: asked again alongside after ASK_AGAIN_MS, the first ask kept. The
			 * player's own way gives up on a piece with no answer after 5 s and starts over, and
			 * with Showbox answering everything in 4–15 s (2026-11-14) the sound piece a jump back
			 * needed was cut off and asked again every 5 s, over and over: 13 s and counting.
			 */
			if (!entry && urgent && typeof frag.sn === 'number') return this.viaFetch(context, config, callbacks, kind, fetchAfter);
			if (!entry) return this.plain(context, config, callbacks, kind, urgent ? fetchAfter : undefined);

			// Already on its way (or here): handed over from memory. Handed over, it has none of the
			// player's own time limits, so one arriving in a trickle held the player until it was
			// whole (or HUNG_MS without a byte). Not here ASK_AGAIN_MS after the player asked, and
			// stuck or far slower than the pieces before it: asked for the usual way too, and
			// whichever is whole first is used. (One merely coming at the line's speed is left to
			// finish: a second copy of it only halved the speed of both.)
			fetched.delete(key);
			this.handed = entry;
			this.handedUrl = key;
			this.waiting = true;
			const stats = this.stats;
			stats.loading.start = performance.now();
			let alsoAsked = false;
			const first = <T extends unknown[]>(answer: ((...args: T) => void) | undefined) =>
				(...args: T) => {
					if (!this.waiting) return;
					this.waiting = false;
					answer?.(...args);
				};
			const check = () => {
				if (!this.waiting) return;
				if (!worthAskingAgain(entry.progress, kind)) {
					slow = setTimeout(check, 1000);
					return;
				}
				alsoAsked = true;
				this.plain(context, config, { ...callbacks, onSuccess: first(callbacks.onSuccess), onError: first(callbacks.onError), onTimeout: first(callbacks.onTimeout) }, kind);
			};
			let slow = setTimeout(check, ASK_AGAIN_MS);
			entry.bytes.then((data) => {
				clearTimeout(slow);
				if (!this.waiting) return;
				// Nothing came from memory: the usual way, unless that's already under way.
				if (!data) {
					if (alsoAsked) return;
					this.waiting = false;
					return this.plain(context, config, callbacks, kind, urgent ? fetchAfter : undefined);
				}
				this.waiting = false;
				stats.loading.first = stats.loading.end = performance.now();
				stats.loaded = stats.total = data.byteLength;
				this.context = context;
				if (urgent) fetchAfter();
				callbacks.onSuccess({ url: context.url, data }, stats, context, null);
			});
		}

		abort() {
			this.clearRelayRequest();
			// A jump elsewhere: the piece it was taking over goes back with the others fetched
			// ahead, still coming. Asked for again (a jump back near it), it carries on from where it
			// was; no longer wanted, dropUnwanted stops it.
			if (this.waiting && this.handed && this.handedUrl && !fetched.has(this.handedUrl)) fetched.set(this.handedUrl, this.handed);
			this.handedUrl = '';
			this.partsStop?.abort();
			this.partsStop = null;
			this.waiting = false;
			this.handed = null;
			super.abort();
		}

		private partsStop: AbortController | null = null;

		/** The piece waited for, through fetchPiece (see where it's called); the usual way if that fails. */
		private viaFetch(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>, kind: PieceNote['kind'], after: () => void) {
			const stop = new AbortController();
			this.partsStop = stop;
			this.waiting = true;
			const stats = this.stats;
			stats.loading.start = performance.now();
			const seconds = (context as FragmentLoaderContext).frag?.duration ?? 0;
			const progress: Progress = { got: 0, total: 0, firstAt: 0, lastAt: 0 };
			fetchPiece(context.url, kind, seconds, stop.signal, progress, false).then((data) => {
				if (!this.waiting || this.partsStop !== stop) return;
				this.partsStop = null;
				this.waiting = false;
				if (!data) return this.plain(context, config, callbacks, kind, after);
				stats.loading.first = stats.loading.end = performance.now();
				stats.loaded = stats.total = data.byteLength;
				this.context = context;
				after();
				callbacks.onSuccess({ url: context.url, data }, stats, context, null);
			});
		}

		/** The piece waited for, in parts (fetchInParts); the usual way if that can't be done. */
		private inParts(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>, after: () => void) {
			const stop = new AbortController();
			this.partsStop = stop;
			this.waiting = true;
			const stats = this.stats;
			const start = performance.now();
			stats.loading.start = start;
			fetchInParts(context.url, stop.signal).then((data) => {
				if (!this.waiting || this.partsStop !== stop) return;
				this.partsStop = null;
				this.waiting = false;
				if (!data) return this.plain(context, config, callbacks, 'video', after);
				const now = performance.now();
				note({ at: now, host: hostOf(context.url), bytes: data.byteLength, ms: now - start, ahead: false, kind: 'video', seconds: (context as FragmentLoaderContext).frag?.duration ?? 0 });
				stats.loading.first = stats.loading.end = now;
				stats.loaded = stats.total = data.byteLength;
				this.context = context;
				after();
				callbacks.onSuccess({ url: context.url, data }, stats, context, null);
			});
		}

		/**
		 * The video can't go on without it: nothing is loaded yet, the video stands at (or within a
		 * second of) this piece, or it's jumping or stopped. (A jump back into a piece already here
		 * still waited for the piece after it: 8 and 14 s while that one came whole, 2026-11-14.)
		 */
		private waitedFor(frag: FragmentLoaderContext['frag']): boolean {
			const media = hls()?.media;
			if (!media) return false;
			return media.buffered.length === 0 || media.seeking || media.readyState < 3 || frag.start <= media.currentTime + 1;
		}

		/**
		 * Downloads ahead that are no longer next to where the video is (after a jump, another
		 * quality, the episode before) are stopped. With the video waiting, so is every other one
		 * that isn't mostly here yet: the piece waited for gets the line to itself.
		 */
		private dropUnwanted(frag: FragmentLoaderContext['frag'], kind: PieceNote['kind'], urgent: boolean) {
			const player = hls();
			if (!player || typeof frag.sn !== 'number') return;
			const details = kind === 'audio' ? player.audioTracks[frag.level]?.details : player.levels[frag.level]?.details;
			if (!details) return;
			const at = frag.sn - details.startSN;
			const next = new Set(details.fragments.slice(at + 1, at + 1 + AHEAD_WHEN_SLOW).map((f) => keyOf(f.url)));
			const own = keyOf(frag.url);
			for (const [key, entry] of fetched) {
				// (The next episode's first pieces wait for it, whatever this one does.)
				if (entry.kind !== kind || key === own || entry.forNext) continue;
				if (!next.has(key) || (urgent && !mostlyHere(entry.progress))) drop(key, entry);
			}
		}

		/** Asked for the usual way (one at a time), and noted. `after`: once it's here. */
		private plain(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>, kind: PieceNote['kind'], after?: () => void) {
			const start = performance.now();
			this.clearRelayRequest();
			if (isRelayed(context.url) && onTheComputer()) {
				this.relayRequest = {};
				relayRequests.set(this.relayRequest, start);
				config = { ...config, loadPolicy: { ...config.loadPolicy, maxTimeToFirstByteMs: RELAY_PIECE_TIMEOUT_MS } };
			}
			// hls.js's loader refuses a second start ("Loader can only be used once") once its start
			// time is set, and it was, by the handover from memory. So a piece fetched ahead that
			// failed threw here, the player's request was never answered, and that track stopped
			// loading until the stall watch restarted it: fast pieces, then "0 s loaded ahead"
			// (Dungeon Meshi E7, 2026-10-23).
			this.stats.loading.start = 0;
			super.load(context, config, {
				...callbacks,
				onSuccess: (response, stats, ctx, details) => {
					this.clearRelayRequest();
					const bytes = response.data instanceof ArrayBuffer ? response.data.byteLength : 0;
					if (bytes && typeof (context as FragmentLoaderContext).frag?.sn === 'number') note({ at: performance.now(), host: hostOf(context.url), bytes, ms: performance.now() - start, ahead: false, kind, seconds: (context as FragmentLoaderContext).frag?.duration ?? 0 });
					after?.();
					callbacks.onSuccess(response, stats, ctx, details);
				},
				onError: (...args) => {
					this.clearRelayRequest();
					callbacks.onError(...args);
				},
				onTimeout: (...args) => {
					this.clearRelayRequest();
					callbacks.onTimeout(...args);
				},
				onAbort: (...args) => {
					this.clearRelayRequest();
					callbacks.onAbort?.(...args);
				}
			});
		}

		/** The next pieces after this one, from the same playlist: started now. */
		private fetchNext(frag: FragmentLoaderContext['frag'], kind: PieceNote['kind']) {
			const player = hls();
			if (!player || typeof frag.sn !== 'number') return;
			const details = kind === 'audio' ? player.audioTracks[frag.level]?.details : player.levels[frag.level]?.details;
			if (!details) return;
			const at = frag.sn - details.startSN;
			for (const next of details.fragments.slice(at + 1, at + 1 + aheadNow(kind))) {
				if (!next.url || next.byteRange.length || fetched.has(keyOf(next.url))) continue;
				const stop = new AbortController();
				const progress: Progress = { got: 0, total: 0, firstAt: 0, lastAt: 0 };
				fetched.set(keyOf(next.url), { at: Date.now(), bytes: fetchPiece(next.url, kind, next.duration, stop.signal, progress), kind, stop, progress });
			}
		}
	}
	return FetchAheadLoader as unknown as FragmentLoaderConstructor;
}
