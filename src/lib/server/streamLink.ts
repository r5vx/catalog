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
import { xumoStream, parseXumoShareKey } from './sources/xumo';
import { tubiStream, parseTubiShareKey } from './sources/tubi';
import { plexStream, parsePlexShareKey } from './sources/plex';
import { plutoStream, parsePlutoShareKey } from './sources/pluto';
import { nothingFrom } from './reachable';
import { debridStream, parseDebridShareKey } from './sources/debrid';
import { addonStream, parseAddonShareKey } from './sources/addons';
import { nyaaStream, parseNyaaShareKey } from './sources/nyaa';
import { channelStream, parseChannelShareKey } from './sources/channels';
import { allanimeStream, parseAllanimeShareKey } from './sources/allanime';
import { kaaStream, parseKaaShareKey } from './sources/kickassanime';
import { showboxAheadAllowed } from './showboxDownloadRoom';
import { trustVideoHost } from './relayHosts';

/**
 * `ahead`: asked by the computer's own player (not a TV or phone, whose Showbox video would then
 * cross the house's Wi-Fi twice). Showbox's copy then comes through the relay, named as a copy, so
 * it's downloaded ahead onto this computer (episodeDownloads.ts) while Febbox's allowance has room.
 */
export async function streamLink(shareKey: string, fid: number, refresh = false, ahead = false): Promise<{ url: string; debug?: string }> {
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

	// Xumo Play (sources/xumo.ts): its own plain playlist, through the relay.
	if (parseXumoShareKey(shareKey)) {
		const found = await xumoStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('Xumo Play', found.why) };
		return { url: found.url };
	}

	// Tubi (sources/tubi.ts): plain HLS only (DRM titles skipped — BuyDRM rejects Electron's CDM).
	if (parseTubiShareKey(shareKey)) {
		const found = await tubiStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('Tubi', found.why) };
		return { url: found.url };
	}

	// Plex free movies & shows (sources/plex.ts): anonymous HLS playlist, through the relay.
	if (parsePlexShareKey(shareKey)) {
		const found = await plexStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('Plex', found.why) };
		return { url: found.url };
	}

	// Pluto TV on demand (sources/pluto.ts): anonymous HLS playlist, through the relay.
	if (parsePlutoShareKey(shareKey)) {
		const found = await plutoStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('Pluto TV', found.why) };
		return { url: found.url };
	}

	// A debrid service (sources/debrid.ts): a direct link to the file, played as it is.
	if (parseDebridShareKey(shareKey)) {
		const found = await debridStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: found.why };
		return { url: found.url, debug: found.name };
	}

	// A Stremio addon (sources/addons.ts): a plain file as it is, or a playlist through the relay.
	if (parseAddonShareKey(shareKey)) {
		const found = await addonStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: found.why };
		return { url: found.url, debug: found.name };
	}

	// Nyaa (sources/nyaa.ts): the file's link from the debrid service, played directly.
	if (parseNyaaShareKey(shareKey)) {
		const found = await nyaaStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: found.why };
		return { url: found.url, debug: found.name };
	}

	// A trusted channel's video (sources/channels.ts): kept by the desktop app's hidden YouTube window, as HLS.
	if (parseChannelShareKey(shareKey)) {
		const found = await channelStream(shareKey);
		if (!found.url) return { url: '', debug: found.why };
		return { url: found.url };
	}

	// AllAnime (sources/allanime.ts): asked directly, after its check is ticked on the computer; played through the relay.
	if (parseAllanimeShareKey(shareKey)) {
		const found = await allanimeStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('AllAnime', found.why) };
		const direct = !/\.m3u8(\?|$|#)|master\.m3u8|playlist\.m3u8/i.test(found.url);
		return { url: `/api/watch/relay?u=${encodeURIComponent(found.url)}${direct ? '&direct=1' : ''}` };
	}

	// KickAssAnime (sources/kickassanime.ts): open JSON API + direct HLS through the relay.
	if (parseKaaShareKey(shareKey)) {
		const found = await kaaStream(shareKey, refresh);
		if (!found.url) return { url: '', debug: await nothingFrom('KickAssAnime', found.why) };
		return { url: `/api/watch/relay?u=${encodeURIComponent(found.url)}` };
	}

	const { febboxToken } = readSettings();
	if (!febboxToken) return { url: '' };

	if (refresh) invalidateStreamCache(fid);

	const result = await getStreamUrl(shareKey, fid, febboxToken);
	const url = result.url ?? '';
	if (ahead && fid > 0 && url.startsWith('https:') && url.includes('.m3u8') && (await showboxAheadAllowed())) {
		trustVideoHost(url, 'febbox');
		return { url: `/api/watch/relay?u=${encodeURIComponent(url)}&copy=${encodeURIComponent(`showbox:${fid}`)}`, debug: result.debug };
	}
	return { url, debug: result.debug };
}
