/**
 * Asking this same server for one of its own addresses (the new-episode checks, downloads), as
 * the signed-in owner, so a PIN doesn't turn it away.
 */
import { pinIsSet, sessionToken } from './settings';

let ownPort = process.env.PORT ?? '';

/** The address this server answers on, from the first request (`npm run dev` sets no PORT). */
export function noteOwnAddress(url: URL): void {
	if (!ownPort && url.port) ownPort = url.port;
}

export const ownPortKnown = () => Boolean(ownPort);

/** `path` ("/api/…") asked of this server. The app listens on every address; `npm run dev` only on localhost. */
export async function ownFetch(path: string, init: RequestInit = {}): Promise<Response> {
	if (!ownPort) throw new Error("This server's address isn't known yet");
	const headers = { ...(init.headers as Record<string, string> | undefined), ...(pinIsSet() ? { cookie: `catalog_auth=${sessionToken()}` } : {}) };
	const ask = (host: string) => fetch(`http://${host}:${ownPort}${path}`, { ...init, headers });
	return ask('127.0.0.1').catch(() => ask('localhost'));
}
