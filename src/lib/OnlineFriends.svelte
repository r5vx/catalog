<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import { p } from '$lib/altText';
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
	/** Someone a friend knows ("Bob, a friend of Ann's"), or one of a friend's friends. */
	type Known = { id: string; name: string; avatar: number; via?: string; mutual?: number; requested?: boolean; me?: boolean; friend?: boolean; asked?: boolean };
	type FriendsAnswer = { me?: { name: string }; friends?: Friend[]; requests?: Known[]; suggestions?: Known[] };

	/**
	 * What the page had to hand (src/routes/+page.server.ts `friendsStart`): whether this Catalog is
	 * online and the last answer about friends, shown at once and then asked for afresh.
	 */
	let { initial = null }: { initial?: { online: boolean; friends: unknown } | null } = $props();
	const kept = untrack(() => (initial?.friends ?? null) as FriendsAnswer | null);

	let connected = $state<boolean | null>(untrack(() => (initial ? (initial.online ? true : false) : null)));
	let me = $state(kept?.me?.name ?? '');
	let friends = $state<Friend[]>(kept?.friends ?? []);
	let requests = $state<Known[]>(kept?.requests ?? []);
	let suggestions = $state<Known[]>(kept?.suggestions ?? []);
	/** A friend whose friends are listed under their name (to ask the ones you don't know). */
	let openFriend = $state<string | null>(null);
	let theirFriends = $state<Known[] | null>(null);
	let switches = $state<Switches | null>(null);
	let adding = $state(false);
	let myCode = $state('');
	let copied = $state(false);
	let theirCode = $state('');
	/** The owner's key was typed in the friend's-code box and was right. */
	let ownerSaved = $state(false);
	let roomCode = $state('');
	let problem = $state('');
	let busy = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	/** A line in the alternate wording when it's on (Settings → Personalization → Code), else as it is. */
	const t = (text: string) => (page.data.altMode ? p(text) : text);

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
		requests = answer.data.requests ?? [];
		suggestions = answer.data.suggestions ?? [];
	}

	/** Asks someone a friend knows to be friends (friends at once when they'd asked you already). */
	async function ask(person: Known) {
		busy = true;
		const answer = await cloud('friends/request', 'POST', { to: person.id });
		busy = false;
		problem = answer.ok ? '' : (answer.data?.error ?? "Couldn't ask");
		if (theirFriends) theirFriends = theirFriends.map((p) => (p.id === person.id ? { ...p, requested: !answer.data?.friends, friend: Boolean(answer.data?.friends) } : p));
		await load();
	}

	async function unask(person: Known) {
		await cloud('friends/unrequest', 'POST', { to: person.id });
		if (theirFriends) theirFriends = theirFriends.map((p) => (p.id === person.id ? { ...p, requested: false } : p));
		await load();
	}

	/** Yes or no to someone who asked. */
	async function answerRequest(person: Known, yes: boolean) {
		busy = true;
		await cloud('friends/answer', 'POST', { from: person.id, yes });
		busy = false;
		await load();
	}

	/** A friend's own friends, under their name (again: closed). */
	async function showTheirFriends(friend: Friend) {
		if (openFriend === friend.id) {
			openFriend = null;
			theirFriends = null;
			return;
		}
		openFriend = friend.id;
		theirFriends = null;
		const answer = await cloud(`friends/${friend.id}/friends`);
		if (openFriend !== friend.id) return;
		theirFriends = answer.ok ? (answer.data.friends ?? []) : [];
	}

	onMount(() => {
		load();
		rejoinKeptRoom();
		fetch('/api/online?light=1')
			.then((r) => (r.ok ? r.json() : null))
			.then((status) => (switches = status?.switches ?? null))
			.catch(() => {});
		// Asked again every 15 s while it's on screen, and as soon as it's looked at again: "watching
		// now" stayed after a friend had stopped (owner, 2026-11-15).
		timer = setInterval(() => !document.hidden && connected && load(), 15_000);
		document.addEventListener('visibilitychange', lookAgain);
		window.addEventListener('focus', lookAgain);
		// (Undone here, not in onDestroy: that also runs while the page is drawn on the server,
		// where there's no document, and the Friends page failed to open, 2026-11-15.)
		return () => {
			document.removeEventListener('visibilitychange', lookAgain);
			window.removeEventListener('focus', lookAgain);
		};
	});
	onDestroy(() => clearInterval(timer));

	/** Back on the page (another tab or window was in front): asked again now. */
	function lookAgain() {
		if (!document.hidden && connected) void load();
	}

	let refreshing = $state(false);
	/** The Refresh button: friends asked again now. */
	async function refresh() {
		refreshing = true;
		await load();
		refreshing = false;
	}

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
		// Longer than any friend's code: the owner's key, which has no box of its own. A wrong one
		// gets the same answer as a wrong friend's code.
		if (theirCode.trim().length > 12) {
			const owner = await fetch('/api/online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'owner', key: theirCode }) })
				.then((r) => r.json())
				.catch(() => null);
			if (!owner?.ok) {
				problem = "That code isn't right, or it ran out";
				return;
			}
			theirCode = '';
			adding = false;
			ownerSaved = true;
			return;
		}
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
	/** Watching along with a friend: their player leads, this one follows (a room code is for everyone controlling it). */
	async function watchAlong(watching: Watching, name: string) {
		busy = true;
		if (watching.room && together.code !== watching.room) await joinRoom(watching.room, name);
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

{#snippet theirList()}
	{#if theirFriends === null}
		<p class="faint small">…</p>
	{:else if !theirFriends.filter((person) => !person.me).length}
		<p class="faint small">{t('No other friends yet.')}</p>
	{:else}
		<ul class="theirs">
			{#each theirFriends.filter((person) => !person.me) as person (person.id)}
				<li>
					<Avatar id={person.id} name={person.name} rev={person.avatar} size={22} />
					<span class="who">{person.name}</span>
					{#if person.friend}
						<span class="faint small">{t('Your friend')}</span>
					{:else if person.requested}
						<span class="faint small">{t('Asked')}</span>
						<button type="button" class="link" onclick={() => unask(person)}>{t('Take back')}</button>
					{:else}
						<button type="button" class="btn" onclick={() => ask(person)} disabled={busy}>{person.asked ? t('Yes, be friends') : t('Ask to be friends')}</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if connected === false}
	<p class="off faint">{t('Friends online, watching together and synced progress:')} <a href="/settings/online">{t('Settings')} → Online</a>.</p>
{:else if connected}
	<section class="online">
		<div class="block">
			<div class="head">
				<h2>{t('Friends online')}</h2>
				<span class="row">
					<button type="button" class="btn" onclick={refresh} disabled={refreshing}>{refreshing ? '…' : t('Refresh')}</button>
					<button type="button" class="btn" class:btn-primary={!friends.length} onclick={openAdding} aria-expanded={adding}>{t('Add a friend')}</button>
				</span>
			</div>

			{#if requests.length}
				<ul class="rest asked">
					{#each requests as person (person.id)}
						<li>
							<Avatar id={person.id} name={person.name} rev={person.avatar} size={28} />
							<span class="who">{person.name}</span>
							<span class="what faint">{t('Asked to be friends')}</span>
							<button type="button" class="btn btn-primary" onclick={() => answerRequest(person, true)} disabled={busy}>{t('Yes')}</button>
							<button type="button" class="link" onclick={() => answerRequest(person, false)} disabled={busy}>{t('No')}</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if adding}
				<div class="adding">
					<p class="faint">{t("Give a friend your code, or type theirs. Either way you're both added.")}</p>
					<div class="row">
						<span>{t('Your code')}</span>
						{#if myCode}
							<strong class="code tabular">{myCode}</strong>
							<button type="button" class="link" onclick={copyCode}>{copied ? t('Copied') : t('Copy')}</button>
							<span class="faint small">{t('works once, for a day')}</span>
						{:else}
							<span class="faint">…</span>
						{/if}
					</div>
					<form class="row" onsubmit={addFriend}>
						<input type="text" bind:value={theirCode} placeholder={t("A friend's code")} autocomplete="off" spellcheck="false" maxlength="200" aria-label="A friend's code" />
						<button type="submit" class="btn btn-primary" disabled={!theirCode.trim()}>{t('alt:Add')}</button>
					</form>
				</div>
			{/if}
			{#if problem}<p class="msg bad">{problem}</p>{/if}
			{#if ownerSaved}<p class="msg">{t('Problem reports are in')} <a href="/settings/online">{t('Settings')} → Online</a>.</p>{/if}

			{#if watchingNow.length}
				<h3 class="label">{t('Watching now')}</h3>
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
										<button type="button" class="btn btn-primary" onclick={() => watchAlong(watching, friend.name)} disabled={busy}>{t('Watch along')}</button>
									{:else}
										<a class="btn" href={watchHref(watching)}>{t('Watch it too')}</a>
									{/if}
									<button type="button" class="link" onclick={() => showTheirFriends(friend)} aria-expanded={openFriend === friend.id}>{t('Their friends')}</button>
									<button type="button" class="link" onclick={() => removeFriend(friend)}>{t('Remove')}</button>
								</div>
								{#if openFriend === friend.id}{@render theirList()}{/if}
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
							<span class="what faint">{t('Not watching now')}</span>
							<button type="button" class="link" onclick={() => showTheirFriends(friend)} aria-expanded={openFriend === friend.id}>{t('Their friends')}</button>
							<button type="button" class="link" onclick={() => removeFriend(friend)}>{t('Remove')}</button>
							{#if openFriend === friend.id}<div class="their">{@render theirList()}</div>{/if}
						</li>
					{/each}
				</ul>
			{:else if !friends.length}
				<p class="faint">{t('Nobody yet.')}</p>
			{/if}

			{#if suggestions.length}
				<h3 class="label">{t('People your friends know')}</h3>
				<ul class="rest">
					{#each suggestions as person (person.id)}
						<li>
							<Avatar id={person.id} name={person.name} rev={person.avatar} size={28} />
							<span class="who">{person.name}</span>
							<span class="what faint">{person.mutual && person.mutual > 1 ? `${t('Knows')} ${person.via} +${person.mutual - 1}` : `${t('Knows')} ${person.via}`}</span>
							{#if person.requested}
								<span class="faint small">{t('Asked')}</span>
								<button type="button" class="link" onclick={() => unask(person)}>{t('Take back')}</button>
							{:else}
								<button type="button" class="btn" onclick={() => ask(person)} disabled={busy}>{t('Ask to be friends')}</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if switches}
				<label class="toggle">
					<input type="checkbox" checked={switches.along} onchange={(e) => setAlong(e.currentTarget.checked)} />
					{t('Let friends watch along with me')}
				</label>
				<p class="faint small">{t("Friends get a Watch along button beside what you're watching. Their screen follows yours; only you control it.")}</p>
			{/if}
		</div>

		<div class="block">
			<h2>{t('Watch together')}</h2>
			{#if together.code && together.following}
				<p>{t('Watching along with')} <strong>{together.following}</strong>. {t('Their player leads; yours follows.')}</p>
			{:else if together.code}
				<p>
					{t('Room')} <strong class="code tabular">{together.code}</strong>
				</p>
				<p class="faint small">{t("Everyone in the room controls it: anyone's play, pause and skips happen for all.")}</p>
				<p class="people">
					{#each together.people as person (person.id)}
						<span class="person"><Avatar id={person.id} name={person.name} rev={person.avatar} size={24} />{person.me ? `${person.name} ${t('(you)')}` : person.name}</span>
					{:else}
						<span class="faint">{me}</span>
					{/each}
				</p>
				{#if together.state?.title}
					<p class="what">
						{together.state.playing ? t('Playing') : t('Paused')}: {label(together.state)}
						<a class="btn btn-primary" href={watchHref(together.state)}>{t('Watch')}</a>
					</p>
				{:else}
					<p class="faint">{t('Nothing playing yet. Whoever started the room plays something; the others open it from here.')}</p>
				{/if}
				<div><button type="button" class="btn" onclick={leaveRoom}>{together.following ? t('Stop watching along') : t('Leave the room')}</button></div>
			{:else}
				<p class="faint">{t('Play, pause and skips happen in every house at once. Each house plays from its own computer.')}</p>
				<div class="row">
					<button type="button" class="btn" onclick={start} disabled={busy}>{t('Start a room')}</button>
					<form class="row" onsubmit={join}>
						<input type="text" bind:value={roomCode} placeholder={t('Room code')} autocomplete="off" spellcheck="false" maxlength="8" aria-label="Room code" />
						<button type="submit" class="btn" disabled={busy || !roomCode.trim()}>{t('Join')}</button>
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

	/* Someone who asked to be friends: set apart from the rest. */
	.asked li {
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: var(--accent-bg);
	}

	/* A friend's own friends, opened under their name. */
	.their {
		flex-basis: 100%;
		padding-left: 38px;
	}

	.theirs {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.theirs li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: 0.9rem;
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
