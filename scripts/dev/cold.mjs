// Times whole long pieces (not parts) at far points: how long until the first byte, and the whole.
// Tells a slow site from a slow relay.
//
//   node scripts/dev/cold.mjs http://localhost:5199 "<relay playlist path>" 400 900 2000
const [base, list, ...at] = process.argv.slice(2);
const text = await (await fetch(base + list)).text();
const rows = text.split('\n');
const seen = []; let t = 0;
for (let i = 0; i < rows.length; i++) if (rows[i].startsWith('#EXTINF:')) {
  const u = new URL(rows.slice(i + 1).find((l) => l && !l.startsWith('#')), base + '/api/watch/');
  const piece = u.searchParams.get('u');
  if (!seen.length || seen.at(-1).piece !== piece) seen.push({ piece, at: t });
  t += parseFloat(rows[i].slice(8));
}
console.log(`${seen.length} whole pieces`);
for (const want of at.map(Number)) {
  const p = seen.find((s, i) => (seen[i + 1]?.at ?? 1e9) > want);
  const s = performance.now();
  const r = await fetch(`${base}/api/watch/relay?u=${encodeURIComponent(p.piece)}&whole=1`);
  const reader = r.body.getReader(); let first = 0, bytes = 0;
  for (let c = await reader.read(); !c.done; c = await reader.read()) { if (!first) first = performance.now() - s; bytes += c.value.length; }
  const ms = performance.now() - s;
  console.log(`at ${p.at.toFixed(0)}s: ${r.status} first byte ${(first / 1000).toFixed(1)}s, ${(bytes / 1e6).toFixed(1)} MB in ${(ms / 1000).toFixed(1)}s = ${((bytes * 8) / (ms / 1000) / 1e6).toFixed(0)} Mbps`);
}
