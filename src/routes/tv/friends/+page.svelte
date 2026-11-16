<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import TvKeyboard from '$lib/tv/TvKeyboard.svelte';
	import { letterColor } from '$lib/avatarColor';
	import { joinRoom, leaveRoom, together } from '$lib/watchTogether.svelte';
	import { watchHref } from '$lib/friendLinks';
	import { startTvNav } from '$lib/tvNav';

	/**
	 * Friends on the TV (owner, 2026-11-16: family shouldn't have to go to the laptop to add
	 * friends). For whoever's watching on this TV: friends watching now (Watch along falls in step
	 * with them, in their room), people who asked to be friends, this profile's friend code to give
	 * out, adding a friend by their code with the TV's keyboard, and people friends know.
	 * The same meeting point as the computer's Friends (src/lib/OnlineFriends.svelte).
	 */
	type Watching = { title: string; type: 'tv' | 'movie'; year: string; season: number; episode: number; poster: string; room?: string };
	type Friend = { id: string; name: string; watching: Watching | null };
	type Known = { id: string; name: string; via?: string; requested?: boolean };

	/** The letters friend codes are made of (no 0/O or 1/I/L to mix up). */
	const CODE_KEYS = 'abcdefghjkmnpqrstuvwxyz23456789';

	let online = $state<boolean | null>(null);
	let friends = $state<Friend[]>([]);
	let requests = $state<Known[]>([]);
	let suggestions = $state<Known[]>([]);
	let myCode = $state('');
	let adding = $state(false);
	let typed = $state('');
	let note = $state('');
	let busy = $state(false);

	const watchingNow = $derived(friends.filter((f) => f.watching));

	/** Something highlighted again after the screen changes under the remote (it first draws empty, then the friends come). */
	async function highlight() {
		await tick();
		startTvNav(document.querySelector<HTMLElement>('[data-tv-app]'));
	}
	function setAdding(on: boolean) {
		adding = on;
		note = '';
		void highlight();
	}

	const cloud = (path: string, method = 'GET', body?: unknown) =>
		fetch(`/api/online/c/${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
			.then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
			.catch(() => ({ ok: false, status: 0, data: null }));

	async function load() {
		const answer = await cloud('friends');
		online = answer.ok;
		if (!answer.ok) return;
		friends = answer.data?.friends ?? [];
		requests = answer.data?.requests ?? [];
		suggestions = answer.data?.suggestions ?? [];
		if (!myCode) myCode = (await cloud('friends/code', 'POST', {})).data?.code ?? '';
	}

	onMount(() => {
		void load().then(highlight);
		// Who's watching what moves: asked again every 30 s while this screen is up.
		const timer = setInterval(() => void load(), 30_000);
		return () => clearInterval(timer);
	});

	const label = (w: Watching) => (w.type === 'tv' && w.season ? `${w.title} S${w.season}E${w.episode}` : w.title);

	/** Into their room, then their film or episode opens here and follows their player. */
	async function watchAlong(friend: Friend) {
		const w = friend.watching!;
		busy = true;
		if (w.room && together.code !== w.room) await joinRoom(w.room, friend.name);
		busy = false;
		await goto(watchHref(w));
	}

	/** The same film or episode, on its own here, from this profile's own place. */
	async function watchToo(friend: Friend) {
		const w = friend.watching!;
		if (together.code && together.code === w.room) leaveRoom();
		await goto(watchHref(w));
	}

	async function answerRequest(person: Known, yes: boolean) {
		busy = true;
		await cloud('friends/answer', 'POST', { from: person.id, yes });
		busy = false;
		note = yes ? `${person.name} is your friend now` : '';
		await load();
		void highlight();
	}

	async function ask(person: Known) {
		busy = true;
		const answer = await cloud('friends/request', 'POST', { to: person.id });
		busy = false;
		note = answer.ok ? `Asked ${person.name}` : (answer.data?.error ?? "Couldn't ask");
		await load();
		void highlight();
	}

	async function addFriend() {
		const code = typed.trim();
		if (!code) return;
		busy = true;
		const answer = await cloud('friends/add', 'POST', { code });
		busy = false;
		if (!answer.ok) {
			note = answer.data?.error ?? "That code didn't work";
			return;
		}
		note = answer.data?.name ? `${answer.data.name} is your friend now` : 'Added';
		typed = '';
		adding = false;
		await load();
		void highlight();
	}
</script>

<svelte:head><title>Friends · Catalog</title></svelte:head>

<div class="friends">
	<h1>Friends</h1>

	{#if online === false}
		<p class="hint">This computer isn't online yet. Turn it on from the computer: Settings → Online.</p>
	{:else if online === null}
		<p class="hint">…</p>
	{:else if adding}
		<!-- Adding a friend: their code typed with the TV's keyboard. -->
		<div class="adding">
			<div class="left">
				<p class="typed" class:placeholder={!typed}>{typed.toUpperCase() || 'Their code'}<span class="caret"></span></p>
				<TvKeyboard bind:value={typed} keys={CODE_KEYS} columns={8} />
			</div>
			<!-- Each its own row, so up and down move between them. -->
			<div class="right">
				<div data-tv-row>
					<button type="button" class="option" data-tv-item disabled={busy || !typed.trim()} onclick={addFriend}>
						<strong>Add</strong>
						<span>Their friend code is on their Friends screen, on a TV or the computer.</span>
					</button>
				</div>
				<div data-tv-row>
					<button type="button" class="option" data-tv-item onclick={() => setAdding(false)}>
						<strong>Cancel</strong>
					</button>
				</div>
				{#if note}<p class="note">{note}</p>{/if}
			</div>
		</div>
	{:else}
		{#if note}<p class="note">{note}</p>{/if}

		{#if watchingNow.length}
			<h2>Watching now</h2>
			<div class="row" data-tv-row>
				{#each watchingNow as friend (friend.id)}
					<div class="now">
						{#if friend.watching?.poster}<img src={friend.watching.poster} alt="" />{/if}
						<p><strong>{friend.name}</strong> is watching {label(friend.watching!)}</p>
						<div class="buttons">
							{#if friend.watching?.room}
								<button type="button" class="chip" data-tv-item disabled={busy} onclick={() => watchAlong(friend)}>Watch along</button>
							{/if}
							<button type="button" class="chip" data-tv-item onclick={() => watchToo(friend)}>Watch it myself</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if requests.length}
			<h2>Want to be friends</h2>
			{#each requests as person (person.id)}
				<div class="row line" data-tv-row>
					<span class="avatar" style:background={letterColor(person.name)}>{person.name.slice(0, 1).toUpperCase()}</span>
					<span class="name">{person.name}</span>
					<button type="button" class="chip" data-tv-item disabled={busy} onclick={() => answerRequest(person, true)}>Accept</button>
					<button type="button" class="chip" data-tv-item disabled={busy} onclick={() => answerRequest(person, false)}>No</button>
				</div>
			{/each}
		{/if}

		<div class="row" data-tv-row>
			<button type="button" class="option" data-tv-item data-tv-autofocus onclick={() => setAdding(true)}>
				<strong>Add a friend</strong>
				<span>Type their friend code.</span>
			</button>
			{#if myCode}
				<div class="code">
					<span>Your friend code</span>
					<strong class="tabular">{myCode}</strong>
					<span>Friends add you with it.</span>
				</div>
			{/if}
		</div>

		{#if friends.length}
			<h2>Your friends</h2>
			<ul class="list">
				{#each friends as friend (friend.id)}
					<li>
						<span class="avatar" style:background={letterColor(friend.name)}>{friend.name.slice(0, 1).toUpperCase()}</span>
						<span class="name">{friend.name}</span>
						{#if friend.watching}<span class="faint">{label(friend.watching)}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">No friends yet. Add one with their code, or give them yours.</p>
		{/if}

		{#if suggestions.length}
			<h2>People your friends know</h2>
			{#each suggestions.slice(0, 6) as person (person.id)}
				<div class="row line" data-tv-row>
					<span class="avatar" style:background={letterColor(person.name)}>{person.name.slice(0, 1).toUpperCase()}</span>
					<span class="name">{person.name}{#if person.via}<span class="faint"> · knows {person.via}</span>{/if}</span>
					{#if person.requested}
						<span class="faint">Asked</span>
					{:else}
						<button type="button" class="chip" data-tv-item disabled={busy} onclick={() => ask(person)}>Ask to be friends</button>
					{/if}
				</div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.friends {
		position: absolute;
		inset: 0;
		padding: 8vh 3vw 30vh 1vw;
		display: flex;
		flex-direction: column;
		gap: 1.4vw;
		overflow: hidden;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3.2vw;
	}

	h2 {
		margin: 1vw 0 0;
		font-size: 1.3vw;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.hint,
	.note {
		margin: 0;
		font-size: 1.5vw;
		color: var(--ink-soft);
	}

	.note {
		color: var(--accent);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 1.4vw;
	}

	.line {
		gap: 1vw;
	}

	.avatar {
		display: inline-grid;
		place-items: center;
		width: 2.8vw;
		height: 2.8vw;
		border-radius: 50%;
		color: #fff;
		font-weight: 700;
		font-size: 1.3vw;
		flex: none;
	}

	.name {
		font-size: 1.6vw;
		font-weight: 600;
		margin-right: 1vw;
	}

	.faint {
		color: var(--ink-faint);
		font-weight: 400;
	}

	/* A friend watching now: their poster, what it is, and the ways to join in. */
	.now {
		display: flex;
		flex-direction: column;
		gap: 0.6vw;
		width: 22vw;
		padding: 1vw;
		border-radius: 0.8vw;
		background: rgb(255 255 255 / 8%);
	}

	.now img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 0.5vw;
	}

	.now p {
		margin: 0;
		font-size: 1.35vw;
	}

	.buttons {
		display: flex;
		gap: 0.6vw;
	}

	.chip {
		padding: 0.7vw 1.4vw;
		border: none;
		border-radius: 100vw;
		background: rgb(255 255 255 / 10%);
		color: var(--ink);
		font: inherit;
		font-size: 1.3vw;
		font-weight: 700;
		cursor: pointer;
		outline: none;
	}

	.option {
		display: flex;
		flex-direction: column;
		gap: 0.4vw;
		padding: 1.4vw 1.8vw;
		border: none;
		border-radius: 0.8vw;
		background: rgb(255 255 255 / 8%);
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		outline: none;
	}

	.option strong {
		font-size: 1.7vw;
	}

	.option span {
		font-size: 1.25vw;
		color: var(--ink-soft);
	}

	.chip:focus,
	.chip:global(.tv-focused),
	.option:focus,
	.option:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.option:focus span,
	.option:global(.tv-focused) span {
		color: var(--paper);
	}

	.chip:disabled,
	.option:disabled {
		opacity: 0.5;
	}

	.code {
		display: flex;
		flex-direction: column;
		gap: 0.3vw;
		font-size: 1.25vw;
		color: var(--ink-soft);
	}

	.code strong {
		font-size: 2.4vw;
		letter-spacing: 0.15em;
		color: var(--ink);
	}

	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 1vw 3vw;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: center;
		gap: 1vw;
	}

	.adding {
		display: flex;
		gap: 3vw;
	}

	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: 1.2vw;
	}

	.right {
		width: 26vw;
	}

	.right .option {
		width: 100%;
	}

	.typed {
		margin: 0;
		font-size: 2.6vw;
		font-weight: 700;
		letter-spacing: 0.12em;
	}

	.typed.placeholder {
		color: var(--ink-faint);
		letter-spacing: normal;
	}

	.caret {
		display: inline-block;
		width: 0.2vw;
		height: 2.4vw;
		margin-left: 0.3vw;
		vertical-align: -0.3vw;
		background: var(--accent);
	}
</style>
