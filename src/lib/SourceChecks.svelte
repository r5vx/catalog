<script lang="ts">
	import type { SourceCheck } from './watchCheck';

	/** Each source being looked through for the Watch button, and how it went. */
	let { sources }: { sources: SourceCheck[] } = $props();
</script>

{#if sources.length}
	<ul class="source-checks" aria-label="Sources">
		{#each sources as source (source.name)}
			<li class={source.state}>
				{#if source.state === 'checking'}
					<span class="spin" aria-hidden="true"></span>
				{:else}
					<span aria-hidden="true">{source.state === 'yes' ? '✓' : '✕'}</span>
				{/if}
				{source.name}
			</li>
		{/each}
	</ul>
{/if}

<style>
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

	.spin {
		width: 12px;
		height: 12px;
		border: 2px solid var(--accent);
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
