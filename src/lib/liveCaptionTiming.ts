/**
 * Live TV captions timed by their words (owner's request, 2026-10-31; Live TV only, for now).
 *
 * Live captions are typed by a person as the commentators talk, so they come a few seconds late.
 * Auto-timing by "someone's talking / a caption shows" can't see it (commentary never stops and
 * roll-up captions are always up), but the words can: the computer hears what's said (Whisper,
 * /caption-timer), finds the same three words in the captions, and the gap is the delay. Measured
 * on Kent State vs Sacramento State (ESPN2): 773 matches, 5.28 s late, every minute 5.2–5.3 s; 10 s
 * of sound already gave the answer within 0.3 s in 96% of tries (CATALOG_CONTEXT.md).
 *
 * Here: reading a live piece (MPEG-TS) for its sound (ADTS AAC) and its captions (CEA-608 CC1 in
 * the H.264 "GA94" SEI), and finding the lag from words. Times are seconds on the video's own clock.
 */

export type Word = { w: string; at: number };

/** A piece's sound: its ADTS AAC frames, and when the first one plays. */
export type PieceSound = { start: number; adts: Uint8Array };

type Pes = { pts: number | null; parts: Uint8Array[] };

const concat = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

const ptsOf = (b: Uint8Array) => ((b[0] >> 1) & 7) * 2 ** 30 + ((b[1] << 7) | (b[2] >> 1)) * 2 ** 15 + ((b[3] << 7) | (b[4] >> 1));

/**
 * MPEG-TS split into its video and sound (a packet stream that may end mid-way through one: what's
 * open carries on into the next piece).
 */
export class TsReader {
	private pmtPid = -1;
	private videoPid = -1;
	private audioPid = -1;
	private open = new Map<number, Pes>();
	private videoPes: Pes[] = [];
	private audioPes: Pes[] = [];

	/** One piece's bytes: its captions' byte pairs by frame, and its sound. */
	read(ts: Uint8Array): { frames: { t: number; pairs: number[][] }[]; sound: PieceSound | null } {
		for (let i = 0; i + 188 <= ts.length; i += 188) this.packet(ts, i);
		// What's whole now (a PES ends where the next of its stream starts; the last waits).
		const video = this.videoPes.splice(0);
		const audio = this.audioPes.splice(0);
		const frames: { t: number; pairs: number[][] }[] = [];
		for (const pes of video) if (pes.pts !== null) frames.push(...captionPairs(concat(pes.parts), pes.pts / 90000));
		// Shown in picture order (B-frames come before the frames they're shown after).
		frames.sort((a, b) => a.t - b.t);
		const timed = audio.filter((p) => p.pts !== null);
		const sound = timed.length ? { start: timed[0].pts! / 90000, adts: concat(timed.flatMap((p) => p.parts)) } : null;
		return { frames, sound };
	}

	private packet(ts: Uint8Array, i: number) {
		if (ts[i] !== 0x47) return;
		const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
		const start = (ts[i + 1] & 0x40) !== 0;
		const afc = (ts[i + 3] >> 4) & 3;
		let p = i + 4;
		if (afc & 2) p += 1 + ts[p];
		if (!(afc & 1) || p >= i + 188) return;
		if (pid === 0 && start) {
			const q = p + 1 + ts[p];
			this.pmtPid = ((ts[q + 10] & 0x1f) << 8) | ts[q + 11];
			return;
		}
		if (pid === this.pmtPid && start) {
			const q = p + 1 + ts[p];
			const length = ((ts[q + 1] & 0x0f) << 8) | ts[q + 2];
			const info = ((ts[q + 10] & 0x0f) << 8) | ts[q + 11];
			for (let e = q + 12 + info; e < q + 3 + length - 4; ) {
				const type = ts[e];
				const streamPid = ((ts[e + 1] & 0x1f) << 8) | ts[e + 2];
				if (type === 0x1b) this.videoPid = streamPid;
				if (type === 0x0f) this.audioPid = streamPid;
				e += 5 + (((ts[e + 3] & 0x0f) << 8) | ts[e + 4]);
			}
			return;
		}
		if (pid !== this.videoPid && pid !== this.audioPid) return;
		const done = pid === this.videoPid ? this.videoPes : this.audioPes;
		if (start) {
			const was = this.open.get(pid);
			if (was) done.push(was);
			const flags = ts[p + 7];
			const headerLength = ts[p + 8];
			this.open.set(pid, { pts: flags & 0x80 ? ptsOf(ts.subarray(p + 9, p + 14)) : null, parts: [ts.slice(p + 9 + headerLength, i + 188)] });
		} else this.open.get(pid)?.parts.push(ts.slice(p, i + 188));
	}
}

/** The CEA-608/708 byte pairs a video PES carries (H.264 SEI, user data "GA94"): [type, a, b] each. */
function captionPairs(b: Uint8Array, t: number): { t: number; pairs: number[][] }[] {
	const out: { t: number; pairs: number[][] }[] = [];
	for (let k = 0; k + 4 < b.length; k++) {
		if (!(b[k] === 0 && b[k + 1] === 0 && b[k + 2] === 1) || (b[k + 3] & 0x1f) !== 6) continue;
		let s = k + 4;
		while (s < b.length - 2) {
			let type = 0;
			let size = 0;
			while (b[s] === 0xff) {
				type += 255;
				s++;
			}
			type += b[s++];
			while (b[s] === 0xff) {
				size += 255;
				s++;
			}
			size += b[s++];
			// user_data_registered_itu_t_t35: USA (0xB5), ATSC (0x0031), "GA94", cc_data (3).
			if (type === 4 && b[s] === 0xb5 && b[s + 1] === 0 && b[s + 2] === 0x31 && b[s + 3] === 0x47 && b[s + 4] === 0x41 && b[s + 5] === 0x39 && b[s + 6] === 0x34 && b[s + 7] === 3) {
				const count = b[s + 8] & 0x1f;
				const pairs: number[][] = [];
				for (let c = 0; c < count; c++) {
					const o = s + 10 + c * 3;
					// The first byte: marker bits, "valid" (bit 2), and the type (bits 0–1: 0 field 1, 1 field 2, 2–3 digital).
					if (b[o] & 4) pairs.push([b[o] & 3, b[o + 1] & 0x7f, b[o + 2] & 0x7f]);
				}
				out.push({ t, pairs });
			}
			s += size;
			if (b[s] === 0x80) break;
		}
	}
	return out;
}

/**
 * Caption words, in the order they come, each at the time its last letter arrived (when it shows on
 * screen). CC1 only: field 1, channel 1. A control code (new line, roll-up) is a space between words.
 */
export class CaptionWords {
	private channel = 0;
	private word = '';
	private wordAt = 0;
	private lastAt = -1;

	read(frames: { t: number; pairs: number[][] }[]): Word[] {
		const words: Word[] = [];
		const end = () => {
			if (this.word) words.push({ w: this.word, at: this.wordAt });
			this.word = '';
		};
		for (const { t, pairs } of frames) {
			for (const [type, a, b] of pairs) {
				if (type !== 0 || (a === 0 && b === 0)) continue;
				if (a >= 0x10 && a <= 0x1f) {
					this.channel = a & 0x08 ? 1 : 0;
					if (this.channel === 0) end();
					continue;
				}
				if (this.channel !== 0) continue;
				for (const c of [a, b]) {
					if (c < 0x20) continue;
					if (this.lastAt >= 0 && t - this.lastAt > 0.5) end();
					this.lastAt = t;
					if (c === 0x20) end();
					else {
						this.word += String.fromCharCode(c);
						this.wordAt = t;
					}
				}
			}
		}
		return words;
	}
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');

/**
 * The lag, from caption words and words heard (both on the video's clock). Each run of three caption
 * words (not all short ones) found exactly once in what was heard in the 20 s before it showed (or
 * up to 3 s after) gives one lag. The answer is their median, once at least three agree within 0.5 s;
 * from the last three minutes, so a change in the captioning shows.
 */
export class LagFinder {
	private caps: Word[] = [];
	private heard: Word[] = [];

	addCaptions(words: Word[]) {
		for (const x of words) {
			const w = norm(x.w);
			if (w) this.caps.push({ w, at: x.at });
		}
		this.forgetOld();
	}

	addHeard(words: Word[]) {
		for (const x of words) {
			const w = norm(x.w);
			if (w && Number.isFinite(x.at)) this.heard.push({ w, at: x.at });
		}
		this.heard.sort((a, b) => a.at - b.at);
		this.forgetOld();
	}

	/** Kept for five minutes (the answer uses three). */
	private forgetOld() {
		const newest = Math.max(this.caps.at(-1)?.at ?? 0, this.heard.at(-1)?.at ?? 0);
		this.caps = this.caps.filter((x) => x.at > newest - 300);
		this.heard = this.heard.filter((x) => x.at > newest - 300);
	}

	/** Every lag found, with when its caption showed. */
	lags(): { t: number; lag: number }[] {
		const out: { t: number; lag: number }[] = [];
		const heard = this.heard;
		for (let i = 0; i + 2 < this.caps.length; i++) {
			const run = [this.caps[i].w, this.caps[i + 1].w, this.caps[i + 2].w];
			if (run.every((w) => w.length <= 3)) continue;
			const t = this.caps[i + 2].at;
			let found: number | null = null;
			let twice = false;
			for (let j = 0; j + 2 < heard.length; j++) {
				const at = heard[j + 2].at;
				if (at < t - 20) continue;
				if (at > t + 3) break;
				if (heard[j].w === run[0] && heard[j + 1].w === run[1] && heard[j + 2].w === run[2]) {
					if (found !== null) twice = true;
					found = t - at;
				}
			}
			if (found !== null && !twice) out.push({ t, lag: found });
		}
		return out;
	}

	/** The lag now (seconds the captions come late) and how many runs it rests on; null until three agree. */
	estimate(): { lag: number; matches: number } | null {
		const all = this.lags();
		const newest = all.at(-1)?.t ?? 0;
		const recent = all.filter((l) => l.t > newest - 180).map((l) => l.lag).sort((a, b) => a - b);
		if (recent.length < 3) return null;
		const median = recent[Math.floor(recent.length / 2)];
		const agree = recent.filter((lag) => Math.abs(lag - median) < 0.5).length;
		return agree >= 3 ? { lag: median, matches: recent.length } : null;
	}
}
