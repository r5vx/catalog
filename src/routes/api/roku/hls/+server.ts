import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * A Showbox playlist made plain for the Roku (/api/roku/play hands this out instead of Showbox's own):
 * only its top quality with AAC sound, and only that sound track.
 *
 * Showbox's playlists offer each quality twice, with AAC sound and with Dolby Digital Plus (ec-3),
 * as separate tracks. The Roku was told to take only the top bandwidth, which is the ec-3 one; a
 * Roku that can't play that has nothing it can play, says the video "finished", and the player
 * went on to the next episode or back out (every film and episode, 2026-11-08). One quality also
 * keeps it at the top without asking the Roku to (Catalog never lowers the quality by itself).
 * The addresses inside stay Showbox's: its server needs no Referer for them.
 */
const SHOWBOX_VIDEO = /(^|\.)shegu\.net$/i;

export const GET: RequestHandler = async ({ url }) => {
	let target: URL;
	try {
		target = new URL(url.searchParams.get('u') ?? '');
	} catch {
		return error(400, 'Bad address');
	}
	if (target.protocol !== 'https:' || !SHOWBOX_VIDEO.test(target.hostname)) return error(403, 'Not a Showbox playlist');
	const resp = await fetch(target, { headers: { Referer: 'https://www.febbox.com/' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
	if (!resp?.ok) return error(502, "Showbox's video server didn't answer");
	const text = await resp.text();
	return new Response(plainPlaylist(text, target), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
};

/** The playlist with one quality (the top with AAC sound) and its sound track; unchanged when it has no qualities to choose. */
function plainPlaylist(text: string, base: URL): string {
	const lines = text.replace(/\r/g, '').split('\n');
	type Quality = { info: string; address: string; bandwidth: number; audio: string };
	const qualities: Quality[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
		const address = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'));
		if (!address) continue;
		const info = lines[i];
		const codecs = /CODECS="([^"]*)"/.exec(info)?.[1] ?? '';
		// AAC sound and H.264 picture only (no ec-3/ac-3 sound, no HEVC).
		if (/ec-3|ac-3|hvc1|hev1/i.test(codecs) || (codecs && !/mp4a/i.test(codecs))) continue;
		qualities.push({ info, address: new URL(address.trim(), base).href, bandwidth: Number(/[:,]BANDWIDTH=(\d+)/.exec(info)?.[1] ?? 0), audio: /AUDIO="([^"]*)"/.exec(info)?.[1] ?? '' });
	}
	if (!qualities.length) return text;
	const top = qualities.reduce((best, q) => (q.bandwidth > best.bandwidth ? q : best));
	const out = ['#EXTM3U'];
	for (const line of lines) {
		if (/^#EXT-X-(VERSION|INDEPENDENT-SEGMENTS)/.test(line)) out.push(line);
		// Only the chosen quality's sound track, its address made whole.
		if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line) && top.audio && line.includes(`GROUP-ID="${top.audio}"`)) {
			out.push(line.replace(/URI="([^"]*)"/, (_, uri: string) => `URI="${new URL(uri, base).href}"`));
		}
	}
	out.push(top.info, top.address);
	return out.join('\n') + '\n';
}
