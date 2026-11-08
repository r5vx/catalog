/**
 * The playlist address for one copy of a video, by its share key and file number: what the player
 * asks /api/watch/stream for, and what a download (downloads.ts) starts from. Another source's
 * copy (Aniwave, 7Movies, Movy) comes back as a relay address on this server ("/api/watch/relay…");
 * Showbox's is Febbox's own.
 */
import { getStreamUrl, invalidateStreamCache } from './showbox';
import { readSettings } from './settings';
import { aniwaveStream, parseAniwaveShareKey } from './sources/aniwave';
import { vidriftStream, parseVidriftShareKey } from './sources/vidrift';
import { movyStream, parseMovyShareKey } from './sources/movy';
import { hianimeStream, parseHianimeShareKey } from './sources/hianime';
import { vidfastStream, parseVidfastShareKey } from './sources/vidfast';
import { nothingFrom } from './reachable';

export async function streamLink(shareKey: string, fid: number, refresh = false): Promise<{ url: string; debug?: string }> {
	// Another source's file: its share key says which show, episode and version. Its video
	// comes through Catalog's relay, so it plays anywhere Catalog does (phone and TV too).
	const aniwave = parseAniwaveShareKey(shareKey);
	if (aniwave) {
		const stream = await aniwaveStream(aniwave.id, aniwave.episode, aniwave.kind, refresh);
		if (!stream) return { url: '', debug: await nothingFrom('Aniwave', 'Aniwave has no server for this version right now') };
		return { url: `/api/watch/relay?u=${encodeURIComponent(stream.url)}` };
	}

	// HiAnime: asked by MyAnimeList number and episode; its video comes through the relay.
	const hianime = parseHianimeShareKey(shareKey);
	if (hianime) {
		const stream = await hianimeStream(hianime.mal, hianime.episode, hianime.kind, refresh);
		if (!stream) return { url: '', debug: await nothingFrom('HiAnime', 'HiAnime has nothing for this version right now') };
		return { url: `/api/watch/relay?u=${encodeURIComponent(stream.url)}` };
	}

	// 7Movies: its playlist comes through the relay too (the video pieces mostly don't). It and
	// Movy say which copy they are (`copy`), as their episodes are downloaded ahead by that name.
	if (parseVidriftShareKey(shareKey)) {
		const playlist = await vidriftStream(shareKey, refresh);
		if (!playlist) return { url: '', debug: await nothingFrom('7Movies', '7Movies has nothing for this right now') };
		return { url: `/api/watch/relay?u=${encodeURIComponent(playlist)}&copy=${encodeURIComponent(shareKey)}` };
	}

	// Movy: found by its own page, out of sight (sources/movy.ts); played through the relay.
	if (parseMovyShareKey(shareKey)) {
		const playlist = await movyStream(shareKey, refresh);
		if (!playlist) return { url: '', debug: await nothingFrom('Movy', 'Movy has nothing for this right now') };
		return { url: `/api/watch/relay?u=${encodeURIComponent(playlist)}&copy=${encodeURIComponent(shareKey)}` };
	}

	// Vidfast: found by its own page, out of sight (sources/vidfast.ts); played through the relay.
	if (parseVidfastShareKey(shareKey)) {
		const playlist = await vidfastStream(shareKey, refresh);
		if (!playlist) return { url: '', debug: await nothingFrom('Vidfast', 'Vidfast has nothing for this right now') };
		return { url: `/api/watch/relay?u=${encodeURIComponent(playlist)}` };
	}

	const { febboxToken } = readSettings();
	if (!febboxToken) return { url: '' };

	if (refresh) invalidateStreamCache(fid);

	const result = await getStreamUrl(shareKey, fid, febboxToken);
	return { url: result.url ?? '', debug: result.debug };
}
