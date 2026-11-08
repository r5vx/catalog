<script lang="ts">
	/**
	 * Stars for a rating out of 10. Five stars (the default): each half star is one point, so 4½
	 * stars is 9. Ten stars (Settings → Personalization → Ratings): each star is one point and a
	 * half star half a point, so 8½ stars is 8.5. Click a star's left third for a half star. Click
	 * the rating it already has to clear it. Arrow keys work too.
	 *
	 * `name` puts the rating in a form (a hidden field); `onchange` hears each change.
	 * The star colour is --star at the top of src/app.css.
	 */
	import { page } from '$app/state';

	type Props = {
		value: number | null;
		onchange?: (value: number | null) => void;
		name?: string;
		/** Bigger stars, for the player's "Rate it". */
		large?: boolean;
		label?: string;
	};

	let { value = $bindable(null), onchange, name, large = false, label = 'Your rating' }: Props = $props();

	const ten = $derived(page.data?.ratingStars === 10);
	const stars = $derived(ten ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]);
	// Points per star: 2 with five stars, 1 with ten.
	const per = $derived(ten ? 1 : 2);
	// The smallest change: one point with five stars, half a point with ten.
	const step = $derived(per / 2);

	/** What the pointer is over (a preview), else the rating itself. */
	let hover = $state<number | null>(null);
	const shown = $derived(hover ?? value ?? 0);

	function pick(next: number | null) {
		value = next;
		onchange?.(next);
	}

	// Only a star's left third is its half: a click near the middle, where people aim, is the
	// whole star (with an even split, a test click there gave 4½ instead of 5).
	function at(event: PointerEvent | MouseEvent, star: number): number {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const left = event.clientX - box.left < box.width * 0.35;
		return star * per - (left ? step : 0);
	}

	function onkey(event: KeyboardEvent) {
		const now = value ?? 0;
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') pick(Math.min(10, now + step));
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') pick(now - step > 0 ? now - step : null);
		else if (event.key === 'Delete' || event.key === 'Backspace') pick(null);
		else return;
		event.preventDefault();
	}
</script>

<div
	class="stars"
	class:large
	class:ten
	role="slider"
	tabindex="0"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={10}
	aria-valuenow={value ?? 0}
	aria-valuetext={value ? (ten ? `${value} of 10 stars` : `${value / 2} of 5 stars`) : 'Not rated'}
	onkeydown={onkey}
	onpointerleave={() => (hover = null)}
>
	{#each stars as star (star)}
		{@const fill = shown >= star * per ? 'full' : shown >= star * per - step ? 'half' : 'empty'}
		<button
			type="button"
			tabindex="-1"
			class="star {fill}"
			class:preview={hover !== null}
			aria-label="{star} {star === 1 ? 'star' : 'stars'}"
			onpointermove={(e) => (hover = at(e, star))}
			onclick={(e) => {
				const next = at(e, star);
				pick(next === value ? null : next);
			}}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<defs>
					<clipPath id="half-{star}"><rect x="0" y="0" width="12" height="24" /></clipPath>
				</defs>
				<path class="back" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
				{#if fill !== 'empty'}
					<path
						class="front"
						clip-path={fill === 'half' ? `url(#half-${star})` : undefined}
						d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"
					/>
				{/if}
			</svg>
		</button>
	{/each}
	{#if name}<input type="hidden" {name} value={value ?? ''} />{/if}
</div>

<style>
	.stars {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		border-radius: var(--radius-sm);
		outline-offset: 3px;
	}

	.star {
		display: block;
		width: 26px;
		height: 26px;
		padding: 1px;
		border: none;
		background: none;
		cursor: pointer;
	}

	.large .star {
		width: 34px;
		height: 34px;
	}

	/* Ten stars take about the room of seven. */
	.ten .star {
		width: 20px;
		height: 20px;
		padding: 0;
	}

	.ten.large .star {
		width: 28px;
		height: 28px;
	}

	.star svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.back {
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 1.4;
		stroke-linejoin: round;
	}

	.front {
		fill: var(--star);
		stroke: var(--star);
		stroke-width: 1.4;
		stroke-linejoin: round;
	}

	/* Pointing at a rating before picking it: a little lighter. */
	.preview .front {
		opacity: 0.75;
	}
</style>
