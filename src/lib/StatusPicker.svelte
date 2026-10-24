<script lang="ts">
	/** Watching, Completed, Want to watch…: one click. `name` puts it in a form. */
	import { STATUSES } from '$lib/constants';

	type Props = {
		value: string;
		onchange?: (value: string) => void;
		name?: string;
	};

	let { value = $bindable('completed'), onchange, name }: Props = $props();
</script>

<div class="statuses" role="radiogroup" aria-label="Status">
	{#each STATUSES as status (status.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === status.value}
			class="status {status.value}"
			class:on={value === status.value}
			onclick={() => {
				if (value === status.value) return;
				value = status.value;
				onchange?.(status.value);
			}}
		>{status.label}</button>
	{/each}
	{#if name}<input type="hidden" {name} {value} />{/if}
</div>

<style>
	.statuses {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.status {
		padding: 5px 12px;
		border: 1px solid var(--rule-firm);
		border-radius: 999px;
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.status:hover {
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.status.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	.status.on.completed {
		background: var(--good);
		border-color: var(--good);
	}

	.status.on.watching {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
</style>
