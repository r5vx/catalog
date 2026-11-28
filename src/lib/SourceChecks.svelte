<script lang="ts">
	import type { SourceCheck } from './watchCheck';

	/** Each source being looked through for the Watch button, and how it went. */
	let { sources, anime = true, series = false }: { sources: SourceCheck[]; anime?: boolean; series?: boolean } = $props();

	const ANIME_ONLY = new Set(['Aniwave', 'HiAnime', 'AllAnime', 'KickAssAnime']);

	/** Hide anime-only sources on non-anime titles (unless they actually matched). */
	const applicable = $derived(
		sources.filter((s) => anime || !ANIME_ONLY.has(s.name) || s.state === 'yes')
	);

	const pilotCheck = (s: SourceCheck) => ['Movy', 'Vidfast', '7Movies', 'HiAnime'].includes(s.name);
	const listing = (s: SourceCheck) => s.state === 'listed' || (series && s.state === 'yes' && !pilotCheck(s));
	const found = $derived(applicable.some((source) => source.state === 'yes' || source.state === 'listed'));
	const allDone = $derived(applicable.every((s) => s.state !== 'checking'));
	let showUnavailable = $state(false);

	const visible = $derived(
		showUnavailable || !found || !allDone
			? applicable.filter((s) => s.state !== 'skipped')
			: applicable.filter((s) => s.state === 'yes' || s.state === 'listed')
	);
	const hiddenCount = $derived(
		found && allDone ? applicable.filter((s) => s.state === 'no').length : 0
	);
</script>

{#if visible.length || hiddenCount > 0}
	{#if series && found}<p class="scope-note">Sources for this series · availability varies by episode.</p>{/if}
	<ul class="source-checks" aria-label="Sources">
		{#each visible as source (source.name)}
			<li title={source.name === 'YouTube' ? (series ? 'YouTube has a matched upload for one or more episodes' : 'YouTube has a matched upload for this movie') : undefined} class={listing(source) ? 'listed' : source.state} class:quiet={found && source.state === 'checking'}>
				{#if source.state === 'checking'}
					<span class="spin" aria-hidden="true"></span>
				{:else if listing(source)}
					<span class="dot" aria-hidden="true"></span>
				{:else}
					<span aria-hidden="true">{source.state === 'yes' ? '✓' : '✕'}</span>
				{/if}
				{source.name}{series && source.state === 'yes' ? (source.pilotListed === false ? ' · other episodes' : source.pilotListed === true ? ' · S1E1 listed' : pilotCheck(source) ? ' · S1E1' : '') : ''}
			</li>
		{/each}
		{#if hiddenCount > 0}
			<li class="toggle-wrap">
				<button type="button" class="toggle-unavail" onclick={() => (showUnavailable = !showUnavailable)}>
					{showUnavailable ? 'Hide unavailable' : `+${hiddenCount} unavailable`}
				</button>
			</li>
		{/if}
	</ul>
{/if}

<style>
	.scope-note { margin: 10px 0 0; color: var(--ink-muted); font-size: .85rem; }
	.source-checks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 10px 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
		font-weight: 500;
	}

	.source-checks li {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 5px 12px;
		border: 1px solid var(--rule-firm);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		transition: border-color 0.3s, background 0.3s, color 0.3s, opacity 0.3s;
	}

	.source-checks .yes {
		border-color: var(--good);
		background: var(--good-bg);
		color: var(--good);
	}

	.source-checks .no {
		color: var(--ink-faint);
		border-color: var(--rule);
		background: transparent;
		text-decoration: line-through;
	}

	/* Still looking, but another source has it already. */
	.source-checks .quiet {
		color: var(--ink-faint);
		border-style: dashed;
		border-color: var(--rule);
		background: transparent;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
	}

	.spin {
		width: 12px;
		height: 12px;
		border: 2px solid var(--accent);
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.toggle-wrap {
		border: none !important;
		background: transparent !important;
		padding: 0 !important;
	}

	.toggle-unavail {
		padding: 4px 10px;
		border: 1px dashed var(--rule);
		border-radius: 999px;
		background: transparent;
		color: var(--ink-faint);
		font-size: 0.78rem;
		cursor: pointer;
	}

	.toggle-unavail:hover {
		color: var(--ink);
		border-color: var(--rule-firm);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
