<script lang="ts">
	/**
	 * Genres, studios, directors and franchises for one title.
	 *
	 * A tag that exists in your library links to it filtered by that tag — the
	 * quickest route from "who directed this" to "what else of theirs have I
	 * seen". Tags on something you don't own have nothing to link to, so they
	 * render as plain labels.
	 */
	let {
		tags,
		heading = 'Tags'
	}: {
		tags: { id?: number; name: string; kind: string }[];
		heading?: string;
	} = $props();

	const ORDER = ['franchise', 'director', 'studio', 'genre'];

	const sorted = $derived(
		[...tags].sort((a, b) => {
			const byKind = ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
			return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
		})
	);
</script>

{#if sorted.length > 0}
	<section class="tags">
		<h2 class="label">{heading}</h2>
		<ul>
			{#each sorted as tag (tag.name + tag.kind)}
				<li>
					{#if tag.id}
						<a class="chip {tag.kind}" href="/?tag={tag.id}" title="Everything tagged {tag.name}">
							{tag.name}
						</a>
					{:else}
						<span class="chip {tag.kind}">{tag.name}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 9px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-block;
		font-size: 0.79rem;
		line-height: 1.4;
		padding: 3px 10px;
		border-radius: 100px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink-soft);
	}

	a.chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	/* The people and franchises carry more meaning than a genre does. */
	.director,
	.franchise {
		font-weight: 600;
		color: var(--ink);
		border-color: var(--rule-firm);
	}
</style>
