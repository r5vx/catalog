// How short a listen still finds the caption lag: for each window length, many start points; only
// the sound heard in [start, start+L] and captions that arrived by start+L+wait are used.
import fs from 'node:fs';
const shift = 0.066, truth = 5.28, wait = 6;
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
const caps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).words.map((x) => ({ w: norm(x.w), at: x.at + shift })).filter((x) => x.w);
const heardAll = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).map((x) => ({ w: norm(x.w), at: x.at })).filter((x) => x.w && x.at != null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function lagIn(start, L) {
	const heard = heardAll.filter((h) => h.at >= start && h.at < start + L);
	const cap = caps.filter((c) => c.at >= start && c.at < start + L + wait);
	const lags = [];
	for (let i = 0; i + 2 < cap.length; i++) {
		const run = cap.slice(i, i + 3).map((x) => x.w);
		if (run.every((w) => w.length <= 3)) continue;
		const t = cap[i + 2].at, hits = [];
		for (let j = 0; j + 2 < heard.length; j++) {
			if (heard[j + 2].at < t - 20 || heard[j + 2].at > t + 3) continue;
			if (heard[j].w === run[0] && heard[j + 1].w === run[1] && heard[j + 2].w === run[2]) hits.push(t - heard[j + 2].at);
		}
		if (hits.length === 1) lags.push(hits[0]);
	}
	return lags;
}
for (const L of [5, 8, 10, 15, 20, 30, 60]) {
	let tries = 0, found = 0, close = 0, near = 0, matches = 0;
	for (let s = 60; s + L + wait < 630; s += 3) {
		tries++;
		const lags = lagIn(s, L);
		// An answer only when at least 3 runs agree (within 0.5 s of their median).
		if (lags.length < 3) continue;
		const m = median(lags);
		if (lags.filter((x) => Math.abs(x - m) < 0.5).length < 3) continue;
		found++; matches += lags.length;
		if (Math.abs(m - truth) <= 0.3) close++;
		if (Math.abs(m - truth) <= 0.6) near++;
	}
	console.log(`listen ${String(L).padStart(2)} s: answer in ${(100 * found / tries).toFixed(0)}% of tries (avg ${(matches / Math.max(1, found)).toFixed(1)} matches); of the answers ${(100 * close / Math.max(1, found)).toFixed(0)}% within 0.3 s, ${(100 * near / Math.max(1, found)).toFixed(0)}% within 0.6 s`);
}
