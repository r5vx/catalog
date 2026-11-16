<script lang="ts">
	/**
	 * A person's name in the look they chose (src/lib/nameStyle.ts): a font, and a color, gradient
	 * or glow. With no look chosen it's plain text in the surrounding style.
	 */
	import { nameCss, loadFont, readNameStyle, type NameStyle } from '$lib/nameStyle';

	let { name, look = null }: { name: string; look?: NameStyle | string | null } = $props();

	const style = $derived(readNameStyle(look));
	$effect(() => loadFont(style.font));
</script>

<span class="styled-name" class:pixel={style.font === 'pixel'} style={nameCss(style)}>{name}</span>

<style>
	.styled-name {
		/* (A gradient is drawn across the letters themselves, so the box hugs them.) */
		display: inline-block;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	/* The pixel font is much wider than the others: a little smaller keeps names on one line. */
	.pixel {
		font-size: 0.72em;
		line-height: 1.5;
	}
</style>
