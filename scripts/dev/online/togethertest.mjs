// Watching together's step-keeping (src/lib/watchTogether.svelte.ts), tried with two pretend houses
// and a pretend room: house B's video takes 3 s to land every move, as a slow source does.
//   node scripts/dev/online/togethertest.mjs        (from the project folder; takes about 40 s)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';

const source = readFileSync('src/lib/watchTogether.svelte.ts', 'utf8');
const plain = ts.transpileModule(source, { compilerOptions: { target: 'esnext', module: 'esnext', verbatimModuleSyntax: true } }).outputText;
const code = compileModule(plain, { generate: 'server', filename: 'watchTogether.svelte.js' }).js.code
	.replace(/import .* from ['"]\$lib\/chat.svelte['"];?/, 'const takeChat = () => {}; const chat = { known: false, last: 0 }; const chatRoomCheck = () => {};');
// Inside the project, so the module finds svelte.
const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.together-'));
const load = async (who) => {
	const file = join(dir, `${who}.mjs`);
	writeFileSync(file, code.replaceAll('fetch(', `globalThis.fetch${who}(`).replaceAll('localStorage', `globalThis.store${who}`));
	return import(pathToFileURL(file).href);
};

// The pretend room, answering as cloud/src/worker.js does.
const room = { code: 'ABC234', host: 'A', state: null, rev: 0, members: new Set(), puts: [] };
const answer = (who) => ({ code: room.code, host: room.host === who, state: room.state, rev: room.rev, now: Date.now(), people: [...room.members].map((m) => ({ id: m, name: m, avatar: 0, me: m === who })) });
const server = (who) => async (path, options = {}) => {
	if (room.fail) return { ok: false, json: async () => ({ error: 'Offline' }) };
	const route = new URL('http://x' + path).pathname;
	const body = options.body ? JSON.parse(options.body) : null;
	let data;
	if (route.endsWith('/rooms') || route.endsWith('/join')) { room.members.add(who); if (route.endsWith('/rooms')) { room.state = { ...body, at: Date.now(), by: who }; room.rev++; } data = answer(who); }
	else if (route.endsWith('/state')) { room.state = { ...body, at: Date.now(), by: who }; room.rev++; room.puts.push({ who, position: body.position, playing: body.playing, episode: body.episode, at: Date.now() }); data = answer(who); }
	else if (route.endsWith('/leave')) { room.members.delete(who); data = { ok: true }; }
	else {
		const query = new URL('http://x' + path).searchParams;
		const people = [...room.members].sort().join(',') === (query.get('people') ?? '').split(',').sort().join(',') ? {} : { people: answer(who).people };
		data = Number(query.get('rev')) === room.rev ? { same: true, rev: room.rev, now: Date.now(), ...people } : answer(who);
	}
	return { ok: true, json: async () => data };
};
const store = () => { const kept = {}; return { getItem: (k) => kept[k] ?? null, setItem: (k, v) => (kept[k] = v), removeItem: (k) => delete kept[k] }; };

/** A pretend video: plays on with the clock; a move lands `seekTakes` ms after it's asked. */
class Video extends EventTarget {
	constructor(seekTakes) { super(); this.seekTakes = seekTakes; this.base = 0; this.since = 0; this.paused = true; this.ended = false; this.seeking = false; this.duration = 3000; this.readyState = 4; this.seeks = 0; }
	get currentTime() { return this.paused || this.seeking ? this.base : this.base + (Date.now() - this.since) / 1000; }
	set currentTime(to) { this.seeks++; this.base = to; this.seeking = true; const mine = this.seeks; setTimeout(() => { if (mine !== this.seeks) return; this.seeking = false; this.since = Date.now(); this.dispatchEvent(new Event('seeked')); }, this.seekTakes); }
	async play() { if (!this.paused) return; this.base = this.currentTime; this.paused = false; this.since = Date.now(); this.dispatchEvent(new Event('play')); }
	pause() { if (this.paused) return; this.base = this.currentTime; this.paused = true; this.dispatchEvent(new Event('pause')); }
}

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const who of ['A', 'B']) { globalThis[`fetch${who}`] = server(who); globalThis[`store${who}`] = store(); }
const A = await load('A');
const B = await load('B');
const a = new Video(200);
const b = new Video(3000);
let aEpisode = 2, bEpisode = 2;
const followed = [];
const notes = [];
const aNotes = [];
const playing = (episode) => () => ({ title: 'Test Show', type: 'tv', year: '2020', season: 1, episode: episode() });

// A is watching at 100 s and starts a room; B joins with the same episode open at the start.
a.base = 100; await a.play();
let detachA = A.attachTogether(a, playing(() => aEpisode), (text) => aNotes.push(text));
await A.startRoom();
await B.joinRoom('abc234');
let detachB = B.attachTogether(b, playing(() => bEpisode), (text) => notes.push(text), (state) => followed.push(`${state.season}x${state.episode}`));
check('joining does not announce the initial member list as new arrivals', B.together.notice === '');
check('B starts playing with the room', !b.paused);
await wait(12000);
const apart = () => Math.abs(a.currentTime - b.currentTime);
check("B's slow move was not told to the room as news", room.puts.every((p) => p.who !== 'B'), JSON.stringify(room.puts));
check('A was never moved', a.seeks === 0, `${a.seeks} moves`);
check('B is in step after its slow moves (aimed ahead)', apart() < 1.5, `${apart().toFixed(2)} s apart, ${b.seeks} moves`);
const movesSoFar = b.seeks;
await wait(11000);
check('and stays there without moving again', b.seeks === movesSoFar && apart() < 1.5, `${apart().toFixed(2)} s apart`);

// A pauses, then skips ahead and plays.
a.pause(); await wait(2500);
check("A's pause reached B", b.paused && notes.includes('A paused'), notes.join(' | '));
a.currentTime = 500; await wait(600); await a.play(); await wait(9000);
check("A's skip and play reached B", !b.paused && apart() < 1.5 && b.currentTime > 495, `A ${a.currentTime.toFixed(1)}, B ${b.currentTime.toFixed(1)}`);
check('B still told the room nothing', room.puts.every((p) => p.who !== 'B'));

// B pauses itself: that is news, and A pauses.
b.pause(); await wait(2500);
check("B's own pause reached A", a.paused && room.puts.some((p) => p.who === 'B' && p.playing === false), JSON.stringify({ paused: a.paused, puts: room.puts }));
await b.play(); await wait(2500);
check("B's own play reached A", !a.paused);

// A goes on to the next episode: B is asked to follow.
detachA(); aEpisode = 3; a.base = 0; a.since = Date.now();
detachA = A.attachTogether(a, playing(() => aEpisode), (text) => aNotes.push(text));
await wait(2500);
check('B was asked to follow to the next episode', followed.join() === '1x3', followed.join());
check('B was not moved inside the old episode meanwhile', room.state.episode === 3);

detachB(); bEpisode = 3; b.base = a.currentTime; b.since = Date.now();
detachB = B.attachTogether(b, playing(() => bEpisode), (text) => notes.push(text));
a.pause(); await wait(2500);
const pausedAt = room.state.position;
check('a paused room requests paused loads in both houses', A.roomPaused(playing(() => aEpisode)()) && B.roomPaused(playing(() => bEpisode)()));
check('another episode does not inherit this room pause', !A.roomPaused({ ...playing(() => aEpisode)(), episode: 99 }));
for (const [client, video, episode] of [[A, a, aEpisode], [B, b, bEpisode]]) {
	const stayPaused = client.roomPaused(playing(() => episode)());
	const at = video.currentTime;
	video.readyState = 0; video.base = 0;
	video.readyState = 4; video.currentTime = at;
	if (!stayPaused) await video.play();
}
await wait(4000);
check('source reloads while paused leave everyone paused at the same position', a.paused && b.paused && !room.state.playing && Math.abs(a.currentTime - pausedAt) < 0.1 && Math.abs(b.currentTime - pausedAt) < 0.1, JSON.stringify({ a: a.currentTime, b: b.currentTime, pausedAt, aPaused: a.paused, bPaused: b.paused, state: room.state }));
await a.play(); await wait(2500);
check('a playing room still resumes loads', !A.roomPaused(playing(() => aEpisode)()) && !B.roomPaused(playing(() => bEpisode)()) && !a.paused && !b.paused);

const notice = A.together.notice;
room.fail = true; await wait(2000);
check('a failed room request does not announce departures', A.together.notice === notice && A.together.people.length === 2, JSON.stringify({ notice, together: A.together }));
room.fail = false;
B.leaveRoom(); await wait(2500);
check('explicit leave reaches the player and member-list notice without a playback revision', aNotes.includes('B left') && A.together.notice === 'B left' && A.together.people.length === 1, JSON.stringify({ aNotes, together: A.together }));
const leftCount = aNotes.filter((text) => text === 'B left').length;
await B.joinRoom('ABC234'); await wait(8500);
check('joining is mirrored in player and member-list notices', aNotes.includes('B joined') && A.together.notice === 'B joined');
room.members.delete('B'); await wait(2500);
check('expired or closed-app members are announced once', aNotes.filter((text) => text === 'B left').length === leftCount + 1 && A.together.people.length === 1);
await wait(8500);
check('an unchanged empty-of-others list does not repeat departures', aNotes.filter((text) => text === 'B left').length === leftCount + 1);
A.leaveRoom();
check('leaving clears the local notice and paused-load state', A.together.notice === '' && !A.roomPaused(playing(() => aEpisode)()));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
