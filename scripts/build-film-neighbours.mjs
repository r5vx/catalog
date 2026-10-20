/**
 * Builds data/film-neighbours.bin: for each film, the films most like it (TMDB ids), for
 * "More like this" (src/lib/server/recommendations.ts).
 *
 * From MovieLens (grouplens.org, ml-latest: 33 million ratings by 330,000 people, and the "tag
 * genome", which scores ~16,000 films 0–1 on 1,128 qualities like "space" or "thought-provoking").
 * Its licence allows non-commercial use and passing on a transformation of it under the same
 * terms (data/README.md). Two things, blended:
 *   - taste: the people who loved a film (4 stars or more) — which other films did they love,
 *     more than everyone does? That finds what a film *feels* like even for obscure ones (The
 *     Man from Earth: Predestination, Cloud Atlas), where TMDB's topic tags found Ice Age;
 *   - feel: how alike two films' genome scores are, so a famous film's neighbours aren't just
 *     other famous films (Interstellar's taste list alone had Django Unchained).
 *
 *   node scripts/build-film-neighbours.mjs <folder with ml-latest's csv files>
 *
 * Takes a few minutes and a couple of GB of memory. Re-run when MovieLens publishes newer data.
 */
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Give the folder with ml-latest (ratings.csv, links.csv, genome-scores.csv)');

const LOVED = 4; // stars
const MIN_FANS = 8; // films loved by fewer people than this get no list of their own
const PER_PERSON = 250; // each person's loved films counted at most (people who love thousands)
const CANDIDATES = 200;
const KEEP = 30;

const t0 = Date.now();
const said = (what) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  ${what}`);

async function* lines(file) {
	const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
	let first = true;
	for await (const line of rl) {
		if (first) {
			first = false;
			continue;
		}
		if (line) yield line;
	}
}

/* ---------- MovieLens ids → TMDB ids */
const tmdbOf = new Map();
for await (const line of lines('links.csv')) {
	const [movie, , tmdb] = line.split(',');
	if (tmdb) tmdbOf.set(Number(movie), Number(tmdb));
}
said(`${tmdbOf.size} films with a TMDB id`);

/* ---------- who loved what */
const index = new Map(); // movieId → dense index
const movieIds = [];
let users = new Int32Array(1 << 25);
let films = new Int32Array(1 << 25);
let n = 0;
for await (const line of lines('ratings.csv')) {
	const a = line.indexOf(',');
	const b = line.indexOf(',', a + 1);
	const c = line.indexOf(',', b + 1);
	if (Number(line.slice(b + 1, c)) < LOVED) continue;
	const movie = Number(line.slice(a + 1, b));
	if (!tmdbOf.has(movie)) continue;
	let i = index.get(movie);
	if (i === undefined) {
		i = movieIds.length;
		index.set(movie, i);
		movieIds.push(movie);
	}
	if (n === users.length) {
		const grow = (old) => {
			const bigger = new Int32Array(old.length * 2);
			bigger.set(old);
			return bigger;
		};
		users = grow(users);
		films = grow(films);
	}
	users[n] = Number(line.slice(0, a));
	films[n] = i;
	n++;
}
const M = movieIds.length;
said(`${n} loved ratings, ${M} films`);

// Each person's loved films (ratings.csv is sorted by person), at most PER_PERSON, spread evenly.
const personStart = [];
for (let k = 0; k < n; k++) if (k === 0 || users[k] !== users[k - 1]) personStart.push(k);
personStart.push(n);
const P = personStart.length - 1;
const keptStart = new Int32Array(P + 1);
const kept = [];
for (let p = 0; p < P; p++) {
	keptStart[p] = kept.length;
	const from = personStart[p];
	const count = personStart[p + 1] - from;
	const step = count > PER_PERSON ? count / PER_PERSON : 1;
	for (let x = 0; x < count && kept.length - keptStart[p] < PER_PERSON; x += step) kept.push(films[from + Math.floor(x)]);
}
keptStart[P] = kept.length;
const likedBy = new Int32Array(kept);
users = films = null;

// Who loved each film.
const fans = new Int32Array(M);
for (const f of likedBy) fans[f]++;
const fanStart = new Int32Array(M + 1);
for (let f = 0; f < M; f++) fanStart[f + 1] = fanStart[f] + fans[f];
const fanList = new Int32Array(likedBy.length);
const fill = fanStart.slice(0, M);
for (let p = 0; p < P; p++) for (let k = keptStart[p]; k < keptStart[p + 1]; k++) fanList[fill[likedBy[k]]++] = p;
said(`${P} people`);

/* ---------- the genome: each film's qualities, as one normalised vector */
const TAGS = 1128;
const genome = new Map(); // dense index → Float32Array
{
	let current = -1;
	let vector = null;
	for await (const line of lines('genome-scores.csv')) {
		const [movie, tag, relevance] = line.split(',');
		const m = Number(movie);
		if (m !== current) {
			if (vector && index.has(current)) genome.set(index.get(current), vector);
			current = m;
			vector = new Float32Array(TAGS);
		}
		vector[Number(tag) - 1] = Number(relevance);
	}
	if (vector && index.has(current)) genome.set(index.get(current), vector);
	for (const v of genome.values()) {
		// Centred on the average film, so "everything is a bit 'good'" doesn't make all alike.
		let norm = 0;
		for (let t = 0; t < TAGS; t++) norm += v[t] * v[t];
		norm = Math.sqrt(norm) || 1;
		for (let t = 0; t < TAGS; t++) v[t] /= norm;
	}
	said(`${genome.size} films with genome scores`);
}
const average = new Float32Array(TAGS);
for (const v of genome.values()) for (let t = 0; t < TAGS; t++) average[t] += v[t] / genome.size;
const centred = new Map();
for (const [f, v] of genome) {
	const c = new Float32Array(TAGS);
	let norm = 0;
	for (let t = 0; t < TAGS; t++) {
		c[t] = v[t] - average[t];
		norm += c[t] * c[t];
	}
	norm = Math.sqrt(norm) || 1;
	for (let t = 0; t < TAGS; t++) c[t] /= norm;
	centred.set(f, c);
}

/* ---------- each film's neighbours */
const together = new Int32Array(M);
const touched = new Int32Array(M);
const lists = [];
let done = 0;
for (let target = 0; target < M; target++) {
	const a = fans[target];
	if (a < MIN_FANS) continue;
	let t = 0;
	for (let k = fanStart[target]; k < fanStart[target + 1]; k++) {
		const p = fanList[k];
		for (let x = keptStart[p]; x < keptStart[p + 1]; x++) {
			const f = likedBy[x];
			if (together[f] === 0) touched[t++] = f;
			together[f]++;
		}
	}
	const scored = [];
	for (let x = 0; x < t; x++) {
		const f = touched[x];
		const co = together[f];
		together[f] = 0;
		if (f === target || co < 3 || fans[f] < MIN_FANS) continue;
		// Loved together, more than either's fame explains (the very famous count a little less),
		// and only as sure as the number of people behind it.
		scored.push([f, (co / (Math.sqrt(a) * Math.pow(fans[f], 0.6))) * (co / (co + 8))]);
	}
	scored.sort((x, y) => y[1] - x[1]);
	const top = scored.slice(0, CANDIDATES);
	if (!top.length) continue;
	const best = top[0][1];
	const mine = centred.get(target);
	const blended = top.map(([f, s]) => {
		let feel = 0;
		const theirs = mine && centred.get(f);
		if (theirs) for (let q = 0; q < TAGS; q++) feel += mine[q] * theirs[q];
		// Taste first; feel, where both have genome scores, keeps the list on-theme.
		const score = theirs ? 0.55 * (s / best) + 0.45 * Math.max(0, feel) : 0.8 * (s / best);
		return [f, score];
	});
	blended.sort((x, y) => y[1] - x[1]);
	lists.push([tmdbOf.get(movieIds[target]), blended.slice(0, KEEP).map(([f, s]) => [tmdbOf.get(movieIds[f]), Math.round(Math.min(1, s) * 255)])]);
	if (++done % 5000 === 0) said(`${done} films done`);
}
said(`${lists.length} films with neighbours`);

/* ---------- written out: 'CFN1', count, [tmdb id, offset] sorted, then [n, (tmdb id, score) × n] */
lists.sort((x, y) => x[0] - y[0]);
const unique = lists.filter((l, i) => i === 0 || l[0] !== lists[i - 1][0]);
const recordBytes = unique.reduce((sum, [, ns]) => sum + 1 + ns.length * 5, 0);
const out = Buffer.alloc(8 + unique.length * 8 + recordBytes);
out.write('CFN1', 0, 'latin1');
out.writeUInt32LE(unique.length, 4);
let at = 8 + unique.length * 8;
unique.forEach(([id, ns], i) => {
	out.writeUInt32LE(id, 8 + i * 8);
	out.writeUInt32LE(at, 12 + i * 8);
	out.writeUInt8(ns.length, at++);
	for (const [nid, score] of ns) {
		out.writeUInt32LE(nid, at);
		out.writeUInt8(score, at + 4);
		at += 5;
	}
});
mkdirSync('data', { recursive: true });
writeFileSync('data/film-neighbours.bin', out);
said(`data/film-neighbours.bin: ${(out.length / 1e6).toFixed(1)} MB`);
