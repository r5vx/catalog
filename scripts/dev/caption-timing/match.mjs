// How late live captions are: caption words (cc.mjs, each at the time it arrived) matched by
// three-word runs to Whisper's words (hear.mjs). Shift: caption clock minus sound clock (s).
// node match2.mjs <caps.json> <heard.json> <shift>
import fs from 'node:fs';
const [capsFile, heardFile, shiftArg] = process.argv.slice(2);
const shift = Number(shiftArg ?? 0);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
const caps = JSON.parse(fs.readFileSync(capsFile, 'utf8')).words.map((x) => ({ w: norm(x.w), at: x.at + shift })).filter((x) => x.w);
const heard = JSON.parse(fs.readFileSync(heardFile, 'utf8')).map((x) => ({ w: norm(x.w), at: x.at })).filter((x) => x.w && x.at != null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
const lags = [];
for (let i = 0; i + 2 < caps.length; i++) {
	const run = caps.slice(i, i + 3).map((x) => x.w);
	if (run.every((w) => w.length <= 3)) continue;
	const t = caps[i + 2].at; // when the run was all on screen
	const hits = [];
	for (let j = 0; j + 2 < heard.length; j++) {
		if (heard[j + 2].at < t - 20 || heard[j + 2].at > t + 3) continue;
		if (heard[j].w === run[0] && heard[j + 1].w === run[1] && heard[j + 2].w === run[2]) hits.push(t - heard[j + 2].at);
	}
	if (hits.length === 1) lags.push({ t, lag: hits[0] });
}
const all = lags.map((l) => l.lag);
console.log(`caption words ${caps.length}, words heard ${heard.length}, three-word matches ${lags.length}`);
console.log(`captions late by: median ${median(all).toFixed(2)} s (middle half ${q(all, 0.25).toFixed(2)} to ${q(all, 0.75).toFixed(2)} s, 10–90% ${q(all, 0.1).toFixed(2)} to ${q(all, 0.9).toFixed(2)})`);
for (let m = 0; m < 11; m++) {
	const these = lags.filter((l) => l.t >= m * 60 && l.t < (m + 1) * 60).map((l) => l.lag);
	console.log(`  minute ${String(m + 1).padStart(2)}: ${String(these.length).padStart(3)} matches` + (these.length ? `, median ${median(these).toFixed(2)} s (${q(these, 0.25).toFixed(2)} to ${q(these, 0.75).toFixed(2)})` : ''));
}
// What a 60-second window would have said, sliding every 15 s: how much a live estimate moves.
const est = [];
for (let s = 0; s + 60 <= 640; s += 15) { const w = lags.filter((l) => l.t >= s && l.t < s + 60).map((l) => l.lag); if (w.length >= 8) est.push(median(w)); }
console.log(`one-minute estimates (${est.length}): ${est.map((e) => e.toFixed(1)).join(' ')}`);
