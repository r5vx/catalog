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

export async function streamLink(shareKey: string, fid: number, refresh = false): Promise<{ url: string; debug?: string }> {
	// Another source's file: its share key says which show, episode and version. Its video
	// comes through Catalog's relay, so it plays anywhere Catalog does (phone and TV too).
	const aniwave = parseAniwaveShareKey(shareKey);
	if (aniwave) {
		const stream = await aniwaveStream(aniwave.id, aniwave.episode, aniwave.kind, refresh);
		if (!stream) return { url: '', debug: 'Aniwave has no server for this version right now' };
		return { url: `/api/watch/relay?u=${encodeURIComponent(stream.url)}` };
	}

	// 7Movies: its playlist comes through the relay too (the video pieces mostly don't). It and
	// Movy say which copy they are (`copy`), as their episodes are downloaded ahead by that name.
	if (parseVidriftShareKey(shareKey)) {
		const playlist = await vidriftStream(shareKey, refresh);
		if (!playlist) return { url: '', debug: '7Movies has nothing for this right now' };
		return { url: `/api/watch/relay?u=${encodeURIComponent(playlist)}&copy=${encodeURIComponent(shareKey)}` };
	}

	// Movy: found by its own page, out of sight (sources/movy.ts); played through the relay.
	if (parseMovyShareKey(shareKey)) {
		const playlist = await movyStream(shareKey, refresh);
		if (!playlist) return { url: '', debug: 'Movy has nothing for this right now' };
		return { url: `/api/watch/relay?u=${encodeURIComponent(playlist)}&copy=${encodeURIComponent(shareKey)}` };
	}

	const { febboxToken } = readSettings();
	if (!febboxToken) return { url: '' };

	if (refresh) invalidateStreamCache(fid);

	const result = await getStreamUrl(shareKey, fid, febboxToken);
	return { url: result.url ?? '', debug: result.debug };
}
