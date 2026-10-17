/**
 * Every request for a Febbox folder listing (`/file/file_share_list`) goes through here.
 *
 * Febbox's host is behind Cloudflare, which answers too many listings from one connection with
 * its "Just a moment…" check (429, cf-mitigated: challenge) for a while — and Catalog used to make
 * bursts: all of a show's season folders at once (16 for Bleach),
 * the same folders again for each hidden helper window and each subtitle lookup, and an instant
 * retry on top. A refusal also read exactly like an empty folder, so Spider-Man: Brand New Day's
 * Showbox files simply vanished (2026-10-17: share link found, listing refused, only 7Movies
 * shown — and that answer was kept). So:
 *   - two listings at a time at most, each a moment after the last;
 *   - after a refusal, no listings at all for a while (30 s, doubling up to 5 minutes);
 *   - a folder listed in the last 20 minutes isn't asked again, and the same folder asked for
 *     twice at once is asked once;
 *   - a refusal falls back to the last listing kept (a month), and only when there is none does
 *     it say so — as `FebboxRefused`, never as an empty folder.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import { noteRefusal } from './slowRequests';
import { electronFebboxList } from './electron-fetch';

export type RawListing = Record<string, unknown>[];

/** Febbox wouldn't list the folder just now (and nothing was kept): not the same as empty. */
export class FebboxRefused extends Error {
	readonly retryInSeconds: number;
	constructor(retryInSeconds: number) {
		super('Febbox is refusing folder listings for a moment');
		this.retryInSeconds = retryInSeconds;
	}
}

const FRESH = 20 * 60 * 1000;
const KEPT = 30 * 24 * 60 * 60 * 1000;
const SPACING = 250; // ms after each listing request before its lane takes the next
const FIRST_REST = 30_000;
const LONGEST_REST = 5 * 60_000;

const fresh = new Map<string, { at: number; files: RawListing }>();
const asking = new Map<string, Promise<RawListing>>();
/** Two lanes, taking turns: a show's season folders come two at a time, never all at once. */
const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
let restingUntil = 0;
let rest = FIRST_REST;

/** Seconds until Febbox may be asked again (0: now). */
export function febboxResting(): number {
	return Math.max(0, Math.ceil((restingUntil - Date.now()) / 1000));
}

/** One page of a folder, in turn with every other listing request. Null: refused; 'resting': not asked. */
function askPage(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null | 'resting'> {
	const lane = nextLane;
	nextLane = (nextLane + 1) % lanes.length;
	const turn = lanes[lane].then(async () => {
		if (Date.now() < restingUntil) return 'resting' as const;
		try {
			// In the desktop app, asked as its browser, with its cookies; elsewhere (npm run dev)
			// directly.
			const viaApp = await electronFebboxList(url);
			if (viaApp) return viaApp.status === 200 ? (JSON.parse(viaApp.body) as Record<string, unknown>) : null;
			const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
			return resp.ok ? ((await resp.json()) as Record<string, unknown>) : null;
		} catch {
			return null;
		} finally {
			await new Promise((r) => setTimeout(r, SPACING));
		}
	});
	lanes[lane] = turn.catch(() => null);
	return turn;
}

function refused(answer: Record<string, unknown> | null): void {
	noteRefusal('www.febbox.com', '/file/file_share_list', answer ? `answered: ${answer.msg ?? answer.code ?? 'no file list'}` : 'refused (Cloudflare check or too many)');
	restingUntil = Math.max(restingUntil, Date.now() + rest);
	rest = Math.min(LONGEST_REST, rest * 2);
}

/** A folder's files (every page), from Febbox or kept. Throws FebboxRefused when neither. */
export function febboxListing(shareKey: string, parentId: number, headers: Record<string, string>): Promise<RawListing> {
	const key = `${shareKey}|${parentId}`;
	const recent = fresh.get(key);
	if (recent && Date.now() - recent.at < FRESH) return Promise.resolve(recent.files);
	const already = asking.get(key);
	if (already) return already;

	const work = (async () => {
		const list: RawListing = [];
		// A folder comes 50 files at a time (Black Clover's season 1 has 170): every page, in turn.
		for (let page = 1; page <= 20; page++) {
			const answer = await askPage(
				`https://www.febbox.com/file/file_share_list?share_key=${shareKey}&pwd=&parent_id=${parentId}&page=${page}`,
				headers
			);
			const files = answer && answer !== 'resting' ? (answer.data as { file_list?: unknown } | undefined)?.file_list : undefined;
			if (!Array.isArray(files)) {
				// (Not asked because of a rest already under way: that isn't a new refusal.)
				if (answer !== 'resting') refused(answer);
				const kept = getOrderCache(`febbox-list|${key}`);
				if (kept && Date.now() - kept.at < KEPT) return kept.value as RawListing;
				// A later page refused: the pages before still count, but aren't kept as the folder.
				if (page > 1) return list;
				throw new FebboxRefused(febboxResting());
			}
			const seen = new Set(list.map((f) => f.fid));
			const added = (files as RawListing).filter((f) => !seen.has(f.fid));
			list.push(...added);
			if (files.length < 50 || !added.length) break;
		}
		// Answered: the next refusal starts with a short rest again.
		rest = FIRST_REST;
		fresh.set(key, { at: Date.now(), files: list });
		saveOrderCache(`febbox-list|${key}`, list, Date.now());
		return list;
	})();
	asking.set(key, work);
	work.finally(() => asking.delete(key)).catch(() => {});
	return work;
}
