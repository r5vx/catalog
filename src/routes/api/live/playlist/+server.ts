import { error } from '@sveltejs/kit';
import { liveLink, liveTrouble } from '$lib/server/sources/daddylive';
import { trustLiveHost } from '$lib/server/relayHosts';
import type { RequestHandler } from './$types';

/**
 * A live channel's playlist (?ch=<number>), at an address that stays the same while the token
 * behind it changes every two minutes (sources/daddylive.ts). The player asks for it every few
 * seconds, as live playlists are. Its pieces (and any key) go through the relay with the
 * player's headers, so phones and TVs play them too.
 */
export const GET: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('ch'));
	if (!Number.isInteger(id) || id <= 0) return error(400, 'Which channel?');
	let link = await liveLink(id);
	if (!link) return error(503, "That channel can't be found right now");
	const get = (address: string, headers: Record<string, string>) => fetch(address, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
	let resp = await get(link.url, link.headers);
	// Its token ran out early, or it was refused: a new one, once.
	if (!resp?.ok) {
		link = await liveLink(id, true);
		if (!link) return error(503, "That channel can't be found right now");
		resp = await get(link.url, link.headers);
	}
	if (!resp?.ok) {
		liveTrouble(id);
		return error(502, "The channel's server didn't answer");
	}
	let base = link.url;
	let text = await resp.text();
	// A choice of qualities: the highest, fetched here (its pieces are what the player needs).
	if (text.includes('#EXT-X-STREAM-INF')) {
		const lines = text.split('\n');
		let best = { address: '', bandwidth: -1 };
		for (let i = 0; i < lines.length; i++) {
			if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
			const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? 0);
			const address = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'))?.trim();
			if (address && bandwidth > best.bandwidth) best = { address, bandwidth };
		}
		if (!best.address) return error(502, 'No stream in that playlist');
		base = new URL(best.address, link.url).href;
		const variant = await get(base, link.headers);
		if (!variant?.ok) return error(502, "The channel's server didn't answer");
		text = await variant.text();
	}
	const relayed = (address: string) => {
		const full = new URL(address, base);
		trustLiveHost(full, link!.headers);
		return `/api/watch/relay?u=${encodeURIComponent(full.href)}`;
	};
	const out = text
		.split('\n')
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return line;
			if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${relayed(uri)}"`);
			return relayed(trimmed);
		})
		.join('\n');
	return new Response(out, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
};
