/**
 * Reading a Matroska (.mkv) file a piece at a time: its tracks, and the subtitles inside it.
 *
 * Anime from Nyaa (sources/nyaa.ts) comes as MKV files with the subtitles inside them, and the
 * player (Chromium) never shows a file's own subtitle tracks. So Catalog reads them out itself:
 * the file's track list near its start, then every subtitle line from each cluster (the file's
 * runs of a few seconds of picture, sound and lines) as that part of the file arrives. The lines
 * are put back together as a whole .ass (or .srt) file, which the player shows like any other.
 *
 * Give it a way to read bytes (`Reader`) and to tell whether bytes are there yet.
 */
import { inflateSync } from 'node:zlib';

/** The bytes from `start` up to (not including) `end`. */
export type Reader = (start: number, end: number) => Promise<Uint8Array>;

export type MkvTrack = {
	number: number;
	kind: 'video' | 'audio' | 'subtitle' | 'other';
	codec: string;
	/** ISO 639-2 ("eng", "jpn"), or "und". */
	language: string;
	name: string;
	default: boolean;
	forced: boolean;
	codecPrivate: Uint8Array | null;
	compression?: { order: number; scope: number; algo: number; settings: Uint8Array }[];
};

export type MkvInfo = {
	/** Nanoseconds per tick of the file's clock (1,000,000 = milliseconds, the usual). */
	timecodeScale: number;
	/** Seconds, when the file says. */
	duration: number;
	tracks: MkvTrack[];
	/** Where the first cluster starts, and where the segment ends (the file's end, mostly). */
	firstCluster: number;
	segmentEnd: number;
};

const ID = {
	EBML: 0x1a45dfa3,
	Segment: 0x18538067,
	SeekHead: 0x114d9b74,
	Seek: 0x4dbb,
	SeekID: 0x53ab,
	SeekPosition: 0x53ac,
	Info: 0x1549a966,
	TimecodeScale: 0x2ad7b1,
	Duration: 0x4489,
	Tracks: 0x1654ae6b,
	TrackEntry: 0xae,
	TrackNumber: 0xd7,
	TrackType: 0x83,
	CodecID: 0x86,
	CodecPrivate: 0x63a2,
	Language: 0x22b59c,
	LanguageBCP47: 0x22b59d,
	Name: 0x536e,
	FlagDefault: 0x88,
	FlagForced: 0x55aa,
	ContentEncodings: 0x6d80,
	ContentEncoding: 0x6240,
	ContentEncodingOrder: 0x5031,
	ContentEncodingScope: 0x5032,
	ContentCompression: 0x5034,
	ContentCompAlgo: 0x4254,
	ContentCompSettings: 0x4255,
	Cluster: 0x1f43b675,
	Timecode: 0xe7,
	SimpleBlock: 0xa3,
	BlockGroup: 0xa0,
	Block: 0xa1,
	BlockDuration: 0x9b
};

type Element = { id: number; size: number; /** Where its contents start and end. */ start: number; end: number; unknownSize: boolean };

/** An element's id and size at `at` in `buf` (`base` = where `buf` is in the file), or null if cut off. */
function header(buf: Uint8Array, at: number, base: number): Element | null {
	const id = vint(buf, at, true);
	if (!id) return null;
	const size = vint(buf, at + id.length, false);
	if (!size) return null;
	const start = base + at + id.length + size.length;
	return { id: id.value, size: size.value, start, end: start + size.value, unknownSize: size.unknown };
}

/** A variable-length number: an element id keeps its length marker, a size doesn't. */
function vint(buf: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
	if (at >= buf.length) return null;
	const first = buf[at];
	if (first === 0) return null;
	let length = 1;
	while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
	if (length > 8 || at + length > buf.length) return null;
	let value = keepMarker ? first : first & (0xff >> length);
	let allOnes = value === (0xff >> length);
	for (let i = 1; i < length; i++) {
		value = value * 256 + buf[at + i];
		if (buf[at + i] !== 0xff) allOnes = false;
	}
	return { value, length, unknown: !keepMarker && allOnes };
}

function uint(buf: Uint8Array, start: number, end: number): number {
	let v = 0;
	for (let i = start; i < end; i++) v = v * 256 + buf[i];
	return v;
}

function float(buf: Uint8Array, start: number, end: number): number {
	const view = new DataView(buf.buffer, buf.byteOffset + start, end - start);
	return end - start === 4 ? view.getFloat32(0) : end - start === 8 ? view.getFloat64(0) : 0;
}

const text = (buf: Uint8Array, start: number, end: number) => new TextDecoder().decode(buf.subarray(start, end)).replace(/\0+$/, '');

/** The children of an element held whole in `buf` (`base` = where `buf` starts in the file). */
function* children(buf: Uint8Array, from: number, to: number, base: number): Generator<Element> {
	let at = from - base;
	while (at < to - base) {
		const el = header(buf, at, base);
		if (!el || el.unknownSize) return;
		yield el;
		at = el.end - base;
	}
}

/** How much is read at a time looking for the file's layout. */
const HEAD = 256 * 1024;

/**
 * The file's tracks and layout. Reads its start (and, if the track list isn't there, where the
 * file's index says it is). Null when it isn't a Matroska file.
 */
export async function readInfo(read: Reader, fileSize: number): Promise<MkvInfo | null> {
	const head = await read(0, Math.min(HEAD, fileSize));
	const ebml = header(head, 0, 0);
	if (!ebml || ebml.id !== ID.EBML) return null;
	const segment = header(head, ebml.end, 0);
	if (!segment || segment.id !== ID.Segment) return null;
	const segmentEnd = segment.unknownSize ? fileSize : Math.min(fileSize, segment.end);

	let timecodeScale = 1_000_000;
	let duration = 0;
	let tracks: MkvTrack[] | null = null;
	let firstCluster = 0;
	const seeks = new Map<number, number>();

	/** One top-level element, read whole when it isn't in `head`. */
	const whole = async (el: Element): Promise<{ buf: Uint8Array; base: number }> =>
		el.end <= head.length ? { buf: head, base: 0 } : { buf: await read(el.start, el.end), base: el.start };

	let at = segment.start;
	while (at < segmentEnd) {
		const local = at < head.length - 12 ? header(head, at, 0) : header(await read(at, Math.min(at + 12, fileSize)), 0, at);
		if (!local) break;
		if (local.id === ID.Cluster) {
			firstCluster = at;
			break;
		}
		if (local.unknownSize) break;
		if (local.id === ID.SeekHead || local.id === ID.Info || local.id === ID.Tracks) {
			const { buf, base } = await whole(local);
			if (local.id === ID.SeekHead) {
				for (const seek of children(buf, local.start, local.end, base)) {
					if (seek.id !== ID.Seek) continue;
					let sid = 0;
					let pos = -1;
					for (const f of children(buf, seek.start, seek.end, base)) {
						if (f.id === ID.SeekID) sid = uint(buf, f.start - base, f.end - base);
						if (f.id === ID.SeekPosition) pos = uint(buf, f.start - base, f.end - base);
					}
					if (sid && pos >= 0) seeks.set(sid, segment.start + pos);
				}
			} else if (local.id === ID.Info) {
				for (const f of children(buf, local.start, local.end, base)) {
					if (f.id === ID.TimecodeScale) timecodeScale = uint(buf, f.start - base, f.end - base) || timecodeScale;
					if (f.id === ID.Duration) duration = float(buf, f.start - base, f.end - base);
				}
			} else {
				tracks = readTracks(buf, local, base);
			}
		}
		at = local.end;
	}
	duration = (duration * timecodeScale) / 1e9;

	// The track list after the clusters (rare): where the index says.
	if (!tracks && seeks.has(ID.Tracks)) {
		const pos = seeks.get(ID.Tracks)!;
		const top = header(await read(pos, Math.min(pos + 12, fileSize)), 0, pos);
		if (top && top.id === ID.Tracks && !top.unknownSize) tracks = readTracks(await read(top.start, top.end), top, top.start);
	}
	if (!tracks || !firstCluster) return null;
	return { timecodeScale, duration, tracks, firstCluster, segmentEnd };
}

function readTracks(buf: Uint8Array, el: Element, base: number): MkvTrack[] {
	const out: MkvTrack[] = [];
	for (const entry of children(buf, el.start, el.end, base)) {
		if (entry.id !== ID.TrackEntry) continue;
		const t: MkvTrack = { number: 0, kind: 'other', codec: '', language: 'eng', name: '', default: true, forced: false, codecPrivate: null };
		let bcp47 = '';
		for (const f of children(buf, entry.start, entry.end, base)) {
			const s = f.start - base;
			const e = f.end - base;
			if (f.id === ID.TrackNumber) t.number = uint(buf, s, e);
			else if (f.id === ID.TrackType) {
				const type = uint(buf, s, e);
				t.kind = type === 1 ? 'video' : type === 2 ? 'audio' : type === 0x11 ? 'subtitle' : 'other';
			} else if (f.id === ID.CodecID) t.codec = text(buf, s, e);
			else if (f.id === ID.CodecPrivate) t.codecPrivate = buf.slice(s, e);
			else if (f.id === ID.Language) t.language = text(buf, s, e) || 'und';
			else if (f.id === ID.LanguageBCP47) bcp47 = text(buf, s, e);
			else if (f.id === ID.Name) t.name = text(buf, s, e);
			else if (f.id === ID.FlagDefault) t.default = uint(buf, s, e) === 1;
			else if (f.id === ID.FlagForced) t.forced = uint(buf, s, e) === 1;
			else if (f.id === ID.ContentEncodings) {
				t.compression = [];
				for (const encoding of children(buf, f.start, f.end, base)) {
					if (encoding.id !== ID.ContentEncoding) continue;
					let order = 0, scope = 1;
					let compression: { algo: number; settings: Uint8Array } | null = null;
					for (const field of children(buf, encoding.start, encoding.end, base)) {
						if (field.id === ID.ContentEncodingOrder) order = uint(buf, field.start - base, field.end - base);
						else if (field.id === ID.ContentEncodingScope) scope = uint(buf, field.start - base, field.end - base);
						else if (field.id === ID.ContentCompression) {
							compression = { algo: 0, settings: new Uint8Array() };
							for (const part of children(buf, field.start, field.end, base)) {
								if (part.id === ID.ContentCompAlgo) compression.algo = uint(buf, part.start - base, part.end - base);
								else if (part.id === ID.ContentCompSettings) compression.settings = buf.slice(part.start - base, part.end - base);
							}
						}
					}
					if (compression) t.compression.push({ order, scope, ...compression });
				}
			}
		}
		if (bcp47) t.language = bcp47.split('-')[0];
		if (t.number) out.push(t);
	}
	return out;
}

/* ------------------------------------------------------------ what Chromium plays */

/**
 * Whether Catalog's player (Electron's Chromium) can play a file with these tracks, and why not.
 * Measured 2026-11-15: H.264, HEVC and AV1 play; AAC and Opus sound plays; AC3, E-AC3 and DTS
 * play silent. H.264 in 10 bits ("Hi10P", common in older fansubs) has no decoder in Chromium.
 */
export function playable(info: MkvInfo): { ok: boolean; why: string } {
	const video = info.tracks.find((t) => t.kind === 'video');
	const audio = info.tracks.filter((t) => t.kind === 'audio');
	if (!video) return { ok: false, why: 'no picture' };
	if (!/^V_(MPEG4\/ISO\/AVC|MPEGH\/ISO\/HEVC|AV1|VP9|VP8)$/.test(video.codec)) return { ok: false, why: `picture is ${video.codec}` };
	// H.264's profile is the second byte of its setup (avcC): 110 and up are 10-bit and more.
	if (video.codec === 'V_MPEG4/ISO/AVC' && video.codecPrivate && video.codecPrivate.length > 1 && video.codecPrivate[1] >= 110)
		return { ok: false, why: '10-bit H.264' };
	const heard = (t: MkvTrack) => /^A_(AAC.*|OPUS|VORBIS|FLAC|MPEG\/L3|MPEG\/L2|PCM\/INT\/LIT)$/.test(t.codec);
	if (audio.length && !heard(audio.find((t) => t.default) ?? audio[0])) {
		if (!audio.some(heard)) return { ok: false, why: `sound is ${audio[0].codec}` };
	}
	return { ok: true, why: '' };
}

/* ------------------------------------------------------------ subtitles */

export type SubLine = { track: number; start: number; end: number; data: string; bytes?: Uint8Array; duration?: number };

/**
 * The subtitle lines in one cluster, held whole in `buf` from `base`. A line's length comes from
 * its block group; a plain SimpleBlock line lasts until `fallback` seconds (rare for subtitles).
 */
export function clusterLines(buf: Uint8Array, el: { start: number; end: number }, base: number, info: MkvInfo, wanted: Set<number>): SubLine[] {
	const scale = info.timecodeScale / 1e9;
	let clusterTime = 0;
	const out: SubLine[] = [];
	const block = (s: number, e: number, duration: number | null) => {
		const track = vint(buf, s - base, false);
		if (!track || !wanted.has(track.value)) return;
		const at = s - base + track.length;
		const relative = (buf[at] << 24) >> 16 | buf[at + 1];
		const flags = buf[at + 2];
		if (flags & 0x06) return; // laced: not used for subtitles
		const start = (clusterTime + relative) * scale;
		const end = duration !== null ? start + duration * scale : start + 4;
		const description = info.tracks.find((t) => t.number === track.value);
		let bytes: Uint8Array = buf.subarray(at + 3, e - base);
		try {
			for (const compression of [...(description?.compression ?? [])].sort((a, b) => b.order - a.order)) {
				if (!(compression.scope & 1)) continue;
				if (compression.algo === 0) bytes = inflateSync(bytes);
				else if (compression.algo === 3) bytes = Buffer.concat([compression.settings, bytes]);
				else return;
			}
		} catch {
			return;
		}
		const picture = description && isPictureTrack(description);
		out.push({ track: track.value, start, end, data: picture ? '' : new TextDecoder().decode(bytes),
			...(picture ? { bytes, ...(duration !== null ? { duration: duration * scale } : {}) } : {}) });
	};
	for (const f of children(buf, el.start, el.end, base)) {
		if (f.id === ID.Timecode) clusterTime = uint(buf, f.start - base, f.end - base);
		else if (f.id === ID.SimpleBlock) block(f.start, f.end, null);
		else if (f.id === ID.BlockGroup) {
			let b: Element | null = null;
			let duration: number | null = null;
			for (const g of children(buf, f.start, f.end, base)) {
				if (g.id === ID.Block) b = g;
				else if (g.id === ID.BlockDuration) duration = uint(buf, g.start - base, g.end - base);
			}
			if (b) block(b.start, b.end, duration);
		}
	}
	return out;
}

/**
 * Walks a file's clusters from the start as they arrive, keeping every subtitle line. `has` says
 * whether bytes are there yet (nothing is asked for that isn't, so this never slows the video);
 * `step` reads on as far as it can and says whether it reached the end.
 */
export class SubtitleReader {
	lines: SubLine[] = [];
	done = false;
	private at: number;
	private wanted: Set<number>;
	private busy: Promise<boolean> | null = null;
	private info: MkvInfo;
	private read: Reader;
	private has: (start: number, end: number) => boolean;
	/** Whether the download has reached past this point (something after it is there already). */
	private past: (at: number) => boolean;

	constructor(info: MkvInfo, read: Reader, has: (start: number, end: number) => boolean, past: (at: number) => boolean = () => false) {
		this.info = info;
		this.read = read;
		this.has = has;
		this.past = past;
		this.at = info.firstCluster;
		this.wanted = new Set(info.tracks.filter((t) => t.kind === 'subtitle').map((t) => t.number));
		if (!this.wanted.size) this.done = true;
	}

	/** How far through the file it has read (0–1). */
	get progress() {
		return this.done ? 1 : (this.at - this.info.firstCluster) / Math.max(1, this.info.segmentEnd - this.info.firstCluster);
	}

	step(): Promise<boolean> {
		this.busy ??= this.stepNow().finally(() => (this.busy = null));
		return this.busy;
	}

	private async stepNow(): Promise<boolean> {
		const end = this.info.segmentEnd;
		while (!this.done && this.at < end) {
			const top = Math.min(this.at + 12, end);
			// Bytes not there yet are only waited for (and so asked for) once the download is past them:
			// a torrent leaves the odd piece behind for a while (Frieren E1: 28 MB of holes with 945 MB in).
			if (!this.has(this.at, top) && !this.past(top)) return false;
			const el = header(await this.read(this.at, top), 0, this.at);
			if (!el || el.unknownSize) {
				this.done = true;
				break;
			}
			if (el.id === ID.Cluster) {
				const stop = Math.min(el.end, end);
				if (!this.has(el.start, stop) && !this.past(stop)) return false;
				const buf = await this.read(el.start, stop);
				this.lines.push(...clusterLines(buf, el, el.start, this.info, this.wanted));
			}
			this.at = el.end;
		}
		this.done = true;
		return true;
	}
}

/** One subtitle track as a file of its own: .ass with the file's own styles, or .srt. */
export function subtitleFile(track: MkvTrack, lines: SubLine[]): { text: string; ext: 'ass' | 'srt' } {
	const mine = lines.filter((l) => l.track === track.number);
	if (/^S_TEXT\/(ASS|SSA)$/.test(track.codec) && track.codecPrivate) {
		const head = new TextDecoder().decode(track.codecPrivate).replace(/\r/g, '').trimEnd();
		// A Matroska ASS line: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text.
		const events = mine
			.map((l) => {
				const parts = l.data.split(',');
				const order = Number(parts[0]) || 0;
				const rest = parts.slice(1);
				const textPart = rest.slice(7).join(',');
				return { order, line: `Dialogue: ${rest[0] ?? '0'},${assTime(l.start)},${assTime(l.end)},${rest.slice(1, 7).join(',')},${textPart}` };
			})
			.sort((a, b) => a.order - b.order)
			.map((e) => e.line);
		const withEvents = /\[Events\]/i.test(head)
			? head
			: `${head}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
		return { text: `${withEvents}\n${events.join('\n')}\n`, ext: 'ass' };
	}
	const srt = mine
		.sort((a, b) => a.start - b.start)
		.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.data.replace(/\r/g, '').trim()}\n`)
		.join('\n');
	return { text: srt, ext: 'srt' };
}

/** Text tracks the player can show (not picture-based ones like PGS or VobSub). */
export const isTextTrack = (t: MkvTrack) => t.kind === 'subtitle' && /^S_TEXT\/(ASS|SSA|UTF8|WEBVTT)$/.test(t.codec);
export const isPictureTrack = (t: MkvTrack) => t.kind === 'subtitle' && t.codec === 'S_VOBSUB';

function assTime(s: number) {
	const cs = Math.max(0, Math.round(s * 100));
	const h = Math.floor(cs / 360000);
	const m = Math.floor(cs / 6000) % 60;
	const sec = Math.floor(cs / 100) % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function srtTime(s: number) {
	const ms = Math.max(0, Math.round(s * 1000));
	const h = Math.floor(ms / 3600000);
	const m = Math.floor(ms / 60000) % 60;
	const sec = Math.floor(ms / 1000) % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
