<script lang="ts">
	import SourceCards from './SourceCards.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let copied = $state(false);

	const cards = $derived([
		{
			href: '/settings/library',
			label: 'Library',
			value: `${data.entries} ${data.entries === 1 ? 'title' : 'titles'}`,
			detail: `${data.notes} ${data.notes === 1 ? 'note' : 'notes'} · Export & storage`,
			on: undefined as boolean | undefined
		},
		{
			href: '/settings/services',
			label: 'Film & TV search',
			value: data.tmdbKeySaved ? 'Connected' : 'Off',
			detail: data.extraScores ? 'TMDB + extra scores active' : 'Configure TMDB & score sources',
			on: data.tmdbKeySaved
		},
		{
			href: '/settings/devices',
			label: 'TV & phones',
			value: data.pinSet ? 'PIN locked' : 'Open',
			detail: 'Fire TV, Roku, phones & access lock',
			on: data.pinSet
		},
		{
			href: '/settings/playback',
			label: 'Playback',
			value: 'Configure',
			detail: 'Audio, subtitles, skip & watch progress',
			on: undefined as boolean | undefined
		},
		{
			href: '/settings/personalization',
			label: 'Personalization',
			value: 'Customize',
			detail: 'Theme, accent colors & layout',
			on: undefined as boolean | undefined
		},
		{
			href: '/settings/online',
			label: 'Online',
			value: 'Profile',
			detail: 'Friends, watch together & sync',
			on: undefined as boolean | undefined
		},
		...(data.owner ? [{ href: '/settings/owner', label: 'Owner', value: 'Manage', detail: 'Source health, server use & reports', on: undefined }] : [])
	]);

	async function copyPath() {
		try {
			await navigator.clipboard.writeText(data.dbPath);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			// clipboard unavailable
		}
	}
</script>

<svelte:head><title>Settings · Catalog</title></svelte:head>

<section class="overview">
	<h2 class="label">Overview</h2>

	<div class="cards">
		{#each cards as card (card.href)}
			<a class="card" href={card.href}>
				<div class="card-top">
					<span class="card-title">{card.label}</span>
					<span class="pill" class:on={card.on === true} class:off={card.on === false}>
						{card.value}
					</span>
				</div>
				<p class="card-detail">{card.detail}</p>
			</a>
		{/each}
	</div>

	<div class="db-bar">
		<div class="db-meta">
			<span class="label db-label">Library file</span>
			<code>{data.dbPath}</code>
		</div>
		<button type="button" class="btn copy-btn" onclick={copyPath}>
			{copied ? 'Copied' : 'Copy path'}
		</button>
	</div>
</section>

<SourceCards />

<style>
	.overview {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 10px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 13px 15px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		text-decoration: none;
		transition: border-color 0.14s ease, background 0.14s ease, transform 0.14s ease;
	}

	.card:hover {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--rule));
		background: var(--surface-2);
		transform: translateY(-1px);
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.card-title {
		font-size: 0.94rem;
		font-weight: 600;
		color: var(--ink);
	}

	.pill {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.pill.on {
		color: var(--good);
		border-color: color-mix(in srgb, var(--good) 40%, transparent);
		background: color-mix(in srgb, var(--good) 12%, transparent);
	}

	.pill.off {
		color: var(--ink-faint);
	}

	.card-detail {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-faint);
		line-height: 1.4;
	}

	.db-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 11px 14px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
	}

	.db-meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.db-meta code {
		font-family: var(--mono);
		font-size: 0.78rem;
		color: var(--ink-soft);
		overflow-wrap: anywhere;
	}

	.copy-btn {
		padding: 5px 11px;
		font-size: 0.8rem;
		flex-shrink: 0;
	}
</style>
