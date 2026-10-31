// Live captions straight from a recorded .ts: the CEA-608 bytes each frame carries (H.264 SEI,
// "GA94"), by field, with the frame's time. Prints which field/channel has text, and writes
// each word with the time its last letter arrived: node cc.mjs <game.ts> <out.json>
import fs from 'node:fs';
const [input, out] = process.argv.slice(2);
const ts = fs.readFileSync(input);
let videoPid = -1, pmtPid = -1;
const pes = [];
let cur = null;
for (let i = 0; i + 188 <= ts.length; i += 188) {
	if (ts[i] !== 0x47) continue;
	const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
	const start = (ts[i + 1] & 0x40) !== 0;
	const afc = (ts[i + 3] >> 4) & 3;
	let p = i + 4;
	if (afc & 2) p += 1 + ts[p];
	if (!(afc & 1) || p >= i + 188) continue;
	if (pid === 0 && start) { const q = p + 1 + ts[p]; pmtPid = ((ts[q + 10] & 0x1f) << 8) | ts[q + 11]; continue; }
	if (pid === pmtPid && start) {
		const q = p + 1 + ts[p]; const len = ((ts[q + 1] & 0x0f) << 8) | ts[q + 2]; const info = ((ts[q + 10] & 0x0f) << 8) | ts[q + 11];
		for (let e = q + 12 + info; e < q + 3 + len - 4;) { const type = ts[e]; const epid = ((ts[e + 1] & 0x1f) << 8) | ts[e + 2]; if (type === 0x1b) videoPid = epid; e += 5 + (((ts[e + 3] & 0x0f) << 8) | ts[e + 4]); }
		continue;
	}
	if (pid !== videoPid) continue;
	if (start) {
		if (cur) pes.push(cur);
		const flags = ts[p + 7], hl = ts[p + 8];
		let pts = null;
		if (flags & 0x80) { const b = ts.subarray(p + 9, p + 14); pts = ((b[0] >> 1) & 7) * 2 ** 30 + ((b[1] << 7) | (b[2] >> 1)) * 2 ** 15 + ((b[3] << 7) | (b[4] >> 1)); }
		cur = { pts, parts: [ts.subarray(p + 9 + hl, i + 188)] };
	} else if (cur) cur.parts.push(ts.subarray(p, i + 188));
}
if (cur) pes.push(cur);
// Each frame's caption pairs, in the order the frames are shown (by PTS).
const frames = [];
for (const { pts, parts } of pes) {
	const b = Buffer.concat(parts);
	for (let k = 0; k + 4 < b.length; k++) {
		if (!(b[k] === 0 && b[k + 1] === 0 && b[k + 2] === 1)) continue;
		if ((b[k + 3] & 0x1f) !== 6) continue;
		let s = k + 4;
		while (s < b.length - 2) {
			let type = 0, size = 0;
			while (b[s] === 0xff) { type += 255; s++; } type += b[s++];
			while (b[s] === 0xff) { size += 255; s++; } size += b[s++];
			if (type === 4 && b[s] === 0xb5 && b.readUInt16BE(s + 1) === 0x31 && b.toString('latin1', s + 3, s + 7) === 'GA94' && b[s + 7] === 3) {
				const count = b[s + 8] & 0x1f;
				const pairs = [];
				for (let c = 0; c < count; c++) { const o = s + 10 + c * 3; pairs.push([b[o] & 3, b[o + 1] & 0x7f, b[o + 2] & 0x7f, (b[o] & 4) !== 0]); }
				frames.push({ t: pts / 90000, pairs });
			}
			s += size;
			if (b[s] === 0x80) break;
		}
	}
}
frames.sort((a, b) => a.t - b.t);
let jump = 0;
for (let i = 1; i < frames.length; i++) jump = Math.max(jump, frames[i].t - frames[i - 1].t);
console.log('longest step between frames (s):', jump.toFixed(3));
const t0 = frames[0]?.t ?? 0;
// Text per field (cc_type 0 = field 1: CC1/CC2, 1 = field 2: CC3/CC4) and per channel (control codes' bit 3).
const chans = { 'CC1': [], 'CC2': [], 'CC3': [], 'CC4': [] };
const chanOf = [0, 0];
let dtvcc = 0;
for (const f of frames) {
	for (const [type, a, b, valid] of f.pairs) {
		if (!valid) continue;
		if (type >= 2) { dtvcc++; continue; }
		if (a === 0 && b === 0) continue;
		if (a >= 0x10 && a <= 0x1f) {
			// A control code (new line, roll-up, position): the words either side are apart.
			chanOf[type] = (a & 0x08) ? 1 : 0;
			chans[['CC1', 'CC2', 'CC3', 'CC4'][type * 2 + chanOf[type]]].push({ c: ' ', t: f.t - t0 });
			continue;
		}
		const name = ['CC1', 'CC2', 'CC3', 'CC4'][type * 2 + chanOf[type]];
		for (const c of [a, b]) if (c >= 0x20) chans[name].push({ c: String.fromCharCode(c), t: f.t - t0 });
	}
}
for (const [k, v] of Object.entries(chans)) console.log(k, v.length, 'letters:', v.slice(0, 80).map((x) => x.c).join('').replace(/\s+/g, ' '));
console.log('digital (708) bytes:', dtvcc, 'frames with captions:', frames.length);
const best = Object.entries(chans).sort((a, b) => b[1].length - a[1].length)[0];
// Words, each at the time its last letter came (control codes between words count as a space).
const words = [];
let word = '', at = 0, lastT = -1;
for (const { c, t } of best[1]) {
	if (lastT >= 0 && t - lastT > 0.5 && word) { words.push({ w: word, at }); word = ''; }
	if (/\s/.test(c)) { if (word) words.push({ w: word, at }); word = ''; }
	else { word += c; at = t; }
	lastT = t;
}
if (word) words.push({ w: word, at });
fs.writeFileSync(out, JSON.stringify({ channel: best[0], start: t0, words }));
console.log('video starts at', t0.toFixed(3));
console.log(`${best[0]}: ${words.length} words; first: ${words.slice(0, 25).map((w) => w.w).join(' ')}`);
