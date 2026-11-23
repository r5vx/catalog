// node scripts/dev/youtube-wall-test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/lib/server/youtubeWall.ts', 'utf8')
	.replace(/^import .*;\n/gm, '').replace(/export /g, '');
const code = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const url = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const pictures = (batch, count = 12) => Array.from({ length: count }, (_, i) => ({ id: `video${batch}_${i}` }));

function fixture(thumbs = [], failWrite = false) {
	let now = 100_000_000;
	let saved = JSON.stringify({ at: 1, thumbs });
	let writes = 0;
	const searches = [];
	const wall = new Function('readSettings', 'updateSettings', 'searchYouTube', 'Date',
		code + '\nreturn { cachedYouTubeWall, youtubeWall };')(
		() => ({ youtubeWall: saved }),
		(patch) => {
			if (failWrite) throw new Error('disk full');
			saved = patch.youtubeWall;
			writes++;
		},
		() => new Promise((resolve, reject) => searches.push({ resolve, reject })),
		{ now: () => now }
	);
	return { ...wall, searches, advance: (ms) => { now += ms; },
		saved: () => JSON.parse(saved), writes: () => writes };
}

const original = Array.from({ length: 72 }, (_, i) => url(`saved_${i}`));
const partial = fixture(original);
assert.deepEqual(await partial.youtubeWall(), original);
assert.equal(partial.searches.length, 6);
partial.searches[0].resolve(pictures('partial'));
partial.searches[1].reject(new Error('offline'));
partial.searches.slice(2).forEach((search) => search.resolve([]));
await tick();
assert.deepEqual(partial.cachedYouTubeWall(), original);
assert.deepEqual(partial.saved().thumbs, original);
assert.equal(partial.writes(), 0);
console.log('PASS partial failure: saved and displayed 72 pictures retained; no writes');

partial.advance(61_000);
for (let i = 0; i < 5; i++) assert.deepEqual(await partial.youtubeWall(), original);
assert.equal(partial.searches.length, 6);
partial.advance(15 * 60_000 - 61_000 - 1);
await partial.youtubeWall();
assert.equal(partial.searches.length, 6);
console.log('PASS repeated visits: no new searches at 61 seconds or just before 15 minutes');

partial.advance(1);
await partial.youtubeWall();
assert.equal(partial.searches.length, 12);
for (let i = 0; i < 6; i++) partial.searches[6 + i].resolve(pictures(`retry${i}`));
await tick();
assert.equal(partial.saved().thumbs.length, 72);
assert.ok(partial.saved().thumbs.every((thumb) => thumb.includes('retry')));
assert.equal(partial.writes(), 1);
await partial.youtubeWall();
assert.equal(partial.searches.length, 12);
console.log('PASS retry at 15 minutes: six new searches; full success saves 72 new pictures');

const empty = fixture();
const emptyReply = empty.youtubeWall();
empty.searches.forEach((search) => search.resolve([]));
assert.deepEqual(await emptyReply, []);
await empty.youtubeWall();
assert.equal(empty.searches.length, 6);
console.log('PASS empty results: empty wall returned, repeated visit respects backoff');

const errors = fixture(original, true);
await errors.youtubeWall();
errors.searches.forEach((search, i) => search.resolve(pictures(`error${i}`)));
await tick();
assert.equal(errors.cachedYouTubeWall().length, 72);
assert.ok(errors.cachedYouTubeWall().every((thumb) => thumb.includes('error')));
assert.deepEqual(errors.saved().thumbs, original);
console.log('PASS failed persistence: refreshed pictures stay in memory; saved wall remains intact');
