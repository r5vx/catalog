<script lang="ts">
	/**
	 * A closed section on a title's page: its name and what's inside on one line, opened with a
	 * click. Keeps the extras (where to watch, awards, tags) from crowding the page.
	 */
	import type { Snippet } from 'svelte';

	let {
		title,
		sub = '',
		onopen,
		children
	}: { title: string; sub?: string; /** The first time it's opened (to load what's inside only then). */ onopen?: () => void; children: Snippet } = $props();
	let opened = false;
	function toggled(e: Event) {
		if (opened || !(e.currentTarget as HTMLDetailsElement).open) return;
		opened = true;
		onopen?.();
	}
</script>

<details class="fold" ontoggle={toggled}>
	<summary>
		<span class="title">{title}</span>
		{#if sub}<span class="sub faint">{sub}</span>{/if}
	</summary>
	<div class="body">
		{@render children()}
	</div>
</details>

<style>
	.fold {
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	summary {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
		padding: 14px 18px;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	/* A caret that turns, drawn rather than imported (the same as More details). */
	summary::before {
		content: '';
		width: 7px;
		height: 7px;
		border-right: 2px solid var(--ink-faint);
		border-bottom: 2px solid var(--ink-faint);
		transform: rotate(-45deg);
		transition: transform 0.15s ease;
		flex: none;
		align-self: center;
	}

	.fold[open] summary::before {
		transform: rotate(45deg);
	}

	summary:hover .title {
		color: var(--accent);
	}

	.title {
		font-weight: 600;
	}

	.sub {
		font-size: 0.83rem;
	}

	.body {
		padding: 4px 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	@media (max-width: 620px) {
		.body {
			padding-inline: 14px;
		}
	}
</style>
