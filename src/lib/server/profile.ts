import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who's watching, on the TV. Each request runs as one profile (set in hooks.server.ts from the
 * TV's cookie), so the queries can ask without every caller passing it along. Profile 0 is the
 * library's owner: their list is the library itself. Anything not from a TV is profile 0.
 */
export const MAIN_PROFILE = 0;

const store = new AsyncLocalStorage<number>();

export function currentProfile(): number {
	return store.getStore() ?? MAIN_PROFILE;
}

export function withProfile<T>(profile: number, run: () => T): T {
	return store.run(profile, run);
}
