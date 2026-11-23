<script lang="ts">
	/**
	 * A person's name in the look they chose (src/lib/nameStyle.ts): a font, a color or gradient, and
	 * a glow or shine on top. With no look chosen it's plain text in the surrounding style.
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

	/* The shine passing across a name (nameStyle.ts `shimmer`); still for anyone who asks for less motion. */
	:global {
		@keyframes name-shimmer {
			0% {
				background-position: 100% 0;
			}
			60%,
			100% {
				background-position: 0% 0;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.styled-name {
			animation: none !important;
		}
	}

	/* The pixel font is much wider than the others: a little smaller keeps names on one line. */
	.pixel {
		font-size: 0.72em;
		line-height: 1.5;
	}
</style>
