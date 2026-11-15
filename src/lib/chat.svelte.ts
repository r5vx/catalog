/**
 * Messages between friends, through the meeting point (cloud/src/worker.js, /v1/messages):
 * whispers to one friend, and the chat of a watch-together room. New ones show for a few seconds
 * in the bottom-right corner, over the player too (lib/ChatOverlay.svelte); the Messages page
 * (/messages) keeps every whisper.
 *
 * Asked for every 15 seconds while Catalog is in front. In a room, they ride along with the room's
 * own looks instead (src/lib/watchTogether.svelte.ts), so a room costs no extra asking.
 */

export type Message = {
	id: number;
	/** Who sent it (their account id), their name and picture. */
	from: string;
	name: string;
	avatar: number;
	/** A whisper: whom to. '' for a room's line. */
	to: string;
	/** A room's line: its code. '' for a whisper. */
	room: string;
	text: string;
	at: number;
	/** Sent from here. */
	mine?: boolean;
};

type ChatAnswer = { messages: Message[]; last: number; history?: Message[]; unread?: number };

/** How long a new message stays in the corner. */
const SHOWN_FOR = 7000;
const ASK_EVERY = 15_000;

export const chat = $state({
	/** The newest message id this screen knows of. */
	last: 0,
	/** The first answer came (until then `last` means nothing: 0 can also be "no message yet"). */
	known: false,
	/** Whispers not read yet (the Friends page's Messages button). */
	unread: 0,
	/** New messages in the corner, newest last. */
	shown: [] as Message[],
	/** The room's chat, as far as this screen has seen it. */
	room: [] as Message[],
	/** Whispers that came while this screen was open, newest last (the corner's box shows them). */
	whispers: [] as Message[],
	/** Goes up with every new whisper, so the Messages page knows to look again. */
	heard: 0,
	/** The box for typing is open. */
	open: false,
	/** Whom the box sends to: 'room', or a friend's account id. */
	to: '' as string,
	toName: '',
	/** This computer is online (asked once at the start). */
	online: false
});

let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
/** Is this screen in a room? (Told by watchTogether, which asks for messages itself then.) */
let inRoom: () => boolean = () => false;

export function chatRoomCheck(check: () => boolean): void {
	inRoom = check;
}

/** New messages, from a look of our own or one riding along with the room's. */
export function takeChat(answer: ChatAnswer, fromRoom = false): void {
	if (!answer) return;
	if (answer.history) chat.room = answer.history;
	if (!chat.known) {
		chat.known = true;
		chat.last = answer.last ?? 0;
		if (typeof answer.unread === 'number') chat.unread = answer.unread;
		// (A first answer has nothing new in it: only where things stand.)
		if (!answer.messages?.length) return;
	}
	if (typeof answer.unread === 'number' && !fromRoom) chat.unread = answer.unread;
	for (const message of answer.messages ?? []) {
		if (message.id <= chat.last) continue;
		chat.last = Math.max(chat.last, message.id);
		if (message.room) chat.room = [...chat.room, message].slice(-100);
		else {
			chat.whispers = [...chat.whispers, message].slice(-50);
			chat.heard++;
			// (Counted here when the room brought it; our own looks say the real number.)
			if (fromRoom) chat.unread++;
		}
		show(message);
	}
	chat.last = Math.max(chat.last, answer.last ?? 0);
}

function show(message: Message): void {
	chat.shown = [...chat.shown, message].slice(-5);
	setTimeout(() => (chat.shown = chat.shown.filter((one) => one !== message && one.id !== message.id)), SHOWN_FOR);
}

async function look(): Promise<void> {
	try {
		const response = await fetch(`/api/online/c/messages?after=${chat.known ? chat.last : ''}`);
		if (response.ok) takeChat(await response.json());
	} catch {}
}

function lookLater(): void {
	clearTimeout(timer);
	timer = setTimeout(async () => {
		// (In a room, the room's looks bring them; while Catalog is behind other windows, nothing.)
		if (!document.hidden && !inRoom()) await look();
		lookLater();
	}, ASK_EVERY);
}

/** Started once, by the root layout: only when this Catalog is online. */
export async function startChat(): Promise<void> {
	if (started) return;
	started = true;
	try {
		const status = await fetch('/api/online?light=1').then((r) => (r.ok ? r.json() : null));
		chat.online = Boolean(status?.connected);
	} catch {}
	if (!chat.online) return;
	await look();
	lookLater();
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && !inRoom()) void look();
	});
}

/** Sends a line: to the room this screen is in (`room` is its code), or a whisper to a friend. */
export async function sendMessage(text: string, to: { room?: string; friend?: string }): Promise<Message | null> {
	const clean = text.trim().slice(0, 500);
	if (!clean) return null;
	try {
		const response = await fetch('/api/online/c/messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(to.room ? { room: to.room, text: clean } : { to: to.friend, text: clean })
		});
		const answer = await response.json().catch(() => null);
		if (!response.ok || !answer?.message) return null;
		const message = { ...answer.message, mine: true } as Message;
		if (message.room) chat.room = [...chat.room, message].slice(-100);
		else chat.whispers = [...chat.whispers, message].slice(-50);
		return message;
	} catch {
		return null;
	}
}

/** Whispers from `friend` up to `upto` were read (the Messages page). */
export async function markRead(friend: string, upto: number): Promise<void> {
	try {
		const response = await fetch('/api/online/c/messages/read', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ with: friend, upto })
		});
		const answer = await response.json().catch(() => null);
		if (typeof answer?.unread === 'number') chat.unread = answer.unread;
	} catch {}
}

/** Opens the box for typing, to the room or to one friend. */
export function openChat(to?: { id: string; name: string } | 'room'): void {
	if (to === 'room') {
		chat.to = 'room';
		chat.toName = '';
	} else if (to) {
		chat.to = to.id;
		chat.toName = to.name;
	}
	chat.open = true;
}
