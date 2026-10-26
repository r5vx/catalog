/**
 * Episodes downloaded ahead, for 7Movies and Movy.
 *
 * Their servers are slow over pieces they haven't got yet (2026-10-24, AHS S13E9 and SVU): most
 * pieces come in a second or two, but some take 20 s to 4 minutes, trickling all the while, and
 * asking again only joins the same slow fetch. The relay asked a few pieces ahead of the player,
 * so one slow piece held up everything behind it and the TV ran dry ("slowest 222 s").
 *
 * Measured on stretches nobody had played: a pool of downloads that keeps going past slow pieces
 * gets 7Movies at 2.4–5.2x real time (10 at once) and Movy at 1.6–1.9x (4–5 at once; it refuses
 * a sixth). So once an episode plays from either, the computer keeps downloading the rest of it,
 * in order from where it's being watched, onto its disk; the player and the TVs are handed the
 * pieces from there. The next episode can be downloaded the same way while this one plays
 * (`downloadAhead`), so it starts with nothing to wait for.
 *
 * Pieces are kept by copy and number ("vidrift:tv:2734:28:3:avc~v0", piece 41), not by address:
 * the sources' addresses change every time a link is fetched. The relay puts both in the
 * addresses it hands the player (`copy=`, `n=`).
 *
 * Disk: in %APPDATA%\Catalog\downloads-ahead, an episode's pieces deleted 6 hours after they were
 * last used, at most what Settings → Storage allows (20 GB unless changed), and never leaving
 * under 5 GB free on the disk.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';
import { readSettings } from './settings';
import { fetchSteadily } from './relayPieces';
import { noteRelayPiece } from './playbackLog';

export type DownloadKind = 'vidrift' | 'movy';

/** Downloads at once, for all viewers together. Movy refuses a sixth; one is left for the rest. */
const AT_ONCE: Record<DownloadKind, number> = { vidrift: 10, movy: 4 };
const KEEP_MS = 6 * 60 * 60 * 1000;
/** How much the episodes downloaded ahead may take (Settings → Storage), in GB. */
export const DOWNLOAD_LIMITS_GB = [5, 10, 20, 50, 100] as const;
const DEFAULT_GB = 20;
export function downloadsAheadLimitGb(): number {
	const saved = Number(readSettings().downloadsAheadGb);
	return (DOWNLOAD_LIMITS_GB as readonly number[]).includes(saved) ? saved : DEFAULT_GB;
}
const MIN_FREE = 5 * 1024 ** 3;
/** Nobody has asked for a piece of it for this long: it's no longer being watched. */
const WATCHED_MS = 15 * 60 * 1000;
/** A next episode downloaded ahead and never started: given up after this long. */
const AHEAD_MS = 2 * 60 * 60 * 1000;

type Job = {
	copy: string;
	kind: DownloadKind;
	dir: string;
	urls: string[];
	headers: Record<string, string>;
	/** Where it's being watched: downloading goes on in order from here. */
	from: number;
	askedAt: number;
	/** Downloaded for later (the next episode), not being watched yet: comes after the others. */
	later: boolean;
	done: Set<number>;
	going: Map<number, { bytes: Promise<Buffer | null>; stop: () => void }>;
	failures: Map<number, number>;
	/** Watched to the end (finishedWith): its pieces go once nobody's asked for one for a while. */
	finishedAt?: number;
};

const jobs = new Map<string, Job>();
/** Which copy and number each piece address is (for the relay's long-piece parts). */
const addresses = new Map<string, { copy: string; n: number }>();
const running: Record<DownloadKind, number> = { vidrift: 0, movy: 0 };

const root = () => join(dataDir, 'downloads-ahead');
const dirOf = (copy: string) => join(root(), createHash('sha1').update(copy).digest('hex').slice(0, 16));

/** The source a copy name belongs to, if it's one downloaded ahead. */
export function downloadKindOf(copy: string): DownloadKind | null {
	if (copy.startsWith('vidrift:')) return 'vidrift';
	if (copy.startsWith('movy:')) return 'movy';
	return null;
}

/**
 * A playlist of an episode's pieces, as the relay hands it on: its pieces' addresses now (they
 * change with each fresh link), and how to ask for them.
 */
export function noteEpisode(copy: string, urls: string[], headers: Record<string, string>): void {
	const kind = downloadKindOf(copy);
	if (!kind || !urls.length) return;
	let job = jobs.get(copy);
	if (!job) {
		const dir = dirOf(copy);
		const done = new Set<number>();
		if (existsSync(dir)) {
			for (const name of readdirSync(dir)) if (/^\d+$/.test(name)) done.add(Number(name));
		}
		job = { copy, kind, dir, urls, headers, from: 0, askedAt: 0, later: false, done, going: new Map(), failures: new Map() };
		jobs.set(copy, job);
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'copy.txt'), copy);
		} catch {}
	}
	job.urls = urls;
	job.headers = headers;
	urls.forEach((url, n) => addresses.set(url, { copy, n }));
	if (addresses.size > 20_000) for (const key of [...addresses.keys()].slice(0, 5_000)) addresses.delete(key);
}

/** The copy and number of a piece address noted with `noteEpisode`. */
export const pieceKeyOf = (url: string) => addresses.get(url) ?? null;

/** A piece already on disk, or null. */
export function storedPiece(copy: string, n: number): Buffer | null {
	const job = jobs.get(copy);
	if (!job?.done.has(n)) return null;
	try {
		return readFileSync(join(job.dir, String(n)));
	} catch {
		job.done.delete(n);
		return null;
	}
}

/** Being watched at piece `n`: downloading carries on in order from there. */
export function watching(copy: string, n: number): void {
	const job = jobs.get(copy);
	if (!job) return;
	job.from = n;
	job.askedAt = Date.now();
	job.later = false;
	touch(job);
	pump();
}

/**
 * A piece the player is asking for: from disk, or as soon as it's downloaded (it goes first).
 * Null when it couldn't be had (the relay then asks the plain way).
 */
export async function wantedPiece(copy: string, n: number): Promise<Buffer | null> {
	const stored = storedPiece(copy, n);
	const job = jobs.get(copy);
	if (job) watching(copy, n);
	if (stored || !job || n >= job.urls.length) return stored;
	if (!job.going.has(n)) start(job, n, true);
	return (await job.going.get(n)?.bytes) ?? storedPiece(copy, n);
}

/**
 * A copy's pieces on disk (for the player's progress bar and its stats): their numbers, how
 * many it has altogether, and how many are downloading right now. Null if it isn't being downloaded.
 */
export function piecesHeld(copy: string): { held: number[]; total: number; going: number } | null {
	const job = jobs.get(copy);
	return job ? { held: [...job.done], total: job.urls.length, going: job.going.size } : null;
}

/** A finished episode's pieces stay this long after the last one was asked for (another TV may still be partway). */
const FINISHED_MS = 3 * 60 * 1000;

/**
 * An episode or film watched to the end (`copy`: its share key; each of its qualities and sound
 * tracks goes): deleted a few minutes after nobody's asking for its pieces any more, so what's
 * kept is what's playing and what's next. (Past the space allowed, the oldest go first anyway.)
 */
export function finishedWith(copy: string): void {
	for (const job of jobs.values()) if (job.copy === copy || job.copy.startsWith(`${copy}~`)) job.finishedAt = Date.now();
}

/** A piece downloaded some other way (the relay's long-piece parts): kept like the rest. */
export function keepPiece(copy: string, n: number, bytes: Buffer): void {
	const job = jobs.get(copy);
	if (!job || job.done.has(n) || bytes.length < 1000 || !roomFor(bytes.length)) return;
	try {
		writeFileSync(join(job.dir, String(n)), bytes);
		job.done.add(n);
		if (knownBytes !== null) knownBytes += bytes.length;
	} catch {}
}

/** The next episode, downloaded while this one plays (after what's being watched). */
export function downloadAhead(copy: string): void {
	const job = jobs.get(copy);
	if (!job) return;
	if (!job.askedAt) {
		job.later = true;
		job.askedAt = Date.now();
	}
	touch(job);
	pump();
}

/** How much is downloaded ahead, for Settings → Storage. */
export function downloadsAheadBytes(): number {
	knownBytes ??= folderBytes(root());
	return knownBytes;
}
/** Counted once, then kept up to date as pieces come and episodes go. */
let knownBytes: number | null = null;

/* ------------------------------------------------ the pool */

function pump(): void {
	cleanUp();
	for (const kind of ['vidrift', 'movy'] as const) {
		while (running[kind] < AT_ONCE[kind]) {
			const next = nextPiece(kind);
			if (!next) break;
			start(next.job, next.n, false);
		}
	}
}

/**
 * The first missing piece of the most wanted episode: ones being watched before later ones. With
 * several being watched at once (mom's laptop serves three TVs), each gets an equal share of the
 * downloads first, the one with the least on its way going first; what's left over goes to
 * whichever can use it.
 */
function nextPiece(kind: DownloadKind): { job: Job; n: number } | null {
	const now = Date.now();
	const candidates = [...jobs.values()]
		.filter((j) => j.kind === kind && j.askedAt && now - j.askedAt < (j.later ? AHEAD_MS : WATCHED_MS))
		.sort((a, b) => Number(a.later) - Number(b.later) || a.going.size - b.going.size || b.askedAt - a.askedAt);
	const watched = candidates.filter((j) => !j.later).length;
	const share = Math.max(1, Math.ceil(AT_ONCE[kind] / Math.max(1, watched)));
	const missing = (job: Job) => {
		for (let n = job.from; n < job.urls.length; n++) {
			if (job.done.has(n) || job.going.has(n) || (job.failures.get(n) ?? 0) >= 3) continue;
			return n;
		}
		return null;
	};
	for (const fair of [true, false]) {
		for (const job of candidates) {
			if (fair && (job.later || job.going.size >= share)) continue;
			const n = missing(job);
			if (n !== null) return { job, n };
		}
	}
	return null;
}

function start(job: Job, n: number, urgent: boolean): void {
	// Asked for by the player with every download in use (Movy): the one furthest ahead makes way.
	if (urgent && running[job.kind] >= AT_ONCE[job.kind]) {
		let furthest: { job: Job; n: number; far: number } | null = null;
		for (const other of jobs.values()) {
			if (other.kind !== job.kind) continue;
			for (const m of other.going.keys()) {
				const far = (other.later ? 1e6 : 0) + (m - other.from);
				if (other === job && m === n) continue;
				if (!furthest || far > furthest.far) furthest = { job: other, n: m, far };
			}
		}
		furthest?.job.going.get(furthest.n)?.stop();
	}
	const url = job.urls[n];
	let stop = () => {};
	let wasStopped = false;
	const stopped = new Promise<null>((resolve) => (stop = () => {
		wasStopped = true;
		resolve(null);
	}));
	let cancel = () => {};
	running[job.kind]++;
	const fetching = (async (): Promise<Buffer | null> => {
		const began = Date.now();
		try {
			const answer = await fetchSteadily(url, job.headers);
			cancel = () => answer.cancel();
			// Stopped while waiting for the answer: let the connection go now.
			if (wasStopped) {
				answer.cancel();
				return null;
			}
			if (!answer.response.ok) {
				answer.cancel();
				return null;
			}
			const parts: Uint8Array[] = [];
			for (let r = await answer.read(); !r.done; r = await answer.read()) parts.push(r.value);
			const bytes = Buffer.concat(parts);
			// A refusal comes back as a tiny reply rather than an error.
			if (bytes.length < 1000) return null;
			noteRelayPiece(url, bytes.length, Date.now() - began);
			return bytes;
		} catch {
			return null;
		}
	})();
	const bytes = Promise.race([fetching, stopped]).then((got) => {
		if (!got) cancel();
		return got;
	});
	job.going.set(n, { bytes, stop });
	bytes.then((got) => {
		running[job.kind]--;
		job.going.delete(n);
		if (got && roomFor(got.length)) {
			try {
				writeFileSync(join(job.dir, String(n)), got);
				job.done.add(n);
				if (knownBytes !== null) knownBytes += got.length;
			} catch {}
		} else if (!got && !wasStopped) {
			job.failures.set(n, (job.failures.get(n) ?? 0) + 1);
		}
		pump();
	});
}

/* ------------------------------------------------ the disk */

function touch(job: Job): void {
	try {
		const now = new Date();
		utimesSync(job.dir, now, now);
	} catch {}
}

function folderBytes(dir: string): number {
	if (!existsSync(dir)) return 0;
	let total = 0;
	for (const name of readdirSync(dir)) {
		try {
			const info = statSync(join(dir, name));
			total += info.isDirectory() ? folderBytes(join(dir, name)) : info.size;
		} catch {}
	}
	return total;
}

/** Room for this many more bytes: within the limit altogether and 5 GB left free (old episodes go first). */
function roomFor(bytes: number): boolean {
	try {
		const disk = statfsSync(root());
		if (disk.bavail * disk.bsize - bytes < MIN_FREE && !dropOldest()) return false;
	} catch {}
	let total = downloadsAheadBytes();
	const most = downloadsAheadLimitGb() * 1024 ** 3;
	while (total + bytes > most) {
		if (!dropOldest()) return false;
		total = downloadsAheadBytes();
	}
	return true;
}

/** Deletes the least recently used episode that isn't being watched or waiting. False if none. */
function dropOldest(): boolean {
	const now = Date.now();
	const busy = new Set([...jobs.values()].filter((j) => j.askedAt && now - j.askedAt < (j.later ? AHEAD_MS : WATCHED_MS)).map((j) => j.dir));
	const dirs = existsSync(root())
		? readdirSync(root())
				.map((name) => join(root(), name))
				.filter((dir) => !busy.has(dir))
				.map((dir) => ({ dir, at: statSync(dir).mtimeMs }))
				.sort((a, b) => a.at - b.at)
		: [];
	const oldest = dirs[0];
	if (!oldest) return false;
	forget(oldest.dir);
	return true;
}

function forget(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
	knownBytes = null;
	for (const [copy, job] of jobs) if (job.dir === dir && !job.going.size) jobs.delete(copy);
}

let cleanedAt = 0;
/** Finished episodes go, and any not used for 6 hours (checked at most once a minute). */
function cleanUp(): void {
	const now = Date.now();
	if (now - cleanedAt < 60_000) return;
	cleanedAt = now;
	for (const job of [...jobs.values()]) {
		if (!job.finishedAt || now - Math.max(job.finishedAt, job.askedAt) < FINISHED_MS) continue;
		for (const going of job.going.values()) going.stop();
		job.going.clear();
		forget(job.dir);
		jobs.delete(job.copy);
	}
	if (!existsSync(root())) return;
	for (const name of readdirSync(root())) {
		const dir = join(root(), name);
		try {
			if (now - statSync(dir).mtimeMs > KEEP_MS) forget(dir);
		} catch {}
	}
}

// (Finished episodes are looked for even while nothing new is downloading.)
setInterval(cleanUp, 60_000).unref?.();
