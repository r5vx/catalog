<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Avatar from '$lib/Avatar.svelte';
	import { together, startRoom, joinRoom, leaveRoom, rejoinKeptRoom, alongChanged, type RoomState } from '$lib/watchTogether.svelte';

	/**
	 * Friends online (src/lib/server/online.ts), at the top of the library's Friends: what each
	 * friend is watching right now, with Watch along (their room, when they allow it) or Watch it
	 * too; adding a friend with a code; the switch that lets friends watch along with you; and
	 * watching together by room code (src/lib/watchTogether.svelte.ts).
	 * Nothing shows until this Catalog is online (Settings → Online).
	 */
	type Watching = { title: string; type: 'tv' | 'movie'; year: string; season: number; episode: number; poster: string; room?: string };
	type Friend = { id: string; name: string; avatar: number; watching: Watching | null };
	type Switches = { reports: boolean; share: boolean; shared: boolean; along: boolean };

	let connected = $state<boolean | null>(null);
	let me = $state('');
	let friends = $state<Friend[]>([]);
	let switches = $state<Switches | null>(null);
	let adding = $state(false);
	let myCode = $state('');
	let copied = $state(false);
	let theirCode = $state('');
	let roomCode = $state('');
	let problem = $state('');
	let busy = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	const watchingNow = $derived(friends.filter((friend) => friend.watching));
	const others = $derived(friends.filter((friend) => !friend.watching));

	const cloud = (path: string, method = 'GET', body?: unknown) =>
		fetch(`/api/online/c/${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
			.then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
			.catch(() => ({ ok: false, status: 0, data: null }));

	async function load() {
		const answer = await cloud('friends');
		// (Not online: this Catalog hasn't joined, which the server side answers as "not yet".)
		connected = answer.ok ? true : answer.status === 0 || /isn't online/.test(answer.data?.error ?? '') ? false : connected;
		if (!answer.ok) return;
		me = answer.data.me?.name ?? '';
		friends = answer.data.friends ?? [];
	}

	onMount(() => {
		load();
		rejoinKeptRoom();
		fetch('/api/online?light=1')
			.then((r) => (r.ok ? r.json() : null))
			.then((status) => (switches = status?.switches ?? null))
			.catch(() => {});
		timer = setInterval(() => !document.hidden && connected && load(), 30_000);
	});
	onDestroy(() => clearInterval(timer));

	/** Opens the add-a-friend part, with a code of your own to give out. */
	async function openAdding() {
		adding = !adding;
		if (adding && !myCode) await newCode();
	}

	async function newCode() {
		const answer = await cloud('friends/code', 'POST', {});
		myCode = answer.data?.code ?? '';
		copied = false;
		problem = answer.ok ? '' : (answer.data?.error ?? "Couldn't make a code");
	}

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(myCode);
			copied = true;
		} catch {}
	}

	async function addFriend(event: SubmitEvent) {
		event.preventDefault();
		problem = '';
		const answer = await cloud('friends/add', 'POST', { code: theirCode });
		if (!answer.ok) {
			problem = answer.data?.error ?? "That code didn't work";
			return;
		}
		theirCode = '';
		adding = false;
		// (A code works once: the next friend gets a new one.)
		myCode = '';
		await load();
	}

	async function removeFriend(friend: Friend) {
		await cloud(`friends/${friend.id}`, 'DELETE');
		await load();
	}

	/** Friends may watch along with what plays here (or not, from now on). */
	async function setAlong(on: boolean) {
		if (!switches) return;
		switches.along = on;
		await fetch('/api/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switches', ...switches }) }).catch(() => null);
		alongChanged();
	}

	/** Into the friend's room, then their film or episode opens here and falls in step with theirs. */
	async function watchAlong(watching: Watching) {
		busy = true;
		if (watching.room && together.code !== watching.room) await joinRoom(watching.room);
		busy = false;
		await goto(watchHref(watching));
	}

	async function start() {
		busy = true;
		await startRoom();
		busy = false;
	}

	async function join(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		if (await joinRoom(roomCode)) roomCode = '';
		busy = false;
	}

	const label = (w: { title: string; type: string; season: number; episode: number }) => (w.type === 'tv' && w.season ? `${w.title} S${w.season}E${w.episode}` : w.title);
	function watchHref(w: Watching | RoomState): string {
		const params = new URLSearchParams({ title: w.title, type: w.type, year: w.year ?? '', auto: '1' });
		if (w.type === 'tv' && w.season) {
			params.set('resume_s', String(w.season));
			params.set('resume_e', String(w.episode));
		}
		return `/watch?${params}`;
	}
</script>

{#if connected === false}
	<p class="off faint">Friends online, watching together and synced progress: <a href="/settings/online">Settings → Online</a>.</p>
{:else if connected}
	<section class="online">
		<div class="block">
			<div class="head">
				<h2>Friends online</h2>
				<button type="button" class="btn" class:btn-primary={!friends.length} onclick={openAdding} aria-expanded={adding}>Add a friend</button>
			</div>

			{#if adding}
				<div class="adding">
					<p class="faint">Give a friend your code, or type theirs. Either way you're both added.</p>
					<div class="row">
						<span>Your code</span>
						{#if myCode}
							<strong class="code tabular">{myCode}</strong>
							<button type="button" class="link" onclick={copyCode}>{copied ? 'Copied' : 'Copy'}</button>
							<span class="faint small">works once, for a day</span>
						{:else}
							<span class="faint">…</span>
						{/if}
					</div>
					<form class="row" onsubmit={addFriend}>
						<input type="text" bind:value={theirCode} placeholder="A friend's code" autocomplete="off" spellcheck="false" maxlength="12" aria-label="A friend's code" />
						<button type="submit" class="btn btn-primary" disabled={!theirCode.trim()}>Add</button>
					</form>
				</div>
			{/if}
			{#if problem}<p class="msg bad">{problem}</p>{/if}

			{#if watchingNow.length}
				<h3 class="label">Watching now</h3>
				<ul class="now">
					{#each watchingNow as friend (friend.id)}
						{@const watching = friend.watching!}
						<li>
							{#if watching.poster}<img class="poster" src={watching.poster} alt="" />{:else}<span class="poster empty" aria-hidden="true"></span>{/if}
							<div class="about">
								<span class="who"><Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={24} />{friend.name}</span>
								<span class="what">{label(watching)}</span>
								<div class="row">
									{#if watching.room}
										<button type="button" class="btn btn-primary" onclick={() => watchAlong(watching)} disabled={busy}>Watch along</button>
									{:else}
										<a class="btn" href={watchHref(watching)}>Watch it too</a>
									{/if}
									<button type="button" class="link" onclick={() => removeFriend(friend)}>Remove</button>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if others.length}
				<ul class="rest">
					{#each others as friend (friend.id)}
						<li>
							<Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={28} />
							<span class="who">{friend.name}</span>
							<span class="what faint">Not watching now</span>
							<button type="button" class="link" onclick={() => removeFriend(friend)}>Remove</button>
						</li>
					{/each}
				</ul>
			{:else if !friends.length}
				<p class="faint">Nobody yet.</p>
			{/if}

			{#if switches}
				<label class="toggle">
					<input type="checkbox" checked={switches.along} onchange={(e) => setAlong(e.currentTarget.checked)} />
					Let friends watch along with me
				</label>
				<p class="faint small">Friends get a Watch along button beside what you're watching. Their play, pause and skips happen on your screen too.</p>
			{/if}
		</div>

		<div class="block">
			<h2>Watch together</h2>
			{#if together.code}
				<p>
					Room <strong class="code tabular">{together.code}</strong>
				</p>
				<p class="people">
					{#each together.people as person (person.id)}
						<span class="person"><Avatar id={person.id} name={person.name} rev={person.avatar} size={24} />{person.me ? `${person.name} (you)` : person.name}</span>
					{:else}
						<span class="faint">{me}</span>
					{/each}
				</p>
				{#if together.state?.title}
					<p class="what">
						{together.state.playing ? 'Playing' : 'Paused'}: {label(together.state)}
						<a class="btn btn-primary" href={watchHref(together.state)}>Watch</a>
					</p>
				{:else}
					<p class="faint">Nothing playing yet. Whoever started the room plays something; the others open it from here.</p>
				{/if}
				<div><button type="button" class="btn" onclick={leaveRoom}>Leave the room</button></div>
			{:else}
				<p class="faint">Play, pause and skips happen in every house at once. Each house plays from its own computer.</p>
				<div class="row">
					<button type="button" class="btn" onclick={start} disabled={busy}>Start a room</button>
					<form class="row" onsubmit={join}>
						<input type="text" bind:value={roomCode} placeholder="Room code" autocomplete="off" spellcheck="false" maxlength="8" aria-label="Room code" />
						<button type="submit" class="btn" disabled={busy || !roomCode.trim()}>Join</button>
					</form>
				</div>
			{/if}
			{#if together.problem}<p class="msg bad">{together.problem}</p>{/if}
		</div>
	</section>
{/if}

<style>
	.off {
		margin: 0 0 16px;
		font-size: 0.9rem;
	}

	.online {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 14px;
		margin-bottom: 22px;
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	h3 {
		margin: 4px 0 0;
	}

	p {
		margin: 0;
	}

	/* The add-a-friend part, set in from the rest. */
	.adding {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border-radius: var(--radius);
		background: var(--sunk);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.rest li,
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	/* A friend watching something: its poster, who, what, and the button. */
	.now li {
		display: flex;
		gap: 12px;
		align-items: stretch;
	}

	.poster {
		flex: none;
		width: 62px;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: var(--sunk);
	}

	.about {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		min-width: 0;
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}

	.what {
		flex: 1;
		font-size: 0.92rem;
	}

	.about .what {
		flex: none;
	}

	.row input {
		width: 11rem;
	}

	/* Who's in the room: a picture and a name each. */
	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font-size: 0.92rem;
	}

	.person {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.code {
		font-size: 1.15rem;
		letter-spacing: 0.08em;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.toggle input {
		width: auto;
	}

	.small {
		font-size: 0.85rem;
	}

	.toggle + .small {
		margin-top: -8px;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: underline;
	}
</style>
