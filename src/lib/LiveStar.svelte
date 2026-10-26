<script lang="ts">
	/** Live TV's save button: an outline star, filled once saved. */
	let { saved, label, onclick }: { saved: boolean; label: string; onclick: () => void } = $props();
</script>

<button type="button" class="star" class:saved {onclick} aria-pressed={saved} aria-label={saved ? `Unsave ${label}` : `Save ${label}`} title={saved ? 'Saved' : 'Save'}>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<path
			d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z"
			fill={saved ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linejoin="round"
		/>
	</svg>
</button>

<style>
	.star {
		display: grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.star:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.star.saved {
		color: var(--star);
	}
</style>
