<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import ContextMenu, { menuAt, type MenuItem } from '$lib/ContextMenu.svelte';
	import { chat, startChat, sendMessage, openChat, markRead, chatNoticeClick, type Message } from '$lib/chat.svelte';
	import { together, leaveRoom, rejoinKeptRoom, type RoomState } from '$lib/watchTogether.svelte';
	import { watchHref, wantToWatch } from '$lib/friendLinks';
	import { isTv } from '$lib/tv';

	/**
	 * The corner of the screen, bottom right, over every page and the player (moved into the
	 * full-screen player when it's full screen): new messages for a few seconds on a see-through
	 * background, the box to type one (Enter opens it, Escape or a click anywhere else closes it;
	 * solid, not see-through, since 2026-11-15), and the room's "Ann
	 * started Inception" with Join (owner, 2026-11-15: "a popup when someone in the group starts a
	 * movie").
	 */

	type Friend = { id: string; name: string; avatar: number };
	type Thread = { id: string; name: string; avatar: number; unread: number; last: { text: string; at: number; mine: boolean } | null };

	let friends = $state<Friend[]>([]);
	let friendsAskedAt = 0;
	/** Each friend's conversation and unread count (asked as the box opens), for the row of people. */
	let threads = $state<Thread[]>([]);
	/** Earlier whispers with the friend the box is open to (from before this screen opened). */
	let earlier = $state<{ id: string; messages: Message[] }>({ id: '', messages: [] });
	let typed = $state('');
	let sending = $state(false);
	let problem = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let boxEl = $state<HTMLElement | null>(null);
	let buttonEl = $state<HTMLElement | null>(null);
	let menu = $state<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
	let autoJoin = $state(false);
	let tv = $state(false);
	/** An offer already answered (by what it was), so the same start isn't asked twice. */
	let answered = $state('');

	const onPlayer = $derived(page.url.pathname === '/watch');
	const hidden = $derived(/^\/(tv|login|welcome|strip-maker|skip-maker|speech-maker)(\/|$)/.test(page.url.pathname));
	const offerKey = (state: RoomState) => `${state.title}|${state.season}|${state.episode}|${state.at}`;
	const offer = $derived(together.offer && offerKey(together.offer) !== answered ? together.offer : null);

	/** What the box shows above where you type: the room's lines, or the whispers with that friend. */
	const lines = $derived.by(() => {
		if (chat.to === 'room') return chat.room.slice(-8);
		const here = chat.whispers.filter((m) => m.from === chat.to || m.to === chat.to);
		const before = earlier.id === chat.to ? earlier.messages.filter((m) => !here.some((one) => one.id === m.id)) : [];
		return [...before, ...here].sort((a, b) => a.id - b.id).slice(-8);
	});

	/**
	 * The people row at the top of the box (owner, 2026-11-18: pressing Tab through every friend to
	 * find a new message was annoying): who has unread whispers first, then the latest conversations.
	 */
	const people = $derived(
		[...threads]
			.filter((one) => one.unread || one.last)
			.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || (b.last?.at ?? 0) - (a.last?.at ?? 0))
			.slice(0, 6)
	);

	/** No chat button with nobody to talk to (owner, 2026-11-18), or when turned off in Settings → Online. */
	const showButton = $derived(chat.button && (chat.friends !== 0 || Boolean(together.code)));

	onMount(() => {
		tv = isTv();
		void startChat();
		rejoinKeptRoom();
		// (A click on a whisper's Windows notice: the box, open to them.)
		chatNoticeClick((message) => void open({ id: message.from, name: message.name, avatar: message.avatar }));
		fetch('/api/online?light=1')
			.then((r) => (r.ok ? r.json() : null))
			.then((status) => (autoJoin = Boolean(status?.switches?.autoJoin)))
			.catch(() => {});
	});

	// Watching along with a friend, or "open it by itself" on: what the room starts opens at once.
	$effect(() => {
		const state = offer;
		if (state && (together.following || autoJoin)) void join(state);
	});

	// Online: whether there's anyone to talk to (the chat button waits for it).
	$effect(() => {
		if (chat.online) untrack(() => void loadFriends());
	});

	// Opened from anywhere (a friend's card, a profile's Whisper): the list of friends, and the cursor in the box.
	$effect(() => {
		if (!chat.open) return;
		untrack(() => {
			void loadFriends();
			void loadThreads();
		});
		void tick().then(() => inputEl?.focus());
	});

	// The box is open to a friend: their earlier whispers, and the new ones marked read.
	$effect(() => {
		const id = chat.to;
		if (!chat.open || !id || id === 'room') return;
		// (Untracked: the loader reads and writes `earlier` before its first await, which made this
		// effect run itself again and again.)
		untrack(() => void loadEarlier(id));
	});

	// A click anywhere but the box (or its button) closes it (owner, 2026-11-15). What was typed stays.
	$effect(() => {
		if (!chat.open) return;
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && (boxEl?.contains(target) || buttonEl?.contains(target))) return;
			close();
		};
		document.addEventListener('pointerdown', away, true);
		return () => document.removeEventListener('pointerdown', away, true);
	});

	/** Friends, asked again at most every 5 minutes (so a friend added since shows up). */
	async function loadFriends() {
		if (Date.now() - friendsAskedAt < 5 * 60_000) return;
		friendsAskedAt = Date.now();
		const answer = await fetch('/api/online/c/friends')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!answer) {
			friendsAskedAt = 0;
			return;
		}
		friends = answer.friends ?? [];
		chat.friends = friends.length;
	}

	async function loadThreads() {
		const answer = await fetch('/api/online/c/messages/threads')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!answer) return;
		threads = answer.threads ?? [];
		if (typeof answer.unread === 'number') chat.unread = answer.unread;
	}

	async function loadEarlier(id: string) {
		if (earlier.id !== id) earlier = { id, messages: [] };
		const answer = await fetch(`/api/online/c/messages/with/${id}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!answer || chat.to !== id) return;
		earlier = { id, messages: (answer.messages ?? []).slice(-8) };
		const newest = [...earlier.messages, ...chat.whispers].filter((m) => m.from === id).reduce((top, m) => Math.max(top, m.id), 0);
		if (newest && threads.find((one) => one.id === id)?.unread !== 0) {
			await markRead(id, newest);
			threads = threads.map((one) => (one.id === id ? { ...one, unread: 0 } : one));
		}
	}

	/** The box opens: to the room when in one, else to whoever whispered last, else the first friend. */
	async function open(to?: Friend | 'room') {
		await loadFriends();
		if (to) openChat(to);
		else if (chat.unread && !together.code) {
			// Something unread: the box opens to whoever sent the newest of it.
			await loadThreads();
			const waiting = threads.filter((one) => one.unread).sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0))[0];
			openChat(waiting ?? undefined);
		} else if (!chat.to || (chat.to === 'room' && !together.code)) {
			const lastFrom = [...chat.whispers].reverse().find((m) => !m.mine);
			if (together.code) openChat('room');
			else if (lastFrom) openChat({ id: lastFrom.from, name: lastFrom.name });
			else if (friends[0]) openChat(friends[0]);
			else openChat();
		} else openChat();
		await tick();
		inputEl?.focus();
	}

	function close() {
		chat.open = false;
		problem = '';
		inputEl?.blur();
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!typed.trim() || sending) return;
		const to = chat.to === 'room' ? { room: together.code } : { friend: chat.to };
		if (!to.room && !to.friend) return;
		sending = true;
		const sent = await sendMessage(typed, to);
		sending = false;
		if (sent) {
			typed = '';
			problem = '';
		} else problem = "Couldn't send it";
	}

	/** Where to send: the room (when in one), then each friend. */
	function pickTo(value: string) {
		if (value === 'room') openChat('room');
		else {
			const friend = friends.find((one) => one.id === value) ?? threads.find((one) => one.id === value);
			if (friend) openChat(friend);
		}
		inputEl?.focus();
	}

	/** Tab moves to the next one. */
	function nextTo() {
		const order = [...(together.code ? ['room'] : []), ...friends.map((one) => one.id)];
		if (!order.length) return;
		pickTo(order[(order.indexOf(chat.to) + 1) % order.length]);
	}

	function onKey(event: KeyboardEvent) {
		if (tv || hidden || !chat.online || (chat.friends === 0 && !together.code)) return;
		if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || chat.open) return;
		const focused = document.activeElement as HTMLElement | null;
		// (Enter in a box, on a button or a link is theirs.)
		if (focused && focused !== document.body && focused.matches('input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="menuitem"]')) return;
		event.preventDefault();
		void open();
	}

	function boxKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			nextTo();
		}
		// (The player's own keys, Space and the arrows, aren't for it while typing.)
		event.stopPropagation();
	}

	/** Into what the room started: the player opens it and falls in step with the room. */
	async function join(state: RoomState) {
		answered = offerKey(state);
		together.offer = null;
		await goto(watchHref(state));
	}

	function notNow(state: RoomState) {
		answered = offerKey(state);
		together.offer = null;
	}

	async function alwaysJoin(on: boolean) {
		autoJoin = on;
		await fetch('/api/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switches', autoJoin: on }) }).catch(() => null);
	}

	function offerMenu(event: MouseEvent, state: RoomState) {
		const items: MenuItem[] = [
			{ label: 'Join', run: () => join(state) },
			{ label: 'Add to Want to watch', run: () => void wantToWatch(state).then((ok) => ok && notNow(state)) },
			{ label: 'Not now', run: () => notNow(state) },
			'-',
			{ label: 'Leave the room', run: () => leaveRoom(), danger: true }
		];
		menu = { at: menuAt(event, items.length), items };
	}

	function messageMenu(event: MouseEvent, message: Message) {
		const items: MenuItem[] = [
			message.room ? { label: 'Reply in the group', run: () => open('room') } : { label: `Reply to ${message.name}`, run: () => open({ id: message.from, name: message.name, avatar: message.avatar }) },
			...(!message.room ? [{ label: 'Open messages', run: () => goto(`/messages?with=${message.from}`) }] : []),
			{ label: 'Hide', run: () => (chat.shown = chat.shown.filter((one) => one.id !== message.id)) }
		];
		menu = { at: menuAt(event, items.length), items };
	}

	/**
	 * Keeps the corner inside whatever is full screen (the player), so messages show over the
	 * video there too: a full-screen element shows only what's inside it.
	 */
	function intoFullscreen(node: HTMLElement) {
		const home = node.parentElement;
		const move = () => {
			const there = document.fullscreenElement;
			if (there && node.parentElement !== there) there.appendChild(node);
			else if (!there && home && node.parentElement !== home) home.appendChild(node);
		};
		document.addEventListener('fullscreenchange', move);
		move();
		return {
			destroy() {
				document.removeEventListener('fullscreenchange', move);
				node.remove();
			}
		};
	}

	const label = (state: RoomState) => (state.type === 'tv' && state.season ? `${state.title} S${state.season}E${state.episode}` : state.title);
</script>

<svelte:window onkeydown={onKey} />

<!-- (Always here, so it can be moved into the full-screen player and back: lib/ChatOverlay.svelte intoFullscreen.) -->
<div class="chat-root" use:intoFullscreen>
{#if chat.online && !hidden}
	<div class="corner" class:on-player={onPlayer}>
		{#if offer && !together.following && !autoJoin}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="offer" role="dialog" tabindex="-1" aria-label="Someone in the room started something" oncontextmenu={(e) => offerMenu(e, offer)}>
				<p><strong>{offer.by}</strong> started <strong>{label(offer)}</strong></p>
				<div class="row">
					<button type="button" class="btn btn-primary" onclick={() => join(offer)}>Join</button>
					<button type="button" class="btn" onclick={() => notNow(offer)}>Not now</button>
				</div>
				<label class="always">
					<input type="checkbox" checked={autoJoin} onchange={(e) => alwaysJoin(e.currentTarget.checked)} />
					Always join by itself
				</label>
			</div>
		{/if}

		{#if !chat.open}
			<ul class="shown" aria-live="polite">
				{#each chat.shown as message (message.id)}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<li class="line" class:whisper={!message.room} oncontextmenu={(e) => messageMenu(e, message)}>
						<span class="where">{message.room ? 'Group' : 'Whisper'}</span>
						<strong>{message.name}:</strong>
						<span class="text" data-plain>{message.text}</span>
					</li>
				{/each}
			</ul>
			{#if chat.shown.length && !tv}<p class="hint">Enter to reply</p>{/if}
		{:else}
			<div class="box" bind:this={boxEl}>
				<div class="people">
					{#each people as person (person.id)}
						<button type="button" class="person" class:on={chat.to === person.id} onclick={() => pickTo(person.id)}>
							<Avatar name={person.name} rev={person.avatar} id={person.id} size={20} />
							<span class="who">{person.name}</span>
							{#if person.unread && chat.to !== person.id}<span class="count">{person.unread}</span>{/if}
						</button>
					{/each}
					<a class="all" href={chat.to && chat.to !== 'room' ? `/messages?with=${chat.to}` : '/messages'} onclick={close}>All messages</a>
				</div>
				{#if lines.length}
					<ul class="history">
						{#each lines as message (message.id)}
							<li class="line" class:whisper={!message.room} class:mine={message.mine}>
								<strong>{message.mine ? 'You' : message.name}:</strong>
								<span class="text" data-plain>{message.text}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<form onsubmit={send}>
					<select value={chat.to} onchange={(e) => pickTo(e.currentTarget.value)} aria-label="Send to" onkeydown={boxKey}>
						{#if together.code}<option value="room">Group</option>{/if}
						{#each friends as friend (friend.id)}<option value={friend.id}>{friend.name}</option>{/each}
						{#if chat.to && chat.to !== 'room' && !friends.some((one) => one.id === chat.to)}<option value={chat.to}>{chat.toName}</option>{/if}
						{#if !together.code && !friends.length}<option value="">Nobody yet</option>{/if}
					</select>
					<input
						bind:this={inputEl}
						bind:value={typed}
						type="text"
						maxlength="500"
						autocomplete="off"
						placeholder={chat.to === 'room' ? 'Message the group' : chat.toName ? `Whisper to ${chat.toName}` : 'Message'}
						aria-label="Message"
						onkeydown={boxKey}
					/>
				</form>
				<p class="hint">{problem || 'Enter sends · Tab changes who · Esc closes'}</p>
			</div>
		{/if}

		{#if !onPlayer && !tv && showButton}
			<button type="button" class="chat-button" bind:this={buttonEl} onclick={() => (chat.open ? close() : open())} aria-label="Messages" title="Chat (Enter)">
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
				</svg>
				{#if chat.unread}<span class="badge">{chat.unread}</span>{/if}
			</button>
		{/if}
	</div>
{/if}
{#if menu}<ContextMenu at={menu.at} items={menu.items} close={() => (menu = null)} />{/if}
</div>

<style>
	.chat-root {
		display: contents;
	}

	/* Bottom right, above the page; over the player, above its control bar. */
	.corner {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 2500;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		max-width: min(420px, calc(100vw - 32px));
		pointer-events: none;
	}

	.corner.on-player {
		bottom: 96px;
	}

	.corner > * {
		pointer-events: auto;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-end;
	}

	/* A message: light text on a see-through dark strip, readable over any picture. */
	.line {
		max-width: 100%;
		padding: 5px 10px;
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 0.88rem;
		line-height: 1.35;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
		overflow-wrap: anywhere;
		animation: in 0.18s ease-out;
	}

	.shown .line {
		animation: in 0.18s ease-out, out 0.6s ease-in 6.4s forwards;
	}

	.line.whisper strong {
		color: var(--accent);
	}

	.line.mine {
		background: rgba(0, 0, 0, 0.4);
	}

	.where {
		margin-right: 6px;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.7;
	}

	.text {
		margin-left: 4px;
	}

	.hint {
		margin: 0;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.45);
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.74rem;
	}

	/* The box for typing: solid, in the page's own colors (the messages that pop up stay see-through). */
	.box {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		width: min(420px, calc(100vw - 32px));
		padding: 10px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
		animation: in 0.18s ease-out;
	}

	.history {
		align-items: stretch;
		max-height: 40vh;
		overflow-y: auto;
	}

	.box .line {
		padding: 4px 8px;
		background: var(--surface-2);
		color: var(--ink);
		text-shadow: none;
	}

	.box .line.mine {
		background: var(--accent-bg);
	}

	.box form {
		display: flex;
		gap: 6px;
	}

	/* Who to talk to, one press each, with their new whispers counted. */
	.people {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.person {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 11rem;
		padding: 3px 8px 3px 3px;
		border: 1px solid var(--rule);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--ink);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.person:hover,
	.person.on {
		border-color: var(--accent);
	}

	.person .who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.person .count {
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 16px;
		text-align: center;
	}

	.people .all {
		margin-left: auto;
		font-size: 0.8rem;
		color: var(--accent);
	}

	.box select {
		flex: none;
		max-width: 9rem;
	}

	.box input {
		flex: 1;
		min-width: 0;
	}

	.box .hint {
		padding: 0 2px;
		background: none;
		color: var(--ink-faint);
	}

	.offer {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		animation: in 0.2s ease-out;
	}

	.offer p {
		margin: 0;
	}

	.row {
		display: flex;
		gap: 8px;
	}

	.always {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.82rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.always input {
		width: auto;
	}

	.chat-button {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 1px solid var(--rule);
		border-radius: 50%;
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
		cursor: pointer;
	}

	.chat-button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 18px;
		text-align: center;
	}

	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	@keyframes out {
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.line,
		.offer,
		.box {
			animation: none;
		}
	}
</style>
