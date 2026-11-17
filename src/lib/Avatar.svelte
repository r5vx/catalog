<script lang="ts">
	/**
	 * Someone's picture online: the one they chose in Settings → Online, or the first letter of
	 * their name on a color of their own. `rev` is the picture's number (0: they have none).
	 * The size is in pixels. The colors are the profile colors from src/lib/constants.ts.
	 */
	import { letterColor } from '$lib/avatarColor';

	type Props = { id: string; name: string; rev?: number; size?: number; src?: string };
	/** `src`: a picture to show instead (one just picked, before it's saved). */
	let { id, name, rev = 0, size = 32, src = '' }: Props = $props();

	// A picture that didn't load is tried again (15 s, 30 s, 45 s later): one failed load used to
	// leave the letter for as long as the page stayed open (a friend's own picture in the top bar
	// came and went, 2026-11-16, while the server was refusing).
	let failedFor = $state('');
	let tries = $state(0);
	const address = $derived(src || (rev && id ? `/api/online/avatar/${id}?v=${rev}${tries ? `&try=${tries}` : ''}` : ''));
	const picture = $derived(address !== failedFor ? address : '');

	function failed() {
		const was = address;
		failedFor = was;
		if (src || tries >= 3) return;
		setTimeout(() => {
			if (failedFor === was) tries += 1;
		}, 15_000 * (tries + 1));
	}
	const letter = $derived((name.trim()[0] ?? '?').toUpperCase());
	// The same person always gets the same color.
	const color = $derived(letterColor(id));
</script>

{#if picture}
	<img class="avatar" src={picture} alt="" title={name} style:width="{size}px" style:height="{size}px" onerror={failed} />
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
