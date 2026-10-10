/**
 * Every request Catalog's server makes to another site goes through here (installed once, from
 * hooks.server.ts):
 *   - one without its own time limit gets 15 seconds, so a site that stops answering can't
 *     hold a page up indefinitely;
 *   - any that takes over two seconds, or that the site refuses or fails (Showbox's file host
 *     answering 429 "too many requests" reads as an empty folder otherwise), is noted — the site,
 *     the path, how long and the answer, never the query (that's where keys live) — and the last
 *     40 show on /api/diagnostics (kept across restarts), to find out what made a page slow or a
 *     show "have no file".
 */
import { getOrderCache, saveOrderCache } from './db/queries';

const SLOW_MS = 2000;
const DEFAULT_LIMIT_MS = 15000;

export interface SlowRequest {
	at: string;
	site: string;
	path: string;
	ms: number;
	result: string;
}

/** Kept in the library too, so it's still there after Catalog is closed and opened again. */
const KEPT = 'slow-requests';
let slow: SlowRequest[] | null = null;

function list(): SlowRequest[] {
	if (!slow) {
		try {
			slow = (getOrderCache(KEPT)?.value as SlowRequest[] | undefined) ?? [];
		} catch {
			slow = [];
		}
	}
	return slow;
}

export function slowRequests(): SlowRequest[] {
	return [...list()].reverse();
}

/** Notes a site answering "no" inside a normal-looking reply (Showbox's file host does). */
export function noteRefusal(site: string, path: string, result: string): void {
	const kept = list();
	kept.push({ at: new Date().toISOString(), site, path: path.slice(0, 80), ms: 0, result: result.slice(0, 120) });
	if (kept.length > 40) kept.shift();
	try {
		saveOrderCache(KEPT, kept, Date.now());
	} catch {}
}

let installed = false;

export function watchOutsideRequests(): void {
	if (installed) return;
	installed = true;
	const original = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		let url: URL | null = null;
		try {
			url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		} catch {}
		// Only other sites; Catalog's own pages and the desktop app's local calls aren't timed.
		if (!url || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return original(input, init);

		const hasLimit = Boolean(init?.signal) || (input instanceof Request && input.signal);
		const started = Date.now();
		let result = '';
		try {
			const response = await original(input, hasLimit ? init : { ...init, signal: AbortSignal.timeout(DEFAULT_LIMIT_MS) });
			result = String(response.status);
			return response;
		} catch (error) {
			result = (error as Error)?.name === 'TimeoutError' ? 'gave up' : 'failed';
			throw error;
		} finally {
			const ms = Date.now() - started;
			// "Not found" is an ordinary answer (no subtitles for that episode), not trouble.
			const refused = !/^([23]\d\d|404)$/.test(result);
			if (ms >= SLOW_MS || refused) {
				const kept = list();
				kept.push({ at: new Date().toISOString(), site: url.hostname, path: url.pathname.slice(0, 80), ms, result });
				if (kept.length > 40) kept.shift();
				try {
					saveOrderCache(KEPT, kept, Date.now());
				} catch {}
			}
		}
	};
}
