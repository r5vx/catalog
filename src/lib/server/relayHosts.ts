/**
 * The video servers Catalog's relay (/api/watch/relay) may fetch from, beyond the fixed ones:
 * servers a source handed us a link to (7Movies' H.264 copies now come from
 * edge.reelvault.click, which the relay refused, so they "could not be played" — SVU S28E2,
 * Madagascar), and the servers named inside a playlist from one of those. Each remembers which
 * source it's for, since that decides the headers it's asked with. Kept while Catalog runs.
 */
export type RelayKind = 'vidrift' | 'aniwave' | 'movy' | 'live';

const hosts = new Map<string, RelayKind>();
/** Live TV's servers: the headers its player asked them with (sources/daddylive.ts). */
const liveHeaders = new Map<string, Record<string, string>>();

/** A live channel's server, and the headers its pieces are asked with. */
export function trustLiveHost(address: string | URL, headers: Record<string, string>): void {
	try {
		const url = typeof address === 'string' ? new URL(address) : address;
		if (url.protocol !== 'https:') return;
		hosts.set(url.host, 'live');
		liveHeaders.set(url.host, headers);
	} catch {}
}

export const liveHeadersFor = (url: URL): Record<string, string> => liveHeaders.get(url.host) ?? {};

export function trustVideoHost(address: string | URL, kind: RelayKind): void {
	try {
		const url = typeof address === 'string' ? new URL(address) : address;
		if (url.protocol === 'https:') hosts.set(url.host, kind);
	} catch {}
}

export function trustedVideoHost(url: URL): RelayKind | null {
	return url.protocol === 'https:' ? (hosts.get(url.host) ?? null) : null;
}
