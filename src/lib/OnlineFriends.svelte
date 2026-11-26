<script lang="ts">
	import { onDestroy, onMount, untrack, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import StyledName from '$lib/StyledName.svelte';
	import type { NameStyle } from '$lib/nameStyle';
	import ContextMenu, { menuAt, type MenuItem } from '$lib/ContextMenu.svelte';
	import { wording } from '$lib/altText';
	import { together, startRoom, joinRoom, leaveRoom, rejoinKeptRoom, alongChanged } from '$lib/watchTogether.svelte';
	import { chat, sendMessage, openChat, roomInviteText } from '$lib/chat.svelte';
	import { watchHref, wantToWatch } from '$lib/friendLinks';

	/**
	 * Friends online (src/lib/server/online.ts), at the top of the library's Friends: each friend as
	 * a card (picture, name, what they're watching), with View profile (/friends/<id>) and, when
	 * they're watching, Watch along (falls in step with them, like listening along on Spotify),
	 * Start it myself, or Want to watch. Right-click a card for all of it. Below: adding a friend,
	 * people friends know, and watching together by room code with the room's chat
	 * (src/lib/watchTogether.svelte.ts, src/lib/chat.svelte.ts).
	 * Nothing shows until this Catalog is online (Settings → Online).
	 */
	type Watching = { title: string; type: 'tv' | 'movie'; year: string; season: number; episode: number; poster: string; room?: string };
	type Friend = { id: string; name: string; avatar: number; watching: Watching | null; nameStyle?: NameStyle | null; state?: FriendState | null; banner?: number; code?: string | null };
	/** The status they picked beside My profile, as the meeting point works it out (null: an older Catalog). */
	type FriendState = 'online' | 'away' | 'dnd' | 'offline';
	const STATE_WORDS: Record<FriendState, string> = { online: 'Online', away: 'Away', dnd: 'Do not disturb', offline: 'Offline' };
	type Switches = { reports: boolean; share: boolean; shared: boolean; along: boolean; autoJoin?: boolean };
	/** Someone a friend knows ("Bob, a friend of Ann's"). */
	type Known = { id: string; name: string; avatar: number; via?: string; mutual?: number; requested?: boolean };
	type FriendsAnswer = { me?: { id?: string; name: string; avatar?: number }; friends?: Friend[]; requests?: Known[]; suggestions?: Known[] };

	/**
	 * What the page had to hand (src/routes/+page.server.ts `friendsStart`): whether this Catalog is
	 * online and the last answer about friends, shown at once and then asked for afresh.
	 */
	let { initial = null }: { initial?: { online: boolean; friends: unknown } | null } = $props();
	const kept = untrack(() => (initial?.friends ?? null) as FriendsAnswer | null);

	let connected = $state<boolean | null>(untrack(() => (initial ? (initial.online ? true : false) : null)));
	let me = $state(kept?.me ?? null);
	let friends = $state<Friend[]>(kept?.friends ?? []);
	let requests = $state<Known[]>(kept?.requests ?? []);
	let suggestions = $state<Known[]>(kept?.suggestions ?? []);
	let switches = $state<Switches | null>(null);
	let adding = $state(false);
	let myCode = $state('');
	let copied = $state(false);
	let theirCode = $state('');
	/** The owner's key was typed in the friend's-code box and was right. */
	let ownerSaved = $state(false);
	let roomCode = $state('');
	let problem = $state('');
	let note = $state('');
	let busy = $state(false);
	let menu = $state<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
	let groupLine = $state('');
	let groupList = $state<HTMLUListElement | null>(null);
	let timer: ReturnType<typeof setInterval> | undefined;

	/** A line in the alternate wording when it's on (Settings → Personalization → Code), else as it is. */
	const t = (text: string) => wording(page.data.altMode, text);

	/** Watching now first, then everyone else, by name. */
	// Watching first, then the ones around (online, away, do not disturb), then the rest.
	const around = (f: Friend) => (f.watching ? 2 : f.state && f.state !== 'offline' ? 1 : 0);
	const ordered = $derived([...friends].sort((a, b) => around(b) - around(a) || a.name.localeCompare(b.name)));

	const cloud = (path: string, method = 'GET', body?: unknown) =>
		fetch(`/api/online/c/${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
			.then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
			.catch(() => ({ ok: false, status: 0, data: null }));

	/** When the list was last asked for (the timer above asks again only when it's due). */
	let lastLoad = 0;

	async function load() {
		lastLoad = Date.now();
		const answer = await cloud('friends');
		// (Not online: this Catalog hasn't joined, which the server side answers as "not yet".)
		connected = answer.ok ? true : answer.status === 0 || /isn't online/.test(answer.data?.error ?? '') ? false : connected;
		if (!answer.ok) return;
		me = answer.data.me ?? null;
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
		await load();
	}

	async function unask(person: Known) {
		await cloud('friends/unrequest', 'POST', { to: person.id });
		await load();
	}

	/** Yes or no to someone who asked. */
	async function answerRequest(person: Known, yes: boolean) {
		busy = true;
		await cloud('friends/answer', 'POST', { from: person.id, yes });
		busy = false;
		await load();
	}

	onMount(() => {
		load();
		rejoinKeptRoom();
		fetch('/api/online?light=1')
			.then((r) => (r.ok ? r.json() : null))
			.then((status) => (switches = status?.switches ?? null))
			.catch(() => {});
		// Asked again every 30 s while it's on screen (every 2 minutes while Catalog is behind other
		// windows), and as soon as it's looked at again: "watching now" stayed after a friend had
		// stopped (owner, 2026-11-15). It was every 15 s, a fifth of all the server was asked that day.
		timer = setInterval(() => {
			const due = document.hasFocus() ? 30_000 : 120_000;
			if (!document.hidden && connected && Date.now() - lastLoad >= due - 1000) load();
		}, 5000);
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
		// (Not again within 10 s: clicking back and forth between windows asked every time.)
		if (!document.hidden && connected && Date.now() - lastLoad > 10_000) void load();
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

	/** Your own friend code: the same one every time (`fresh`: a new one, and the old one stops working). */
	async function newCode(fresh = false) {
		const answer = await cloud('friends/code', 'POST', fresh ? { fresh: true } : {});
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

	/** A friend's code onto the clipboard, to send to someone else who wants to add them. */
	async function copyTheirCode(friend: Friend) {
		try {
			await navigator.clipboard.writeText(friend.code ?? '');
			note = `${friend.name}${t("'s friend code copied")}: ${friend.code}`;
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
			await invalidateAll();
			return;
		}
		const answer = await cloud('friends/add', 'POST', { code: theirCode });
		if (!answer.ok) {
			problem = answer.data?.error ?? "That code didn't work";
			return;
		}
		theirCode = '';
		note = answer.data?.name ? `${answer.data.name} ${t('is your friend now')}` : '';
		// (The add-a-friend part stays open, for the next friend, and your code stays the same.)
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

	/** Watching along with a friend: into their room, then their film or episode opens here at their place and follows their player. */
	async function watchAlong(watching: Watching, name: string) {
		busy = true;
		if (watching.room && together.code !== watching.room) await joinRoom(watching.room, name);
		busy = false;
		await goto(watchHref(watching));
	}

	/** The same film or episode, on its own here: from your own place, not in step with them. */
	async function startMyself(watching: Watching) {
		// (Still in their room, the player would fall in step with them.)
		if (together.code && together.code === watching.room) leaveRoom();
		await goto(watchHref(watching));
	}

	/** A click on a friend's card, not on one of its buttons or links: their profile. */
	function openProfile(event: MouseEvent, friend: Friend) {
		if ((event.target as HTMLElement).closest('a, button')) return;
		void goto(`/friends/${friend.id}`);
	}

	/**
	 * Asks a friend to watch together: into a room first (a new one, unless already in one), then a
	 * whisper with its code. Their Catalog shows Join beside it (src/lib/chat.svelte.ts inviteRoom).
	 */
	async function invite(friend: Friend) {
		busy = true;
		problem = '';
		note = '';
		try {
			if (!together.code && !(await startRoom())) {
				problem = t("Couldn't start a room");
				return;
			}
			const sent = await sendMessage(roomInviteText(together.code), { friend: friend.id });
			if (sent) note = `${t('Invited')} ${friend.name} · ${t('room')} ${together.code}`;
			else problem = t("The invite couldn't be sent");
		} finally {
			busy = false;
		}
	}

	async function addWanted(watching: Watching) {
		note = (await wantToWatch(watching)) ? `${watching.title}: ${t('added to Want to watch')}` : '';
		problem = note ? '' : t("Couldn't add it");
	}

	function friendMenu(event: MouseEvent, friend: Friend) {
		const w = friend.watching;
		const items: MenuItem[] = [
			{ label: t('View profile'), run: () => goto(`/friends/${friend.id}`) },
			{ label: t('View their library'), run: () => goto(`/friends/${friend.id}/library`) },
			{ label: `${t('Whisper to')} ${friend.name}`, run: () => openChat(friend) },
			{ label: t('Invite to watch together'), run: () => invite(friend) },
			...(friend.code ? [{ label: `${t('Copy friend code')} · ${friend.code}`, run: () => copyTheirCode(friend) }] : []),
			{ label: t('Messages'), run: () => goto(`/messages?with=${friend.id}`) }
		];
		if (w) {
			items.push('-');
			if (w.room) items.push({ label: t('Watch along'), run: () => watchAlong(w, friend.name) });
			items.push({ label: t('Start it myself'), run: () => startMyself(w) }, { label: t('Add to Want to watch'), run: () => addWanted(w) });
		}
		items.push('-', { label: t('Remove friend'), run: () => removeFriend(friend), danger: true });
		menu = { at: menuAt(event, items.length), items };
	}

	/** The ⋯ button beside Watch along: the other ways to watch it. */
	function watchMenu(event: MouseEvent, friend: Friend) {
		const w = friend.watching!;
		const items: MenuItem[] = [
			...(w.room ? [{ label: t('Watch along'), run: () => watchAlong(w, friend.name) }] : []),
			{ label: t('Start it myself'), run: () => startMyself(w) },
			{ label: t('Add to Want to watch'), run: () => addWanted(w) }
		];
		menu = { at: menuAt(event, items.length), items };
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

	async function sendGroup(event: SubmitEvent) {
		event.preventDefault();
		if (!groupLine.trim() || !together.code) return;
		const sent = await sendMessage(groupLine, { room: together.code });
		if (sent) groupLine = '';
		else problem = t("Couldn't send it");
	}

	// The group chat stays scrolled to its newest line.
	$effect(() => {
		void chat.room.length;
		void tick().then(() => groupList && (groupList.scrollTop = groupList.scrollHeight));
	});

	const label = (w: { title: string; type: string; season: number; episode: number }) => (w.type === 'tv' && w.season ? `${w.title} S${w.season}E${w.episode}` : w.title);
	const clock = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
</script>

{#if connected === false}
	<p class="off faint">{t('Friends online, watching together and synced progress:')} <a href="/settings/online">{t('Settings')} → Online</a>.</p>
{:else if connected}
	<section class="friends">
		<div class="head">
			<h2>{t('Friends')}</h2>
			<span class="row">
				{#if me?.id}<a class="btn" href="/friends/{me.id}">{t('My profile')}</a>{/if}
				<a class="btn" href="/messages">
					{t('Messages')}
					{#if chat.unread}<span class="badge">{chat.unread}</span>{/if}
				</a>
				<button type="button" class="btn" onclick={refresh} disabled={refreshing}>{refreshing ? '…' : t('Refresh')}</button>
				<button type="button" class="btn" class:btn-primary={!friends.length} onclick={openAdding} aria-expanded={adding}>{t('Add a friend')}</button>
			</span>
		</div>

		{#if requests.length}
			<ul class="asked">
				{#each requests as person (person.id)}
					<li>
						<Avatar id={person.id} name={person.name} rev={person.avatar} size={32} />
						<span class="who">{person.name}</span>
						<span class="faint">{t('Asked to be friends')}</span>
						<button type="button" class="btn btn-primary" onclick={() => answerRequest(person, true)} disabled={busy}>{t('Yes')}</button>
						<button type="button" class="link" onclick={() => answerRequest(person, false)} disabled={busy}>{t('No')}</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if adding}
			<div class="adding">
				<p class="faint">{t("Give a friend your code, or type theirs. Either way you're both added. Your code stays the same.")}</p>
				<div class="row">
					<span>{t('Your code')}</span>
					{#if myCode}
						<strong class="code tabular">{myCode}</strong>
						<button type="button" class="link" onclick={copyCode}>{copied ? t('Copied') : t('Copy')}</button>
						<span class="faint small">{t('yours to keep')}</span>
						<button type="button" class="link" onclick={() => newCode(true)} title={t('The old code stops working')}>{t('New code')}</button>
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
		{#if note}<p class="msg">{note}</p>{/if}
		{#if ownerSaved}<p class="msg">{t('Problem reports are in')} <a href="/settings/owner">{t('Settings')} → Owner</a>.</p>{/if}

		{#if ordered.length}
			<ul class="cards">
				{#each ordered as friend (friend.id)}
					{@const watching = friend.watching}
					<!-- Watching counts as online; no word from them (an older Catalog) counts as offline. -->
					{@const dot = watching ? (friend.state && friend.state !== 'offline' ? friend.state : 'online') : (friend.state ?? 'offline')}
					<!-- A click anywhere on the card (but its buttons) opens their profile; the picture and name are links too. -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
					<!-- Their banner (set on their profile) fills the card, darkened so the words stay readable. -->
					<li
						class="card"
						class:live={watching}
						class:has-banner={Boolean(friend.banner)}
						style:background-image={friend.banner ? `url('/api/online/banner/${friend.id}?v=${friend.banner}')` : null}
						oncontextmenu={(e) => friendMenu(e, friend)}
						onclick={(e) => openProfile(e, friend)}
					>
						<a class="face" href="/friends/{friend.id}" aria-label="{friend.name}'s profile">
							<Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={72} />
							<span class="state-dot {dot}" title={t(STATE_WORDS[dot])}></span>
						</a>
						<div class="about">
							<a class="name" href="/friends/{friend.id}"><StyledName name={friend.name} look={friend.nameStyle ?? null} /></a>
							{#if watching}
								<span class="now"><span class="dot" aria-hidden="true"></span>{t('Watching')} <strong>{label(watching)}</strong></span>
							{/if}
							{#if watching}
								<div class="row">
									{#if watching.room}
										<button type="button" class="btn btn-primary small-btn" onclick={() => watchAlong(watching, friend.name)} disabled={busy}>{t('Watch along')}</button>
									{:else}
										<button type="button" class="btn btn-primary small-btn" onclick={() => startMyself(watching)}>{t('Watch it too')}</button>
									{/if}
									<button type="button" class="btn small-btn more" onclick={(e) => watchMenu(e, friend)} aria-label="More ways to watch it" title="More">⋯</button>
								</div>
							{/if}
						</div>
						<!-- Invite to watch together: a small round button in the corner, its words on hover. -->
						<button type="button" class="invite" onclick={() => invite(friend)} disabled={busy} title={t('Invite to watch together')} aria-label={t('Invite to watch together')}>
							<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<circle cx="9" cy="8" r="3.5" />
								<path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
								<path d="M19 8v6M16 11h6" />
							</svg>
						</button>
						{#if watching?.poster}<img class="poster" src={watching.poster} alt="" />{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="faint">{t('Nobody yet.')}</p>
		{/if}

		{#if suggestions.length}
			<h3 class="label">{t('People your friends know')}</h3>
			<ul class="rest">
				{#each suggestions as person (person.id)}
					<li>
						<Avatar id={person.id} name={person.name} rev={person.avatar} size={32} />
						<span class="who">{person.name}</span>
						<span class="faint small">{person.mutual && person.mutual > 1 ? `${t('Knows')} ${person.via} +${person.mutual - 1}` : `${t('Knows')} ${person.via}`}</span>
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
		{/if}
	</section>

	<section class="together">
		<h2>{t('Watch together')}</h2>
		{#if together.code}
			<div class="room">
				<div class="room-side">
					{#if together.following}
						<p>{t('Watching along with')} <strong>{together.following}</strong>. {t('Their player leads; yours follows.')}</p>
					{:else}
						<p>{t('Room')} <strong class="code tabular">{together.code}</strong></p>
						<p class="faint small">{t("Everyone in the room controls it: anyone's play, pause and skips happen for all.")}</p>
					{/if}
					<p class="people">
						{#each together.people as person (person.id)}
							<span class="person"><Avatar id={person.id} name={person.name} rev={person.avatar} size={26} />{person.me ? `${person.name} ${t('(you)')}` : person.name}</span>
						{:else}
							<span class="faint">{me?.name ?? ''}</span>
						{/each}
					</p>
					{#if together.notice}<p class="faint small" role="status">{together.notice}</p>{/if}
					{#if together.state?.title}
						<p class="what">
							{together.state.playing ? t('Playing') : together.state.waiting ? t('Loading') : t('Paused')}: {label(together.state)}
							<a class="btn btn-primary" href={watchHref(together.state)}>{t('Join in')}</a>
						</p>
					{:else}
						<p class="faint">{t('Nothing playing yet. When someone starts something, everyone in the room is asked to join.')}</p>
					{/if}
					<div><button type="button" class="btn" onclick={() => leaveRoom()}>{together.following ? t('Stop watching along') : t('Leave the room')}</button></div>
				</div>
				<div class="group">
					<h3 class="label">{t('Group chat')}</h3>
					<ul class="lines" bind:this={groupList}>
						{#each chat.room as message (message.id)}
							<li class:mine={message.mine}>
								<span class="faint small">{clock(message.at)}</span>
								<strong>{message.mine ? t('You') : message.name}</strong>
								<span data-plain>{message.text}</span>
							</li>
						{:else}
							<li class="faint small">{t('Nothing said yet. Press Enter anywhere, even in the player, to say something.')}</li>
						{/each}
					</ul>
					<form class="row" onsubmit={sendGroup}>
						<input type="text" bind:value={groupLine} maxlength="500" autocomplete="off" placeholder={t('Message the group')} aria-label="Message the group" />
						<button type="submit" class="btn" disabled={!groupLine.trim()}>{t('Send')}</button>
					</form>
				</div>
			</div>
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
	</section>
{/if}

{#if menu}<ContextMenu at={menu.at} items={menu.items} close={() => (menu = null)} />{/if}

<style>
	.off {
		margin: 0 0 16px;
		font-size: 0.9rem;
	}

	.friends,
	.together {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-bottom: 22px;
		padding: 18px 20px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px;
	}

	h2 {
		margin: 0;
		font-size: 1.35rem;
	}

	.together h2 {
		font-size: 1.1rem;
	}

	h3 {
		margin: 4px 0 0;
	}

	p {
		margin: 0;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.badge {
		display: inline-block;
		min-width: 18px;
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 18px;
		text-align: center;
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

	.asked,
	.rest {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.asked li,
	.rest li {
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

	/* Each friend: a big picture, their name, what they're watching, and the buttons. */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: 12px;
	}

	.card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 104px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--sunk);
		overflow: hidden;
		cursor: pointer;
	}

	.card:hover {
		border-color: var(--rule-firm);
	}

	/* Their banner across the card, darkened toward the left where the words are. */
	.card.has-banner {
		background-size: cover;
		background-position: center;
	}
	.card.has-banner::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, rgb(0 0 0 / 82%) 0%, rgb(0 0 0 / 62%) 55%, rgb(0 0 0 / 38%) 100%);
		pointer-events: none;
	}
	.card.has-banner .name,
	.card.has-banner .now {
		color: #fff;
	}
	/* A shadow around the drawn letters themselves: a text-shadow muddied gradient names (it's
	   painted over their see-through letters), and colored names were lost on a busy banner. */
	.card.has-banner .name {
		filter: drop-shadow(0 1px 1px rgb(0 0 0 / 95%)) drop-shadow(0 0 5px rgb(0 0 0 / 80%));
	}
	.card.has-banner .now {
		text-shadow: 0 1px 2px rgb(0 0 0 / 95%), 0 0 6px rgb(0 0 0 / 70%);
	}
	.card.has-banner .state-dot {
		border-color: #222;
	}

	/* The card's own buttons stay small. */
	.card .small-btn {
		padding: 4px 12px;
		font-size: 0.82rem;
	}

	/* Invite to watch together, small and round in the card's top right. */
	.invite {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: 50%;
		background: color-mix(in srgb, var(--surface) 85%, transparent);
		color: var(--ink-soft);
		cursor: pointer;
	}
	.invite:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.card.live {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--rule));
	}

	.face {
		position: relative;
		flex: none;
		border-radius: 50%;
	}

	/* Their status, on the corner of their picture (colors: top of app.css). */
	.state-dot {
		position: absolute;
		right: 2px;
		bottom: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 3px solid var(--sunk);
		background: var(--status-online);
	}
	.state-dot.away { background: var(--status-away); }
	.state-dot.dnd { background: var(--status-dnd); }
	.state-dot.offline { background: var(--status-offline); }

	.about {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.name {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--ink);
		text-decoration: none;
	}

	.name:hover {
		color: var(--accent);
	}

	.now {
		font-size: 0.92rem;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
		background: var(--good, #3c9);
		vertical-align: 1px;
	}

	/* What they're watching, faded in behind the right side of the card. */
	.poster {
		position: absolute;
		top: 0;
		right: 0;
		height: 100%;
		width: 34%;
		object-fit: cover;
		opacity: 0.28;
		mask-image: linear-gradient(to left, #000 30%, transparent);
		-webkit-mask-image: linear-gradient(to left, #000 30%, transparent);
		pointer-events: none;
	}

	.more {
		padding-inline: 10px;
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}

	.row input {
		width: 11rem;
	}

	/* The room: who and what on one side, its chat on the other (one under the other on a phone). */
	.room {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
		gap: 18px;
	}

	.room-side,
	.group {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 240px;
		min-height: 80px;
		overflow-y: auto;
		padding: 10px;
		border-radius: var(--radius-sm);
		background: var(--sunk);
		font-size: 0.92rem;
	}

	.lines li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		overflow-wrap: anywhere;
	}

	.lines li.mine strong {
		color: var(--accent);
	}

	.group form input {
		flex: 1;
		width: auto;
		min-width: 0;
	}

	.group form {
		flex-wrap: nowrap;
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

	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.code {
		font-size: 1.15rem;
		letter-spacing: 0.08em;
	}

	.toggle {
		display: inline-flex;
		align-self: flex-start;
		max-width: 100%;
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
