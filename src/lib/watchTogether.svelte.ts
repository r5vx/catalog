/**
 * Watching together: two (or more) houses watching the same thing in step. Play, pause and skips
 * in one house happen in the others; each house plays from its own computer and its own copy, so
 * no video goes between them. Only "what's playing, where, and whether it's paused" does, through
 * the meeting point (src/lib/server/online.ts; the `cloud/` folder).
 *
 * A room has a six-letter code. Whoever starts it gives the code to the others (Friends → Watch
 * together). The room says what's playing; someone in the room who opens that same film or episode
 * is kept in step with it. Opening something else leaves them out of step until they open it.
 *
 * Kept in step by asking the meeting point every second and a half (every eight seconds while
 * nobody else is in the room): the room's state carries the server's clock at the moment it was
 * set, so each house works out where "now" is.
 *
 * Watching along: with "Let friends watch along" on (the library's Friends), the player starts a
 * room by itself when something plays, and friends see a Watch along button beside what you're
 * watching, which puts them in that room.
 *
 * Paused by the player, not the person (changing to a sharper copy, a reload): the room is told
 * why (`waiting`), so the others see "Ann is switching to the sharpest copy", not "Ann paused"
 * (owner, 2026-11-15: "it said 'alex paused this'").
 *
 * The room's chat and any whispers ride along with each look at the room (src/lib/chat.svelte.ts).
 */
import { takeChat, chat, chatRoomCheck } from '$lib/chat.svelte';

export type RoomState = {
	title: string;
	type: 'tv' | 'movie';
	year: string;
	season: number;
	episode: number;
	playing: boolean;
	position: number;
	/** The server's clock when this was said. */
	at: number;
	/** Who said it. */
	by: string;
	/** Paused by their player (loading a copy, say), not by them: why, in a few words. '' otherwise. */
	waiting?: string;
};

/** Someone in the room: their name and picture (Settings → Online; `avatar` 0 means none). */
export type RoomPerson = { id: string; name: string; avatar: number; me: boolean };
type RoomAnswer = { code: string; host: boolean; state: RoomState; rev: number; now: number; people: RoomPerson[]; same?: boolean; error?: string; chat?: Parameters<typeof takeChat>[0] };
export type Playing = {
	title: string;
	type: 'tv' | 'movie';
	year: string;
	season: number;
	episode: number;
	/**
	 * The name it was asked for, when its source calls it something else: Watch along opens the
	 * friend's name, and this computer's source may spell it its own way (2026-11-23: watch along
	 * never jumped to the friend's place).
	 */
	asked?: string;
};

/** The room this screen is in ('' when none), for the pages. */
export const together = $state({
	code: '',
	host: false,
	people: [] as RoomPerson[],
	state: null as RoomState | null,
	problem: '',
	notice: '',
	/**
	 * Watching along with this friend (their name): this screen follows the room and never moves
	 * it, like listening along on Spotify. '' in a room joined by its code, where everyone's play,
	 * pause and skips count (a group session).
	 */
	following: '',
	/**
	 * Someone else in the room started something this screen isn't playing: offered here ("Ann
	 * started Inception: Join?", lib/RoomOffer.svelte) until it's answered or something else starts.
	 */
	offer: null as RoomState | null
});

// (In a room, messages come with the room's looks: the chat's own looks wait.)
chatRoomCheck(() => Boolean(together.code));

const KEPT = 'catalog:room';
const KEPT_FOLLOWING = 'catalog:room-following';
const ASK_EVERY = 1500;
/** While nobody else is in the room there's nobody to keep in step with: asked this seldom. */
const ASK_EVERY_ALONE = 8000;
/** Further apart than this and the video jumps to where the room is. */
const OUT_OF_STEP = 1.5;
/** The same, for the look every few seconds while nothing changed: a little drift is left alone. */
const DRIFTED = 3;

let rev = 0;
/** How far the server's clock is ahead of this screen's. */
let clockAhead = 0;
let roomChange = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The room was left by hand: the player doesn't start another by itself until one is started or joined again. */
let leftByHand = false;
/** The room is one the player started by itself (for watching along), not one started or joined by hand. */
let startedByPlayer = false;
let attached: { video: HTMLVideoElement; playing: () => Playing; note: (text: string) => void; follow?: (state: RoomState) => void } | null = null;
/** Until when the video's own play and pause events are the room's doing, not the person's. */
let applyingUntil = 0;
/**
 * When the room last moved this video (0: it hasn't, or that move has landed). The "moved" event
 * that follows is the room's doing, however long the move took: told to the room as news, a slow
 * move here set the whole room back by the time it took, and the houses pulled each other
 * backwards in turn.
 */
let roomSeekAt = 0;
/** How long a move takes to land here, in seconds: the next one aims that far ahead. */
let seekTakes = 0;
/** Moves made one after another to catch the room up (a first slow one lands behind it). */
let chasing = 0;

async function ask<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
	const mine = roomChange;
	const code = together.code;
	try {
		const response = await fetch(`/api/online/c/${path}`, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const data = await response.json().catch(() => null);
		if (mine !== roomChange || code !== together.code) return null;
		if (!response.ok) {
			together.problem = data?.error ?? "The room couldn't be reached";
			return null;
		}
		together.problem = '';
		return data as T;
	} catch {
		if (mine !== roomChange || code !== together.code) return null;
		together.problem = "The room couldn't be reached";
		return null;
	}
}

/** My own name in the room (to tell my own doings from the others'). */
const myName = () => together.people.find((person) => person.me)?.name ?? '';

/**
 * The room's state changed to another film or episode: offered to this screen when someone else
 * started it and this screen isn't on it. `first`: the state as found on joining.
 */
function offerIfNew(before: RoomState | null, state: RoomState, first: boolean): void {
	if (!state?.title) return;
	const changed = !before || !before.title || before.title.toLowerCase() !== state.title.toLowerCase() || before.season !== state.season || before.episode !== state.episode;
	if (!changed) return;
	const here = attached?.playing();
	if (here && sameThing(here, state)) {
		together.offer = null;
		return;
	}
	// (The player follows a show's next episode by itself; only what the person isn't watching is asked.)
	if (here && here.type === 'tv' && state.type === 'tv' && sameTitle(here, state)) return;
	// Never what this person started themselves (owner, 2026-11-15: reopening Catalog rejoined the
	// room their own player had started earlier, and offered them their own film as "Alex started…").
	if (state.by && state.by === myName()) return;
	together.offer = state;
}

function updatePeople(people: RoomPerson[], first = false): void {
	if (!first) {
		const joined = people.filter((person) => !person.me && !together.people.some((known) => known.id === person.id));
		const left = together.people.filter((person) => !person.me && !people.some((known) => known.id === person.id));
		const notice = [...joined.map((person) => `${person.name} joined`), ...left.map((person) => `${person.name} left`)].join(' · ');
		if (notice) {
			together.notice = notice;
			attached?.note(notice);
		}
	} else together.notice = '';
	together.people = people;
}

function took(answer: RoomAnswer): void {
	rev = answer.rev;
	clockAhead = answer.now - Date.now();
	const first = together.code !== answer.code;
	together.code = answer.code;
	together.host = answer.host;
	updatePeople(answer.people, first);
	const before = together.state;
	together.state = answer.state;
	if (answer.chat) takeChat(answer.chat, true);
	offerIfNew(first ? null : before, answer.state, first);
	try {
		localStorage.setItem(KEPT, answer.code);
	} catch {}
	apply(before);
	if (!timer) lookLater();
}

/** The next look at the room: soon with company, seldom alone. */
function lookLater(): void {
	clearTimeout(timer);
	const alone = together.people.filter((person) => !person.me).length === 0;
	timer = setTimeout(async () => {
		await look();
		if (together.code) lookLater();
	}, alone ? ASK_EVERY_ALONE : ASK_EVERY);
}

/** A room started here; its code is in `together.code`. */
export async function startRoom(): Promise<boolean> {
	const mine = ++roomChange;
	leftByHand = false;
	startedByPlayer = false;
	const now = attached ? stateNow() : { title: '', type: 'movie', year: '', season: 0, episode: 0, playing: false, position: 0 };
	const answer = await ask<RoomAnswer>('rooms', 'POST', now);
	if (mine !== roomChange) return false;
	if (answer) took(answer);
	return Boolean(answer);
}

/** Into a room by its code (everyone controls it), or, with `following`, watching along with that friend (they control it). */
export async function joinRoom(code: string, following = ''): Promise<boolean> {
	const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (clean.length !== 6) {
		together.problem = 'A room code is six letters and digits';
		return false;
	}
	const mine = ++roomChange;
	const answer = await ask<RoomAnswer>(`rooms/${clean}/join?msg=`, 'POST', {});
	if (mine !== roomChange) return false;
	if (answer) {
		leftByHand = false;
		startedByPlayer = false;
		together.following = following;
		try {
			if (following) localStorage.setItem(KEPT_FOLLOWING, following);
			else localStorage.removeItem(KEPT_FOLLOWING);
		} catch {}
		took(answer);
		// (Someone is here now: looked at often from the start.)
		lookLater();
	}
	return Boolean(answer);
}

export function leaveRoom(byHand = true): void {
	roomChange++;
	const code = together.code;
	leftByHand = byHand;
	startedByPlayer = false;
	clearTimeout(timer);
	timer = undefined;
	together.code = '';
	together.state = null;
	together.people = [];
	together.notice = '';
	together.problem = '';
	together.following = '';
	together.offer = null;
	rev = 0;
	try {
		localStorage.removeItem(KEPT);
		localStorage.removeItem(KEPT_FOLLOWING);
	} catch {}
	if (code) void ask(`rooms/${code}/leave`, 'POST', {});
}

/** Back in the room this screen was in before the page was loaded again. */
export function rejoinKeptRoom(): void {
	if (together.code || typeof localStorage === 'undefined') return;
	let kept = '';
	let following = '';
	try {
		kept = localStorage.getItem(KEPT) ?? '';
		following = localStorage.getItem(KEPT_FOLLOWING) ?? '';
	} catch {}
	// (A room nobody else is in is left again: it was this screen's own, from watching earlier.)
	if (kept) {
		const joining = joinRoom(kept, following);
		const mine = roomChange;
		void joining.then((ok) => mine === roomChange && (!ok || !together.people.some((person) => !person.me)) && leaveRoom(false));
	}
}

/**
 * The player closed (let go after it was left, or replaced). A room it started by itself, with
 * nobody else in it, ends with it: it stayed open after the person stopped watching, so reopening
 * Catalog later found them "in a group" by themselves (owner, 2026-11-15).
 */
export function playerClosed(): void {
	if (!together.code || !startedByPlayer || together.people.some((person) => !person.me)) return;
	leaveRoom(false);
}

async function look(): Promise<void> {
	if (!together.code) return;
	const mine = roomChange;
	const code = together.code;
	// Who's here as this screen knows it: the room answers with everyone when that's changed, even
	// with nothing new playing (a host never saw who joined: only what's playing moves `rev`).
	const known = together.people.map((person) => person.id).join(',');
	// (`msg`: the room's chat and whispers after the newest one this screen has, ride along.)
	const answer = await ask<RoomAnswer>(`rooms/${code}?rev=${rev}&people=${encodeURIComponent(known)}&msg=${chat.known ? chat.last : ''}`);
	if (mine !== roomChange || code !== together.code) return;
	// The room ended (nobody in it for half a day), or this screen was never let in.
	if (!answer) {
		if (/No such room|Join the room/.test(together.problem)) leaveRoom();
		return;
	}
	if (answer.same) {
		clockAhead = answer.now - Date.now();
		if (answer.chat) takeChat(answer.chat, true);
		// Someone came or went: only the list changes, nothing is moved on the video.
		if (answer.people) updatePeople(answer.people);
		return;
	}
	took(answer);
}

/* ------------------------------------------------------------ watching along */

let alongAsked = 0;
let alongAnswer = false;

/** Whether friends may watch along with this computer (the switch in the library's Friends). Asked at most once a minute. */
async function alongAllowed(): Promise<boolean> {
	if (Date.now() - alongAsked < 60_000) return alongAnswer;
	alongAsked = Date.now();
	try {
		const status = await fetch('/api/online?light=1').then((r) => (r.ok ? r.json() : null));
		alongAnswer = Boolean(status?.connected && status.switches?.along);
	} catch {
		alongAnswer = false;
	}
	return alongAnswer;
}

/** The switch was just changed: ask again next time. */
export function alongChanged(): void {
	alongAsked = 0;
}

/**
 * The player has a film or an episode open. Friends are told which year's it is (the saved place
 * doesn't know) and, when watching along is allowed, the room to join: one is started by itself
 * when there's none.
 */
export async function nowPlaying(what: Playing): Promise<void> {
	if (!together.code && !leftByHand && (await alongAllowed()) && !together.code && (await startRoom())) startedByPlayer = true;
	try {
		await fetch('/api/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'watching', title: what.title, year: what.year, room: together.code }) });
	} catch {}
}

/** A name without capitals, punctuation or a year in brackets: "Spider-Man: Brand New Day" = "Spider-Man - Brand New Day". */
const plainName = (name: string) =>
	name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/&/g, 'and')
		.replace(/\((19|20)\d\d\)/g, '')
		.replace(/[^a-z0-9]+/g, '');
/** The same film or show, by its name here or the name it was asked for. */
const sameTitle = (here: Playing, room: { title: string }) =>
	[here.title, here.asked].some((name) => Boolean(name) && plainName(name!) === plainName(room.title));
const sameThing = (a: Playing, b: Playing) => sameTitle(a, b) && a.type === b.type && a.season === b.season && a.episode === b.episode;

export function roomPaused(what: Playing): boolean {
	const state = together.state;
	return Boolean(together.code && state?.title && sameThing(what, state) && !state.playing && !state.waiting);
}

/** Why the player itself has the video paused right now ('' when it hasn't): `holdRoom`. */
let holdReason = '';
let holdTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The player is about to pause the video itself (loading another copy, a reload): the room is told
 * why instead of "paused". Over when the video plays again, or after a minute at most.
 */
export function holdRoom(reason: string): void {
	holdReason = reason;
	clearTimeout(holdTimer);
	holdTimer = setTimeout(() => (holdReason = ''), 60_000);
}

function stateNow() {
	const { video, playing } = attached!;
	const on = !video.paused && !video.ended;
	if (on) holdReason = '';
	// (The name it was asked for stays here: the room is told the name its source gave.)
	const { asked: _asked, ...what } = playing();
	return { ...what, playing: on, position: video.currentTime, waiting: on ? '' : holdReason };
}

/** Where the room is right now, in seconds into the video. */
export function roomPosition(state: RoomState): number {
	return state.playing ? state.position + (Date.now() + clockAhead - state.at) / 1000 : state.position;
}

/**
 * The room's state, put onto the video playing here (when it's the same film or episode).
 * `steady`: nothing changed in the room, this is only the look for drift.
 */
function apply(before: RoomState | null, steady = false): void {
	const state = together.state;
	if (!attached || !state || !state.title) return;
	const { video, playing, note, follow } = attached;
	const here = playing();
	if (!sameThing(here, state)) {
		// The room went to another episode of the show playing here: this house goes too.
		const moved = !steady && before !== null && (before.season !== state.season || before.episode !== state.episode);
		if (moved && follow && state.type === 'tv' && here.type === 'tv' && sameTitle(here, state)) follow(state);
		return;
	}
	const where = roomPosition(state);
	const changedHands = !before || before.at !== state.at;
	if (changedHands || steady) chasing = 0;
	const apart = Math.abs(video.currentTime - where);
	const tolerance = state.playing ? (steady ? DRIFTED : OUT_OF_STEP) : 0.1;
	// (A move still under way isn't started again: on a slow line that would never let it land.)
	if (apart > tolerance && Number.isFinite(where) && video.readyState > 0 && !video.seeking) {
		roomSeekAt = Date.now();
		// While the room plays on, aim for where it will be once the move has landed.
		const aim = where + (state.playing ? seekTakes : 0);
		video.currentTime = Math.max(0, Math.min(aim, (video.duration || aim + 1) - 1));
	}
	if (state.playing && video.paused) {
		applyingUntil = Date.now() + 1500;
		void video.play().catch(() => {});
		// (After their player's own wait it just goes on: they never pressed anything.)
		if (changedHands && before && !before.waiting) note(`${state.by} pressed play`);
	} else if (!state.playing && !video.paused) {
		applyingUntil = Date.now() + 1500;
		video.pause();
		if (changedHands && before) note(state.waiting ? `${state.by} ${state.waiting}…` : `${state.by} paused`);
	} else if (!state.playing && changedHands && before && state.waiting && !before.waiting) {
		note(`${state.by} ${state.waiting}…`);
	}
}

/** The video played, paused or moved: the room's own doing is left at that, the person's is told. */
function heard(event: Event): void {
	if (event.type === 'seeked' && roomSeekAt) {
		const took = (Date.now() - roomSeekAt) / 1000;
		roomSeekAt = 0;
		// (Over 20 s it wasn't that move landing: the person moved it since.)
		if (took < 20) {
			seekTakes = Math.min(8, took);
			// A slow move landed behind the room: once or twice more, now aimed ahead by how long it took.
			if (chasing < 2) {
				chasing++;
				apply(together.state);
			}
			return;
		}
	}
	tell();
}

/** What happened on this screen, told to the room (never while watching along: the friend leads). */
function tell(): void {
	if (!attached || !together.code || together.following || Date.now() < applyingUntil) return;
	const mine = stateNow();
	const state = together.state;
	// Something else than the room is watching: only the one who started the room moves it there.
	if (state?.title && !sameThing(mine, state) && !together.host) return;
	// Already what the room says (an echo of its own doing): nothing to tell.
	if (state?.title && sameThing(mine, state) && mine.playing === state.playing && (state.waiting ?? '') === mine.waiting && Math.abs(mine.position - roomPosition(state)) < OUT_OF_STEP) return;
	const change = roomChange;
	const code = together.code;
	void ask<RoomAnswer>(`rooms/${code}/state`, 'PUT', mine).then((answer) => {
		if (answer && change === roomChange && code === together.code) {
			rev = answer.rev;
			clockAhead = answer.now - Date.now();
			together.state = answer.state;
			updatePeople(answer.people);
		}
	});
}

/**
 * The player's video joins the room this screen is in: its play, pause and skips are told to the
 * room, and the room's are done to it. `playing` says what the video is; `note` shows a line
 * ("Ann paused"); `follow` is asked to open another episode of the same show when the room goes
 * to it. Returns what undoes it.
 */
export function attachTogether(video: HTMLVideoElement, playing: () => Playing, note: (text: string) => void, follow?: (state: RoomState) => void): () => void {
	attached = { video, playing, note, follow };
	roomSeekAt = 0;
	if (together.offer && sameThing(playing(), together.offer)) together.offer = null;
	// (What the room did to the video before this one is no reason to keep quiet about this one.)
	applyingUntil = 0;
	const events = ['play', 'pause', 'seeked'] as const;
	for (const event of events) video.addEventListener(event, heard);
	// Just opened: in a room that's already on this, fall in step; otherwise (the room's starter, or an empty room) say what this is.
	const state = together.state;
	if (state?.title && sameThing(playing(), state)) apply(null);
	else if (together.code) tell();
	// Drifted apart (a stall here, say): looked at every few seconds.
	const steady = setInterval(() => apply(together.state, true), 5000);
	return () => {
		clearInterval(steady);
		for (const event of events) video.removeEventListener(event, heard);
		if (attached?.video === video) attached = null;
	};
}
