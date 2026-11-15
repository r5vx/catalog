<script lang="ts">
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import BackBar from '$lib/BackBar.svelte';
	import TitleShelf from '$lib/TitleShelf.svelte';
	import { wording } from '$lib/altText';

	/**
	 * Everything a friend has watched (their Catalog shares it while "Friends see what's being
	 * watched" is on), 120 at a time: films or shows, by rating, name or year, and a search.
	 * Right-click a title to add it to Want to watch.
	 */
	let { data } = $props();
	const t = (text: string) => wording(page.data.altMode, text);

	type Item = { key: string; title: string; rating: number | null; year: string; type: string; poster: string; status: string };

	let items = $state<Item[]>([]);
	let total = $state(0);
	let kind = $state<'' | 'movie' | 'tv'>('');
	let sort = $state<'rating' | 'title' | 'year'>('rating');
	let search = $state('');
	let loading = $state(true);
	let note = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let asked = 0;

	async function load(more = false) {
		const mine = ++asked;
		loading = true;
		const params = new URLSearchParams({ sort, offset: String(more ? items.length : 0) });
		if (kind) params.set('type', kind);
		if (search.trim()) params.set('q', search.trim());
		const answer = await fetch(`/api/online/c/people/${data.person.id}/library?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (mine !== asked) return;
		loading = false;
		if (!answer) return;
		items = more ? [...items, ...answer.items] : answer.items;
		total = answer.total;
	}

	$effect(() => {
		void kind;
		void sort;
		void data.person.id;
		void load();
	});

	function lookFor(text: string) {
		search = text;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void load(), 300);
	}

	const added = (title: string, ok: boolean) => (note = ok ? `${title}: ${t('added to Want to watch')}` : t("Couldn't add it"));
</script>

<svelte:head><title>{data.person.name}'s library · Catalog</title></svelte:head>

<BackBar href="/friends/{data.person.id}" label={data.person.me ? 'My profile' : `${data.person.name}'s profile`} />

<header>
	<Avatar id={data.person.id} name={data.person.name} rev={data.person.avatar} size={48} />
	<h1>{data.person.me ? t('My library as friends see it') : `${data.person.name}${t("'s library")}`}</h1>
	<span class="faint tabular">{total}</span>
</header>

<div class="tools">
	<div class="tabs" role="tablist">
		<button type="button" role="tab" aria-selected={kind === ''} class:on={kind === ''} onclick={() => (kind = '')}>{t('All')}</button>
		<button type="button" role="tab" aria-selected={kind === 'movie'} class:on={kind === 'movie'} onclick={() => (kind = 'movie')}>{t('Films')}</button>
		<button type="button" role="tab" aria-selected={kind === 'tv'} class:on={kind === 'tv'} onclick={() => (kind = 'tv')}>{t('Shows')}</button>
	</div>
	<select bind:value={sort} aria-label="Sort">
		<option value="rating">{t('Highest rated')}</option>
		<option value="title">{t('Name')}</option>
		<option value="year">{t('Newest')}</option>
	</select>
	<input type="search" value={search} oninput={(e) => lookFor(e.currentTarget.value)} placeholder={t('Search their library')} aria-label="Search" />
</div>

{#if note}<p class="msg">{note}</p>{/if}

{#if items.length}
	<TitleShelf {items} grid onadded={added} />
	{#if items.length < total}
		<div class="more"><button type="button" class="btn" onclick={() => load(true)} disabled={loading}>{loading ? '…' : t('Show more')}</button></div>
	{/if}
{:else if loading}
	<p class="faint">…</p>
{:else}
	<p class="faint">{search ? t('Nothing by that name.') : t("Nothing shared yet. Their Catalog sends what they've watched every few minutes.")}</p>
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 8px 0 16px;
	}

	h1 {
		margin: 0;
		font-size: 1.6rem;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 18px;
	}

	.tabs {
		display: flex;
		gap: 4px;
	}

	.tabs button {
		padding: 6px 14px;
		border: 1px solid var(--rule);
		border-radius: 100px;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.tabs button.on {
		border-color: var(--accent);
		background: var(--accent-bg);
		color: var(--ink);
	}

	.tools select {
		width: auto;
	}

	.tools input {
		width: 14rem;
		max-width: 100%;
	}

	.more {
		display: flex;
		justify-content: center;
		margin: 20px 0 40px;
	}
</style>
