<!--
	"⋯": opens the same menu as right-clicking, so the options can be found without knowing
	about right-click (and work on a phone).

	"overlay" sits in a top corner of a card and "inline" in a row; both show only while that
	card or row is hovered. The card or row needs the class "has-more" (and, for "overlay",
	`position: relative`). On touch screens, which can't hover, they're always shown.
-->
<script lang="ts">
	let {
		onopen,
		label = 'More options',
		variant = 'overlay',
		corner = 'right',
		top = 6
	}: {
		onopen: (e: MouseEvent) => void;
		label?: string;
		variant?: 'overlay' | 'inline';
		/** Which top corner of the card, when something else already sits in the other. */
		corner?: 'left' | 'right';
		/** Distance from the top, to sit below a badge in the same corner. */
		top?: number;
	} = $props();

	function open(e: MouseEvent) {
		// It usually sits inside a link: open the menu, don't follow it.
		e.preventDefault();
		e.stopPropagation();
		onopen(e);
	}
</script>

<button
	type="button"
	class="more {variant} {corner}"
	style:top={variant === 'overlay' ? `${top}px` : null}
	title={label}
	aria-label={label}
	onclick={open}
>
	<!-- Drawn dots: the "⋯" character looks like dashes in some fonts. -->
	<svg viewBox="0 0 16 4" width="14" height="4" aria-hidden="true">
		<circle cx="2" cy="2" r="1.6" />
		<circle cx="8" cy="2" r="1.6" />
		<circle cx="14" cy="2" r="1.6" />
	</svg>
</button>

<style>
	svg {
		fill: currentColor;
	}

	.more {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 50%;
		font-size: 1.05rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		transition:
			opacity 0.12s ease,
			background 0.12s ease;
	}

	.overlay {
		position: absolute;
		z-index: 3;
		background: rgb(0 0 0 / 65%);
		color: #fff;
		opacity: 0;
	}

	.overlay.right {
		right: 6px;
	}

	.overlay.left {
		left: 6px;
	}

	.overlay:hover {
		background: rgb(0 0 0 / 85%);
	}

	:global(.has-more:hover) .overlay,
	:global(.has-more:focus-within) .overlay {
		opacity: 1;
	}

	/* Hidden until the row is hovered, like the overlay. */
	.inline {
		flex: none;
		background: transparent;
		color: var(--ink-faint);
		opacity: 0;
	}

	.inline:hover,
	:global(.has-more:hover) .inline {
		opacity: 1;
	}

	.inline:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.more:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.overlay,
		.inline {
			opacity: 1;
		}
	}
</style>
