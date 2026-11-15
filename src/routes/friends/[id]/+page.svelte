<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import BackBar from '$lib/BackBar.svelte';
	import TitleShelf from '$lib/TitleShelf.svelte';
	import { wording } from '$lib/altText';
	import { openChat } from '$lib/chat.svelte';
	import { together, joinRoom } from '$lib/watchTogether.svelte';
	import { watchHref, monthYear } from '$lib/friendLinks';
	import type { Titled } from './+page.server';

	/**
	 * Someone's profile (owner, 2026-11-15: "view profile ... show when the user joined catalog and
	 * maybe show their highest rated stuff"): their picture and name, when they joined, a line or two
	 * they wrote, their favorites, their best rated, what they watched lately, their friends, and
	 * the way to their whole library. Your own has Edit profile.
	 */
	let { data } = $props();
	const person = $derived(data.profile);
	const t = (text: string) => wording(page.data.altMode, text);

	type Known = { id: string; name: string; avatar: number; me?: boolean; friend?: boolean; requested?: boolean; asked?: boolean };
	let theirFriends = $state<Known[] | null>(null);
	let note = $state('');

	$effect(() => {
		const id = person.id;
		theirFriends = null;
		if (person.me) return;
		fetch(`/api/online/c/friends/${id}/friends`)
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => id === person.id && (theirFriends = answer?.friends ?? []))
			.catch(() => (theirFriends = []));
	});

	async function ask(other: Known) {
		const answer = await fetch('/api/online/c/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: other.id }) })
			.then((r) => r.json())
			.catch(() => null);
		if (theirFriends) theirFriends = theirFriends.map((one) => (one.id === other.id ? { ...one, requested: !answer?.friends, friend: Boolean(answer?.friends) } : one));
	}

	async function watchAlong() {
		const w = person.watching;
		if (!w) return;
		if (w.room && together.code !== w.room) await joinRoom(w.room, person.name);
		await goto(watchHref(w));
	}

	const added = (title: string, ok: boolean) => (note = ok ? `${title}: ${t('added to Want to watch')}` : t("Couldn't add it"));
	const label = (w: { title: string; type: string; season: number; episode: number }) => (w.type === 'tv' && w.season ? `${w.title} S${w.season}E${w.episode}` : w.title);
	const color = $derived(/^#[0-9a-f]{6}$/i.test(person.color) ? person.color : 'var(--accent)');

	/* ---------------------------------------------------------- editing your own */

	let editing = $state(false);
	let bio = $state('');
	let pickedColor = $state('');
	let favorites = $state<Titled[]>([]);
	let search = $state('');
	let found = $state<Titled[]>([]);
	let saving = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function startEditing() {
		bio = person.bio;
		pickedColor = person.color || '';
		favorites = [...person.favorites];
		search = '';
		found = [];
		editing = true;
	}

	function lookFor(text: string) {
		search = text;
		clearTimeout(searchTimer);
		if (text.trim().length < 2) {
			found = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const answer = await fetch(`/api/search?q=${encodeURIComponent(text)}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			type Result = { source: string; sourceId: string; title: string; year: number | null; posterUrl: string | null; categorySlug: string };
			found = ((answer?.results ?? []) as Result[]).slice(0, 8).map((r) => ({
				key: `${r.source}:${r.sourceId}`,
				title: r.title,
				year: r.year ? String(r.year) : '',
				type: r.categorySlug === 'movies' ? 'movie' : 'tv',
				poster: r.posterUrl ?? ''
			}));
		}, 300);
	}

	function addFavorite(item: Titled) {
		if (favorites.length >= 8 || favorites.some((one) => one.key === item.key)) return;
		favorites = [...favorites, item];
		search = '';
		found = [];
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		const response = await fetch('/api/online/c/profile', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bio, color: pickedColor, favorites })
		}).catch(() => null);
		saving = false;
		if (response?.ok) {
			editing = false;
			await invalidateAll();
		} else note = t("Couldn't save it");
	}
</script>

<svelte:head><title>{person.name} · Catalog</title></svelte:head>

<BackBar href="/?cat=friends" label="Friends" />

<article class="profile" style:--profile={color}>
	<header>
		<div class="band" aria-hidden="true"></div>
		<div class="who">
			<Avatar id={person.id} name={person.name} rev={person.avatar} size={112} />
			<div class="names">
				<h1>{person.name}</h1>
				<p class="faint">
					{t('Joined Catalog')} {monthYear(person.joined)}
					{#if person.friendsSince} · {t('Friends since')} {monthYear(person.friendsSince)}{/if}
					{#if person.mutual} · {person.mutual} {person.mutual === 1 ? t('friend in common') : t('friends in common')}{/if}
				</p>
				{#if person.watching}
					<p class="now"><span class="dot" aria-hidden="true"></span>{t('Watching')} <strong>{label(person.watching)}</strong></p>
				{/if}
			</div>
		</div>
		<div class="row">
			{#if person.me}
				<button type="button" class="btn btn-primary" onclick={startEditing}>{t('Edit profile')}</button>
			{:else}
				{#if person.watching?.room}<button type="button" class="btn btn-primary" onclick={watchAlong}>{t('Watch along')}</button>{/if}
				<button type="button" class="btn" onclick={() => openChat({ id: person.id, name: person.name })}>{t('Whisper')}</button>
				<a class="btn" href="/messages?with={person.id}">{t('Messages')}</a>
			{/if}
			<a class="btn" href="/friends/{person.id}/library">{person.me ? t('My library as friends see it') : t('View their library')}</a>
		</div>
	</header>

	{#if editing}
		<form class="edit" onsubmit={save}>
			<label>
				<span class="label">{t('About you')}</span>
				<textarea bind:value={bio} maxlength="300" rows="3" placeholder={t('A line or two friends see on your profile')}></textarea>
			</label>
			<label class="color">
				<span class="label">{t('Color')}</span>
				<input type="color" value={pickedColor || '#e994c2'} oninput={(e) => (pickedColor = e.currentTarget.value)} />
				{#if pickedColor}<button type="button" class="link" onclick={() => (pickedColor = '')}>{t('Use the accent')}</button>{/if}
			</label>
			<div>
				<span class="label">{t('Favorites')} ({favorites.length}/8)</span>
				<ul class="picked">
					{#each favorites as item (item.key)}
						<li>
							{#if item.poster}<img src={item.poster} alt="" />{/if}
							<span>{item.title} <span class="faint">{item.year}</span></span>
							<button type="button" class="link" onclick={() => (favorites = favorites.filter((one) => one.key !== item.key))}>{t('Remove')}</button>
						</li>
					{/each}
				</ul>
				{#if favorites.length < 8}
					<input type="search" value={search} oninput={(e) => lookFor(e.currentTarget.value)} placeholder={t('Find a film or show to add')} aria-label="Find a favorite" />
					{#if found.length}
						<ul class="found">
							{#each found as item (item.key)}
								<li><button type="button" class="link plain" onclick={() => addFavorite(item)}>{item.title} <span class="faint">{item.year}</span></button></li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
			<div class="row">
				<button type="submit" class="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save')}</button>
				<button type="button" class="btn" onclick={() => (editing = false)}>{t('Cancel')}</button>
			</div>
		</form>
	{:else if person.bio}
		<p class="bio">{person.bio}</p>
	{/if}

	{#if note}<p class="msg">{note}</p>{/if}

	<p class="counts">
		<span><strong class="tabular">{person.counts.total}</strong> {t('watched')}</span>
		<span><strong class="tabular">{person.counts.films}</strong> {t('films')}</span>
		<span><strong class="tabular">{person.counts.shows}</strong> {t('shows')}</span>
		<span><strong class="tabular">{person.counts.rated}</strong> {t('rated')}</span>
	</p>

	{#if person.favorites.length}
		<section>
			<h2 class="label">{t('Favorites')}</h2>
			<TitleShelf items={person.favorites} onadded={added} />
		</section>
	{/if}

	{#if person.top.length}
		<section>
			<h2 class="label">{t('Highest rated')}</h2>
			<TitleShelf items={person.top} onadded={added} />
		</section>
	{/if}

	{#if person.recent.length}
		<section>
			<h2 class="label">{t('Watched lately')}</h2>
			<TitleShelf items={person.recent} onadded={added} />
		</section>
	{/if}

	{#if !person.top.length && !person.recent.length && !person.favorites.length}
		<p class="faint">{person.me ? t("Rate what you've watched and it shows here.") : t('Nothing to show yet.')}</p>
	{/if}

	{#if !person.me && theirFriends?.filter((one) => !one.me).length}
		<section>
			<h2 class="label">{t('Their friends')}</h2>
			<ul class="people">
				{#each theirFriends.filter((one) => !one.me) as other (other.id)}
					<li>
						<Avatar id={other.id} name={other.name} rev={other.avatar} size={36} />
						{#if other.friend}
							<a href="/friends/{other.id}">{other.name}</a>
						{:else}
							<span>{other.name}</span>
							{#if other.requested}
								<span class="faint small">{t('Asked')}</span>
							{:else}
								<button type="button" class="btn" onclick={() => ask(other)}>{other.asked ? t('Yes, be friends') : t('Ask to be friends')}</button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</article>

<style>
	.profile {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding-bottom: 40px;
	}

	header {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 20px 20px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	/* A strip of their color across the top. */
	.band {
		height: 90px;
		margin: 0 -20px -56px;
		background: linear-gradient(120deg, var(--profile), color-mix(in srgb, var(--profile) 35%, var(--surface)));
	}

	.who {
		display: flex;
		align-items: flex-end;
		gap: 18px;
		flex-wrap: wrap;
	}

	.who :global(.avatar) {
		border: 4px solid var(--surface);
		box-sizing: content-box;
	}

	.names {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding-bottom: 6px;
	}

	h1 {
		margin: 0;
		font-size: 1.9rem;
	}

	p {
		margin: 0;
	}

	.now {
		font-size: 0.95rem;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
		background: var(--good, #3c9);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.bio {
		font-size: 1.02rem;
		white-space: pre-line;
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 22px;
		color: var(--ink-soft);
	}

	.counts strong {
		color: var(--ink);
		font-size: 1.15rem;
	}

	.label {
		display: block;
		margin: 0 0 10px;
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 22px;
	}

	.people li {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.edit textarea {
		width: 100%;
		resize: vertical;
	}

	.color {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.color .label {
		margin: 0;
	}

	.color input {
		width: 48px;
		height: 32px;
		padding: 2px;
	}

	.picked,
	.found {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 8px;
	}

	.picked li {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.picked img {
		width: 28px;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 3px;
	}

	.found {
		margin-top: 6px;
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

	.link.plain {
		color: var(--ink);
		font-size: 0.92rem;
		text-decoration: none;
		text-align: left;
	}

	.link.plain:hover {
		color: var(--accent);
	}

	.small {
		font-size: 0.85rem;
	}
</style>
