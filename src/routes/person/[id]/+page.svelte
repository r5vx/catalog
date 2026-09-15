<script lang="ts">
	import { libraryHref } from '$lib/nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Only the library fallback needs the browser (it reads sessionStorage);
	// arriving from a film is known on the server, so it renders right first time.
	let libraryBack = $state('/');

	$effect(() => {
		libraryBack = libraryHref();
	});

	const backHref = $derived(data.from ? `/entry/${data.from}` : libraryBack);
	const backLabel = $derived(data.from ? 'Back' : 'Library');

	/** Titles added from here, so the button can show it worked. */
	let justAdded = $state<Record<string, number>>({});
	let adding = $state<string | null>(null);

	async function addToWatchlist(credit: {
		title: string;
		year: string;
		poster: string | null;
		source: string;
		sourceId: string;
		kind: string;
		categorySlug: string;
		rating: number | null;
		votes: number | null;
	}) {
		const key = `${credit.source}:${credit.sourceId}`;
		adding = key;

		try {
			const response = await fetch('/api/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					result: {
						key,
						source: credit.source,
						sourceId: credit.sourceId,
						title: credit.title,
						altTitle: null,
						year: Number(credit.year) || null,
						posterUrl: credit.poster,
						overview: null,
						categorySlug: credit.categorySlug,
						confident: true,
						kind: credit.kind,
						episodesTotal: null,
						runtimeMinutes: null,
						externalRating: credit.rating,
						externalVotes: credit.votes,
						popularity: 0
					},
					// Something you haven't seen goes on the list, not into history.
					status: 'planned',
					markWatchedToday: false
				})
			});

			if (response.ok) justAdded[key] = (await response.json()).id;
		} finally {
			adding = null;
		}
	}

	const PAGE = 20;
	let showing = $state(PAGE);

	const visible = $derived(data.knownFor.slice(0, showing));
	const remaining = $derived(data.knownFor.length - visible.length);
</script>

<svelte:head><title>{data.person.name} · Catalog</title></svelte:head>

<a href={backHref} class="back faint">&larr; {backLabel}</a>

<header>
	{#if data.person.photo}
		<img class="portrait" src={data.person.photo} alt="" />
	{:else}
		<div class="portrait empty" aria-hidden="true">?</div>
	{/if}
	<div>
		<h1>{data.person.name}</h1>
		<p class="muted tabular">
			In {data.entries.length}
			{data.entries.length === 1 ? 'title' : 'titles'} you've watched
		</p>
	</div>
</header>

<ul class="grid">
	{#each data.entries as item (item.id)}
		<li>
			<a href="/entry/{item.id}" class="card">
				<div class="poster">
					{#if item.posterUrl}
						<img src={item.posterUrl} alt="" loading="lazy" />
					{:else}
						<span class="fallback" aria-hidden="true">{item.categoryEmoji}</span>
					{/if}
				</div>
				<h2 class="name">{item.title}</h2>
				<p class="sub faint tabular">{item.year ?? '—'}</p>
				{#if item.character}
					<p class="role faint">as {item.character}</p>
				{/if}
			</a>
		</li>
	{/each}
</ul>

{#if data.knownFor.length > 0}
	<section class="known">
		<h2>Also known for</h2>
		<p class="muted small">Their most popular work you haven't added.</p>

		<ul class="grid">
			{#each visible as credit (credit.title + credit.year)}
				{@const key = `${credit.source}:${credit.sourceId}`}
				<li>
					<div class="poster">
						{#if credit.poster}
							<img src={credit.poster} alt="" loading="lazy" />
						{:else}
							<span class="fallback" aria-hidden="true">?</span>
						{/if}

						{#if justAdded[key]}
							<a class="added-badge" href="/entry/{justAdded[key]}" title="Added — open it">
								Added
							</a>
						{:else}
							<button
								type="button"
								class="add"
								disabled={adding === key}
								title="Add to your watchlist"
								aria-label="Add {credit.title} to your watchlist"
								onclick={() => addToWatchlist(credit)}
							>
								{adding === key ? '…' : '+'}
							</button>
						{/if}
					</div>
					<h3 class="name">{credit.title}</h3>
					<p class="sub faint tabular">{credit.year || '—'}</p>
					{#if credit.character}
						<p class="role faint">as {credit.character}</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if remaining > 0}
			<button type="button" class="btn more" onclick={() => (showing += PAGE)}>
				Show {Math.min(PAGE, remaining)} more
				<span class="faint tabular">({remaining} left)</span>
			</button>
		{/if}
	</section>
{/if}

<style>
	.back {
		font-size: 0.85rem;
		display: inline-block;
		margin-bottom: 12px;
	}
	.back:hover {
		color: var(--accent);
	}

	header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 26px;
	}

	.portrait {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
		flex-shrink: 0;
	}

	.portrait.empty {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	h1 {
		font-size: clamp(1.5rem, 4vw, 2rem);
	}

	header p {
		margin: 2px 0 0;
		font-size: 0.88rem;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 20px 16px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.poster {
		aspect-ratio: 2 / 3;
		max-width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
		display: grid;
		place-items: center;
		transition: border-color 0.14s ease;
	}

	.card:hover .poster {
		border-color: var(--accent);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.fallback {
		font-size: 1.8rem;
		opacity: 0.4;
	}

	.name {
		font-family: var(--body);
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.sub,
	.role {
		font-size: 0.78rem;
		margin: 0;
	}

	.known {
		margin-top: 40px;
		padding-top: 22px;
		border-top: 1px solid var(--rule);
	}

	.known h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	.known .small {
		font-size: 0.85rem;
		margin: 2px 0 12px;
	}

	.known .grid {
		margin-top: 4px;
	}

	.known .poster {
		position: relative;
	}

	/* Hidden until you point at the poster, so the grid stays calm. */
	.add {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 1.05rem;
		line-height: 1;
		display: grid;
		place-items: center;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.known li:hover .add,
	.add:focus-visible {
		opacity: 1;
	}

	.added-badge {
		position: absolute;
		top: 6px;
		right: 6px;
		background: var(--good);
		color: var(--paper);
		border-radius: 100px;
		padding: 2px 9px;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.more {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		margin-top: 18px;
	}
</style>
