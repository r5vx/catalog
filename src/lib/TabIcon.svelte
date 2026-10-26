<script lang="ts">
	/**
	 * The little picture on each library tab, drawn in the tab's own text colour (the emoji that
	 * were there before came in their own colours and looked out of place). A category made by
	 * hand gets the folder.
	 */
	let { name }: { name: string } = $props();
</script>

<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#if name === 'watching'}
		<!-- play -->
		<path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
	{:else if name === 'movies'}
		<!-- film strip -->
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
	{:else if name === 'tv'}
		<!-- television -->
		<rect x="3" y="6" width="18" height="12" rx="2" />
		<path d="M8 21h8M9 2l3 4 3-4" />
	{:else if name === 'anime'}
		<!-- sparkle -->
		<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
		<path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
	{:else if name === 'friends'}
		<!-- two people -->
		<circle cx="9" cy="8" r="3.5" />
		<path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
		<path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" />
	{:else if name === 'orders'}
		<!-- list -->
		<path d="M9 6h11M9 12h11M9 18h11" />
		<circle cx="4.5" cy="6" r="1" fill="currentColor" />
		<circle cx="4.5" cy="12" r="1" fill="currentColor" />
		<circle cx="4.5" cy="18" r="1" fill="currentColor" />
	{:else if name === 'notes'}
		<!-- page with a fold -->
		<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
		<path d="M14 3v6h6M8 13h8M8 17h5" />
	{:else if name === 'all'}
		<!-- four squares -->
		<rect x="4" y="4" width="7" height="7" rx="1.5" />
		<rect x="13" y="4" width="7" height="7" rx="1.5" />
		<rect x="4" y="13" width="7" height="7" rx="1.5" />
		<rect x="13" y="13" width="7" height="7" rx="1.5" />
	{:else if name === 'browse'}
		<!-- compass -->
		<circle cx="12" cy="12" r="9" />
		<path d="M15.5 8.5l-2 5-5 2 2-5z" />
	{:else if name === 'live'}
		<!-- An aerial on a screen. -->
		<rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 3l4 5 4-5" />
	{:else if name === 'settings'}
		<!-- sliders -->
		<path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
		<circle cx="16" cy="7" r="2" />
		<circle cx="10" cy="17" r="2" />
	{:else}
		<!-- folder -->
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
	{/if}
</svg>

<style>
	svg {
		flex: none;
		opacity: 0.75;
	}
</style>
