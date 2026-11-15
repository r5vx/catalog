<script lang="ts">
	/**
	 * Someone's picture online: the one they chose in Settings → Online, or the first letter of
	 * their name on a color of their own. `rev` is the picture's number (0: they have none).
	 * The size is in pixels. The colors are the profile colors from src/lib/constants.ts.
	 */
	import { PROFILE_COLORS } from '$lib/constants';

	type Props = { id: string; name: string; rev?: number; size?: number; src?: string };
	/** `src`: a picture to show instead (one just picked, before it's saved). */
	let { id, name, rev = 0, size = 32, src = '' }: Props = $props();

	let failed = $state(false);
	const picture = $derived(src || (rev && id && !failed ? `/api/online/avatar/${id}?v=${rev}` : ''));
	const letter = $derived((name.trim()[0] ?? '?').toUpperCase());
	// The same person always gets the same color.
	const color = $derived(PROFILE_COLORS[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % PROFILE_COLORS.length]);
</script>

{#if picture}
	<img class="avatar" src={picture} alt="" title={name} style:width="{size}px" style:height="{size}px" onerror={() => (failed = true)} />
{:else}
	<span class="avatar letter" title={name} style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.45)}px" style:background={color} aria-hidden="true">{letter}</span>
{/if}

<style>
	.avatar {
		flex: none;
		display: inline-grid;
		place-items: center;
		border-radius: 50%;
		object-fit: cover;
		vertical-align: middle;
	}

	.letter {
		color: #16181a;
		font-weight: 700;
		line-height: 1;
		user-select: none;
	}
</style>
