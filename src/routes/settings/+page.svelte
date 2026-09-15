<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const rows = $derived([
		{
			label: 'In your library',
			value: `${data.entries} ${data.entries === 1 ? 'title' : 'titles'}, ${data.notes} ${data.notes === 1 ? 'note' : 'notes'}`
		},
		{ label: 'Film and TV search', value: data.tmdbKeySaved ? 'On' : 'Off', on: data.tmdbKeySaved },
		{
			label: 'IMDb and Rotten Tomatoes',
			value: data.extraScores ? 'On' : 'Off',
			on: data.extraScores
		},
		{ label: 'PIN lock', value: data.pinSet ? 'On' : 'Off', on: data.pinSet }
	]);
</script>

<svelte:head><title>Settings · Catalog</title></svelte:head>

<section>
	<h2 class="label">At a glance</h2>

	<dl>
		{#each rows as row (row.label)}
			<div class="row">
				<dt>{row.label}</dt>
				<dd class:on={row.on === true} class:off={row.on === false}>{row.value}</dd>
			</div>
		{/each}
	</dl>

	<p class="faint hint">Your library file: <code>{data.dbPath}</code></p>
</section>

<style>
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 12px;
	}

	dl {
		margin: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface);
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		padding: 11px 15px;
		border-bottom: 1px solid var(--rule);
	}

	.row:last-child {
		border-bottom: none;
	}

	dt {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.on {
		color: var(--good);
	}

	.off {
		color: var(--ink-faint);
	}

	.hint {
		font-size: 0.76rem;
		margin: 12px 0 0;
		overflow-wrap: anywhere;
	}

	.hint code {
		font-family: var(--mono);
	}
</style>
