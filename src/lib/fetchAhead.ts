import Hls from 'hls.js';
import type { FragmentLoaderConstructor, FragmentLoaderContext, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';

/**
 * The player's video pieces, fetched a couple ahead.
 *
 * hls.js asks for one piece at a time. When a video server is busy (evenings, on several sites
 * at once — Showbox and 7Movies both stopped to load for the owner and mom at 7–8 pm while the
 * house connection was fine), each single download slows down, and one at a time can fall
 * behind the video even though the connection could carry far more. So while the player fetches
 * a piece, the next two are fetched alongside it — three downloads at once — and handed over
 * from memory when it asks for them. The pieces of Catalog's relay are fetched ahead on the
 * computer instead (relayReadAhead.ts), so those are left alone here.
 *
 * Every piece's download is also noted (`recentPieces`), for the stats and the stop log.
 */
const AHEAD = 2;
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
};

/** The last pieces downloaded, newest last. */
export const recentPieces: PieceNote[] = [];

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

type Fetched = { at: number; bytes: Promise<ArrayBuffer | null> };
const fetched = new Map<string, Fetched>();

function forgetOld() {
	const now = Date.now();
	for (const [url, entry] of fetched) if (now - entry.at > KEEP_MS) fetched.delete(url);
	while (fetched.size > 8) fetched.delete(fetched.keys().next().value!);
}

async function fetchPiece(url: string, kind: PieceNote['kind']): Promise<ArrayBuffer | null> {
	const start = performance.now();
	const tries: AbortController[] = [];
	const ask = () => {
		const controller = new AbortController();
		tries.push(controller);
		return fetch(url, { signal: controller.signal }).then((response) => ({ response, controller }));
	};
	const giveUp = setTimeout(() => tries.forEach((t) => t.abort()), GIVE_UP_MS);
	let again: ReturnType<typeof setTimeout> | undefined;
	try {
		const second = new Promise<Awaited<ReturnType<typeof ask>>>((resolve, reject) => {
			again = setTimeout(() => ask().then(resolve, reject), ASK_AGAIN_MS);
		});
		const { response, controller } = await Promise.any([ask(), second]);
		clearTimeout(again);
		clearTimeout(giveUp);
		for (const t of tries) if (t !== controller) t.abort();
		if (!response.ok || !response.body) return null;

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
		}
		// A refusal can come back as a tiny reply rather than an error.
		if (size < 1000) return null;
		const data = new Uint8Array(size);
		let at = 0;
		for (const part of parts) {
			data.set(part, at);
			at += part.byteLength;
		}
		note({ at: performance.now(), host: hostOf(url), bytes: size, ms: performance.now() - start, ahead: true, kind });
		return data.buffer;
	} catch {
		return null;
	} finally {
		clearTimeout(again);
		clearTimeout(giveUp);
	}
}

const isRelayed = (url: string) => url.includes('/api/watch/relay?');

type Base = new (config: unknown) => Loader<LoaderContext>;

/** A piece loader for one player (`hls()` gives it the playlists, to know what comes next). */
export function fetchAheadLoader(hls: () => Hls | null): FragmentLoaderConstructor {
	const Plain = Hls.DefaultConfig.loader as unknown as Base;

	class FetchAheadLoader extends Plain {
		private waiting = false;

		load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
			const frag = (context as FragmentLoaderContext).frag;
			const kind: PieceNote['kind'] = frag?.type === 'audio' ? 'audio' : 'video';
			// (hls.js always fills these in, with 0s for a whole piece.)
			const ranged = Boolean(context.rangeEnd);
			if (!frag || ranged || isRelayed(context.url)) return this.plain(context, config, callbacks, kind);

			forgetOld();
			this.fetchNext(frag, kind);
			const entry = fetched.get(context.url);
			if (!entry) return this.plain(context, config, callbacks, kind);

			// Already on its way (or here): handed over from memory. Handed over, it has none of the
			// player's own time limits, so one arriving in a trickle held the player until it was
			// whole (or HUNG_MS without a byte). Not here ASK_AGAIN_MS after the player asked: asked
			// for the usual way too, and whichever is whole first is used.
			fetched.delete(context.url);
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
			const slow = setTimeout(() => {
				if (!this.waiting) return;
				alsoAsked = true;
				this.plain(context, config, { ...callbacks, onSuccess: first(callbacks.onSuccess), onError: first(callbacks.onError), onTimeout: first(callbacks.onTimeout) }, kind);
			}, ASK_AGAIN_MS);
			entry.bytes.then((data) => {
				clearTimeout(slow);
				if (!this.waiting) return;
				// Nothing came from memory: the usual way, unless that's already under way.
				if (!data) {
					if (alsoAsked) return;
					this.waiting = false;
					return this.plain(context, config, callbacks, kind);
				}
				this.waiting = false;
				stats.loading.first = stats.loading.end = performance.now();
				stats.loaded = stats.total = data.byteLength;
				this.context = context;
				callbacks.onSuccess({ url: context.url, data }, stats, context, null);
			});
		}

		abort() {
			this.waiting = false;
			super.abort();
		}

		/** Asked for the usual way (one at a time), and noted. */
		private plain(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>, kind: PieceNote['kind']) {
			const start = performance.now();
			// hls.js's loader refuses a second start ("Loader can only be used once") once its start
			// time is set, and it was, by the handover from memory. So a piece fetched ahead that
			// failed threw here, the player's request was never answered, and that track stopped
			// loading until the stall watch restarted it: fast pieces, then "0 s loaded ahead"
			// (Dungeon Meshi E7, 2026-10-23).
			this.stats.loading.start = 0;
			super.load(context, config, {
				...callbacks,
				onSuccess: (response, stats, ctx, details) => {
					const bytes = response.data instanceof ArrayBuffer ? response.data.byteLength : 0;
					if (bytes) note({ at: performance.now(), host: hostOf(context.url), bytes, ms: performance.now() - start, ahead: false, kind });
					callbacks.onSuccess(response, stats, ctx, details);
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
			for (const next of details.fragments.slice(at + 1, at + 1 + AHEAD)) {
				if (!next.url || next.byteRange.length || fetched.has(next.url)) continue;
				fetched.set(next.url, { at: Date.now(), bytes: fetchPiece(next.url, kind) });
			}
		}
	}
	return FetchAheadLoader as unknown as FragmentLoaderConstructor;
}
