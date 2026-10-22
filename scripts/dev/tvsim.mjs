// Plays a relayed playlist the way a TV does: one piece after another through the relay,
// from a point not yet loaded, timing each against how long it plays. 20x+ is healthy.
//
//   node scripts/dev/tvsim.mjs http://localhost:5199 "<playlist: /api/watch/relay?u=… from /api/watch/stream>" <start seconds> <pieces>
const [base, master, startAt = '300', count = '15'] = process.argv.slice(2);
const abs = (u, from) => new URL(u, from).href;
const get = async (u) => {
	const r = await fetch(u);
	if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 120)}`);
	return r;
};
const relay = (u) => `${base}/api/watch/relay?u=${encodeURIComponent(u)}`;
const m = (await (await get(master.startsWith('http://localhost') ? master : relay(master))).text()).split('\n');
let best = null;
let bw = -1;
let res = '';
for (let i = 0; i < m.length; i++) {
	if (!m[i].startsWith('#EXT-X-STREAM-INF')) continue;
	const n = Number(/BANDWIDTH=(\d+)/.exec(m[i])?.[1] ?? 0);
	if (n > bw) {
		bw = n;
		res = /RESOLUTION=([^,]*)/.exec(m[i])?.[1] ?? '';
		best = m.slice(i + 1).find((l) => l && !l.startsWith('#'));
	}
}
console.log(`variant ${res} ${Math.round(bw / 1000)} kbps`);
const media = best ? (await (await get(abs(best, base + '/api/watch/'))).text()).split('\n') : m;
const pieces = [];
for (let i = 0; i < media.length; i++) {
	if (media[i].startsWith('#EXTINF:')) {
		pieces.push({ dur: parseFloat(media[i].slice(8)), url: abs(media.slice(i + 1).find((l) => l && !l.startsWith('#')), base + '/api/watch/') });
	}
}
let t = 0;
const first = pieces.findIndex((p) => (t += p.dur) >= Number(startAt));
console.log(`${pieces.length} pieces, starting at #${first} (${startAt}s)`);
let played = 0;
let took = 0;
let slowest = 0;
for (const p of pieces.slice(first, first + Number(count))) {
	const s = performance.now();
	const b = (await (await get(p.url)).arrayBuffer()).byteLength;
	const ms = performance.now() - s;
	played += p.dur;
	took += ms / 1000;
	slowest = Math.max(slowest, ms / 1000);
	console.log(`${p.dur.toFixed(1)}s piece  ${(b / 1e6).toFixed(1)} MB  ${(ms / 1000).toFixed(2)}s  ${((b * 8) / (ms / 1000) / 1e6).toFixed(0)} Mbps  ${(p.dur / (ms / 1000)).toFixed(1)}x`);
}
console.log(`total: ${played.toFixed(0)}s of video in ${took.toFixed(1)}s = ${(played / took).toFixed(1)}x faster than it plays; slowest piece ${slowest.toFixed(1)}s`);
