/**
 * Times the Watch check per source (Showbox, 7Movies, Aniwave, Movy): forgets the kept answers
 * in the test copy, then polls /api/watch/available?now=1 the way the page does.
 *
 *   node scripts/dev/availtime.mjs "<copy of library.db>" http://localhost:5199 "movie|Primetime|2026" "tv|Bleach|2004"
 *
 * Movy needs the desktop app (electron . on port 5299); on the dev server it says no at once.
 */
import { DatabaseSync } from 'node:sqlite';
import { notLive } from './notLive.mjs';

const [db, base, ...titles] = process.argv.slice(2);
new DatabaseSync(notLive(db)).exec("delete from watch_order_cache where key like 'available|%'");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const t of titles) {
	const [type, title, year] = t.split('|');
	const q = new URLSearchParams({ title, type, year, now: '1' });
	const start = Date.now();
	const done = {};
	let answer = null;
	let answeredAt = null;
	while (Date.now() - start < 90_000) {
		const r = await (await fetch(`${base}/api/watch/available?${q}`)).json();
		const s = (Date.now() - start) / 1000;
		for (const src of r.sources) if (src.state !== 'checking' && !(src.name in done)) done[src.name] = `${src.state} ${s.toFixed(1)}s`;
		if (r.available !== null && answeredAt === null) {
			answer = r.available;
			answeredAt = s;
		}
		if (r.sources.length && r.sources.every((x) => x.state !== 'checking')) break;
		await wait(250);
	}
	console.log(`${title} (${type}): answer ${answer} at ${answeredAt?.toFixed(1)}s | ${Object.entries(done).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
