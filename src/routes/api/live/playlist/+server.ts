import { error } from '@sveltejs/kit';
import { liveLink, liveTrouble, noteLiveTry } from '$lib/server/sources/daddylive';
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
	const answer = await sharedPlaylist(id);
	if (answer.status !== 200) return error(answer.status, answer.text);
	return new Response(answer.text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
};

/*
 * Every screen watching a channel gets the same playlist for 2 s (liveShare.ts says why: one
 * download of each piece for all of them). It also means one channel's trouble moves it to the
 * next player server once, not once per screen.
 */
type Answer = { status: number; text: string };
const SHARED_MS = 2000;
const recent = new Map<number, { at: number; answer: Promise<Answer> }>();

function sharedPlaylist(id: number): Promise<Answer> {
	const kept = recent.get(id);
	if (kept && Date.now() - kept.at < SHARED_MS) return kept.answer;
	const entry = { at: Date.now(), answer: playlistOf(id) };
	recent.set(id, entry);
	// A failed one isn't kept: the next ask tries again.
	entry.answer.then((a) => {
		if (a.status !== 200 && recent.get(id) === entry) recent.delete(id);
	});
	return entry.answer;
}

/** The channel's playlist; when it can't be had, the channel moves to its next player server. */
async function playlistOf(id: number): Promise<Answer> {
	const answer = await fromItsSource(id);
	if (answer) return answer;
	liveTrouble(id);
	return { status: 502, text: "The channel's server didn't answer" };
}

const get = (address: string, headers: Record<string, string>) => fetch(address, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);

/** The playlist from the player server the channel is on now, or null when it didn't give it. */
async function fromItsSource(id: number): Promise<Answer | null> {
	let link = await liveLink(id);
	if (!link) return failed(id, 'no link');
	let resp = await get(link.url, link.headers);
	// Its token ran out early, or it was refused: a new one, once.
	if (!resp?.ok) {
		link = await liveLink(id, true);
		if (!link) return failed(id, `playlist ${resp?.status ?? 'no answer'}, then no fresh link`);
		resp = await get(link.url, link.headers);
	}
	if (!resp?.ok) return failed(id, `playlist ${resp?.status ?? 'no answer'} twice`);
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
		if (!best.address) return failed(id, 'no stream in its playlist');
		base = new URL(best.address, link.url).href;
		const variant = await get(base, link.headers);
		if (!variant?.ok) return failed(id, `quality playlist ${variant?.status ?? 'no answer'}`);
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
	noteLiveTry(id, 'played');
	return { status: 200, text: out };
}

/** Noted for /api/diagnostics (liveTv.recentTries), then null: the next source is tried. */
function failed(id: number, why: string): null {
	noteLiveTry(id, why);
	return null;
}
