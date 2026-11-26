<script lang="ts">
	import TitleTrailer from './TitleTrailer.svelte';
	/**
	 * What it's about.
	 *
	 * Long descriptions are clamped to a few lines with a "more" toggle, so a
	 * five-paragraph anime synopsis doesn't push the cast and the scores off
	 * the bottom of the page.
	 */
	let {
		text,
		tagline = null,
		heading = 'What it’s about',
		trailer = null, title = 'Title',
		pending = false
	}: {
		text: string | null;
		tagline?: string | null;
		heading?: string;
		trailer?: string | null;
		title?: string;
		pending?: boolean;
	} = $props();

	let open = $state(false);

	/** Roughly where four lines of text ends — worth a toggle beyond that. */
	const LONG = 340;
	const long = $derived((text?.length ?? 0) > LONG);
</script>

{#if text || pending || trailer}
<div class="overview" class:withTrailer={Boolean(trailer)}>
{#if text}
	<section class="synopsis">
		<h2 class="label">{heading}</h2>
		{#if tagline}<p class="tagline">{tagline}</p>{/if}
		<p class="body" class:clamped={long && !open}>{text}</p>
		{#if long}
			<button type="button" class="more" onclick={() => (open = !open)}>
				{open ? 'Show less' : 'Read more'}
			</button>
		{/if}
	</section>
{:else if pending}
	<section class="synopsis">
		<h2 class="label">{heading}</h2>
		<p class="body faint">Fetching it…</p>
	</section>
{/if}

{#if trailer}<TitleTrailer videoId={trailer} {title} />{/if}
</div>
{/if}

<style>
	.overview.withTrailer { display: grid; gap: 1.25rem; align-items: start; padding: clamp(1rem, 2vw, 1.5rem); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); }
	@media (min-width: 760px) { .withTrailer:has(.synopsis) { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); } }
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 8px;
	}

	.tagline {
		font-family: var(--display);
		font-size: 1.02rem;
		color: var(--ink-soft);
		font-style: italic;
		margin: 0 0 8px;
	}

	.body {
		margin: 0;
		line-height: 1.65;
		max-width: 68ch;
	}

	.clamped {
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.more {
		background: none;
		border: none;
		padding: 4px 0 0;
		font-size: 0.83rem;
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}

	.more:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
