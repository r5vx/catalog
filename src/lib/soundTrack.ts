/**
 * Reading a video's separate sound track (the HLS audio playlist Showbox's videos come with),
 * for auto-timing subtitles (subtitleSync.ts) and finding intros and credits (skipFinder.ts).
 * Its pieces are plain downloads anyone may read, so this works on a phone too.
 */

export type SoundTrack = {
	/** Address of the playlist's starting piece (the format details), if it has one. */
	init: string | null;
	pieces: { url: string; at: number; length: number }[];
	duration: number;
};

/** An address made whole (the relay's are relative to this page: /api/watch/relay?u=…). */
const whole = (url: string) => new URL(url, globalThis.location?.href).href;

export async function readSoundTrack(playlistUrl: string, signal?: AbortSignal): Promise<SoundTrack | null> {
	playlistUrl = whole(playlistUrl);
	const resp = await fetch(playlistUrl, { signal });
	if (!resp.ok) return null;
	const playlist = await resp.text();
	const init = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
	const pieces: SoundTrack['pieces'] = [];
	let at = 0;
	let length = 0;
	for (const line of playlist.split('\n').map((l) => l.trim())) {
		if (line.startsWith('#EXTINF:')) length = parseFloat(line.slice(8));
		else if (line && !line.startsWith('#')) {
			pieces.push({ url: new URL(line, playlistUrl).href, at, length });
			at += length;
		}
	}
	return pieces.length ? { init: init ? new URL(init, playlistUrl).href : null, pieces, duration: at } : null;
}

const initCache = new Map<string, Uint8Array<ArrayBuffer>>();

/**
 * The sound from `from` to `to` seconds (whole pieces, so it may start a little earlier: `at`
 * says where), decoded by the browser at `rate` samples a second and made mono.
 */
export async function soundBetween(
	track: SoundTrack,
	from: number,
	to: number,
	rate: number,
	signal?: AbortSignal
): Promise<{ at: number; samples: Float32Array }> {
	const pieces = track.pieces.filter((p) => p.at + p.length > from && p.at < to);
	if (!pieces.length) return { at: from, samples: new Float32Array(0) };
	// Ten at a time: fifty at once ran Windows out of connection room (ERR_NO_BUFFER_SPACE),
	// and six made a whole episode take a minute.
	const parts: Uint8Array<ArrayBuffer>[] = new Array(pieces.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(10, pieces.length) }, async () => {
			while (next < pieces.length) {
				const i = next++;
				parts[i] = new Uint8Array(await (await fetch(pieces[i].url, { signal })).arrayBuffer());
			}
		})
	);
	if (track.init) {
		let init = initCache.get(track.init);
		if (!init) {
			init = new Uint8Array(await (await fetch(track.init, { signal })).arrayBuffer());
			initCache.set(track.init, init);
		}
		parts.unshift(init);
	}
	const bytes = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
	let offset = 0;
	for (const b of parts) {
		bytes.set(b, offset);
		offset += b.length;
	}
	const sound = await new OfflineAudioContext(1, rate, rate).decodeAudioData(bytes.buffer);
	const mono = new Float32Array(sound.length);
	for (let c = 0; c < sound.numberOfChannels; c++) {
		const channel = sound.getChannelData(c);
		for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / sound.numberOfChannels;
	}
	return { at: pieces[0].at, samples: mono };
}

/**
 * From a video's main playlist, the sound track in `language` (or the default one), the stereo
 * one where there's a choice: it's a quarter of the size of 5.1. Never a Dolby (AC-3/E-AC-3)
 * one: the browser can't decode those itself (Delicious in Dungeon's playlist has both kinds).
 */
export async function soundTrackIn(masterUrl: string, language: string, signal?: AbortSignal): Promise<string | null> {
	masterUrl = whole(masterUrl);
	const resp = await fetch(masterUrl, { signal });
	if (!resp.ok) return null;
	const master = await resp.text();
	// Which audio groups the Dolby versions of the video use.
	const dolby = new Set(
		[...master.matchAll(/#EXT-X-STREAM-INF:[^\n]*/g)]
			.map((m) => m[0])
			.filter((line) => /CODECS="[^"]*\b(ec-3|ac-3)\b/i.test(line))
			.map((line) => line.match(/AUDIO="([^"]*)"/)?.[1] ?? '')
	);
	const tracks = [...master.matchAll(/#EXT-X-MEDIA:([^\n]*TYPE=AUDIO[^\n]*)/g)].map((m) => {
		const attr = (name: string) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
		return { lang: attr('LANGUAGE'), uri: attr('URI'), channels: attr('CHANNELS'), group: attr('GROUP-ID'), isDefault: /DEFAULT=YES/.test(m[1]) };
	}).filter((t) => t.uri && !dolby.has(t.group) && !/ec-?3|ac-?3/i.test(t.group));
	const same = tracks.filter((t) => (language ? t.lang === language : t.isDefault));
	const pick = same.find((t) => t.channels === '2') ?? same[0] ?? tracks.find((t) => t.isDefault) ?? tracks[0];
	return pick ? new URL(pick.uri, masterUrl).href : null;
}
