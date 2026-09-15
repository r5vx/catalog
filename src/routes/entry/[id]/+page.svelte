<script lang="ts">
	import { libraryHref } from '$lib/nav';
	import EntryForm from '$lib/EntryForm.svelte';
	import TitleSearch from '$lib/TitleSearch.svelte';
	import { progressSummary } from '$lib/progress';
	import type { SearchResult } from '$lib/server/metadata/types';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let fixing = $state(false);
	let busyKey = $state<string | null>(null);
	let swapped = $state('');
	let backToLibrary = $state('/');

	$effect(() => {
		backToLibrary = libraryHref();
	});

	const added = $derived(
		new Date(data.entry.createdAt).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		})
	);

	async function useInstead(result: SearchResult) {
		busyKey = result.key;
		try {
			const response = await fetch('/api/rematch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: data.entry.id, result })
			});

			if (!response.ok) return;

			// A full reload, not invalidateAll(): the form holds its own copies of
			// every field, so it has to be rebuilt from the new data. Without this
			// the old poster sits in the form and saving would write it back.
			location.reload();
		} finally {
			busyKey = null;
		}
	}
</script>

<svelte:head><title>{data.entry.title} · Catalog</title></svelte:head>

<header>
	<a href={backToLibrary} class="back faint">&larr; Library</a>
	<h1>{data.entry.title}</h1>
	<p class="added faint tabular">Added {added}</p>
</header>

{#if form?.error}
	<p class="notice error" role="alert">{form.error}</p>
{:else if form?.saved}
	<p class="notice saved" role="status">Saved.</p>
{:else if swapped}
	<p class="notice saved" role="status">
		Now matched to <strong>{swapped}</strong>. Your rating, notes and dates were kept.
	</p>
{/if}

{#if progressSummary(data.entry)}
	<p class="airing muted">{progressSummary(data.entry)}</p>
{/if}

{#if data.cast.length > 0}
	<section class="cast">
		<h2 class="label">Cast</h2>
		<ul>
			{#each data.cast as person (person.id)}
				<li>
					<a
						href="/person/{person.id}?from={data.entry.id}"
						title="Everything else with {person.name}"
					>
						{#if person.photo}
							<img src={person.photo} alt="" loading="lazy" />
						{:else}
							<span class="noface" aria-hidden="true">?</span>
						{/if}
						<span class="who">{person.name}</span>
						{#if person.character}
							<span class="role faint">{person.character}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
		<p class="faint hint">Billing order. Click anyone to see what else you've watched with them.</p>
	</section>
{/if}



<form method="POST" action="?/save">
	<EntryForm categories={data.categories} entry={data.entry} submitLabel="Save changes" />
</form>

<section class="fix">
	{#if fixing}
		<div class="fix-head">
			<span class="label">Match it to something else</span>
			<button type="button" class="btn" onclick={() => (fixing = false)}>Cancel</button>
		</div>
		<TitleSearch
			initial={data.entry.title}
			label="Find the right title"
			placeholder="Search for the right one…"
			{busyKey}
			onpick={useInstead}
		/>
	{:else}
		<button type="button" class="btn" onclick={() => (fixing = true)}>Wrong match? Fix it</button>
	{/if}
</section>

<form
	method="POST"
	action="?/delete"
	class="danger-zone"
	onsubmit={(event) => {
		if (!confirm(`Remove "${data.entry.title}" from your library?`)) event.preventDefault();
	}}
>
	<button type="submit" class="btn btn-danger">Delete this entry</button>
</form>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 26px;
	}

	.back {
		font-size: 0.85rem;
		width: fit-content;
	}

	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	.added {
		font-size: 0.8rem;
		margin: 2px 0 0;
	}

	.notice {
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		margin: 0 0 20px;
		font-size: 0.9rem;
	}

	.error {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.saved {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
	}

	.airing {
		font-size: 0.9rem;
		margin: 0 0 16px;
		padding-left: 11px;
		border-left: 2px solid var(--good);
	}

	.cast {
		margin-bottom: 26px;
	}

	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 10px;
	}

	.cast ul {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		display: flex;
		gap: 14px;
		overflow-x: auto;
	}

	.cast li {
		flex: 0 0 88px;
	}

	.cast a {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.cast img,
	.noface {
		width: 88px;
		height: 88px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
		transition: border-color 0.14s ease;
	}

	.noface {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	.cast a:hover img,
	.cast a:hover .noface {
		border-color: var(--accent);
	}

	.who {
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.25;
	}

	.role {
		font-size: 0.73rem;
		line-height: 1.25;
	}

	.hint {
		font-size: 0.78rem;
		margin: 8px 0 0;
	}

	.fix {
		margin-top: 36px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		padding: 16px 18px;
		margin-bottom: 28px;
	}

	.fix-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.danger-zone {
		margin-top: 48px;
		padding-top: 22px;
		border-top: 1px solid var(--rule);
	}
</style>
