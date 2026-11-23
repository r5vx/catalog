import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who's watching, on a TV or a phone. Each request runs as one profile (set in hooks.server.ts
 * from the device's cookie), so the queries can ask without every caller passing it along.
 * Profile 0 is the library's owner: their list is the library itself. Catalog's own window on
 * the computer is always profile 0.
 */
export const MAIN_PROFILE = 0;

/** A TV's own cookie: set, it skips "Who's watching?" and opens as the profile it last chose. */
export const TV_REMEMBER_COOKIE = 'catalog_tv_remember';

const store = new AsyncLocalStorage<number>();

export function currentProfile(): number {
	return store.getStore() ?? MAIN_PROFILE;
}

export function withProfile<T>(profile: number, run: () => T): T {
	return store.run(profile, run);
}

/**
 * The computer Catalog runs on: its own window (Electron), or anything asking from this computer
 * (Catalog's own lookups of itself). Everything else, a phone or another computer, picks who's
 * watching on it. A phone on the secure address (Settings → TV and phones) comes through Tailscale on
 * this computer too, but Tailscale says who it is for (Tailscale-User-Login, X-Forwarded-For).
 */
export function onThisComputer(headers: Headers, clientAddress: string): boolean {
	// By the address only. Being Electron (its user agent) counted too until 2026-11-16, but any
	// phone or computer on the network can say it's Electron; Catalog's window asks 127.0.0.1 anyway.
	if (headers.has('tailscale-user-login') || headers.has('x-forwarded-for')) return false;
	return /^(127\.|::1$|::ffff:127\.)/.test(clientAddress);
}
