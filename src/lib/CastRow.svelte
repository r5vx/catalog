<script lang="ts">
	/**
	 * Who's in it, in billing order.
	 *
	 * Anyone already in your library links to their page. On a title you don't
	 * own, most of the cast won't be — those render as plain faces rather than
	 * dead links.
	 */
	let {
		cast,
		back = null,
		heading = 'Cast',
		note = null
	}: {
		cast: {
			id?: number | null;
			/** The provider's id, used when this person isn't in the library. */
			sourceId?: string | null;
			name: string;
			photo: string | null;
			character: string | null;
		}[];
		/** The page to return to, so a long chain of links stays navigable. */
		back?: string | null;
		heading?: string;
		note?: string | null;
	} = $props();

	/** Our own id where we have one; the provider's where we don't. */
	const href = (person: { id?: number | null; sourceId?: string | null }) => {
		const who = person.id || person.sourceId;
		return back ? `/person/${who}?back=${encodeURIComponent(back)}` : `/person/${who}`;
	};
</script>

{#if cast.length > 0}
	<section class="cast">
		<h2 class="label">{heading}</h2>
		<ul>
			{#each cast as person, index (person.id ?? person.name + index)}
				<li>
					{#if person.id || person.sourceId}
						<a href={href(person)} title="Everything else with {person.name}">
							{#if person.photo}
								<img src={person.photo} alt="" loading="lazy" />
							{:else}
								<span class="noface" aria-hidden="true">?</span>
							{/if}
							<span class="who">{person.name}</span>
							{#if person.character}<span class="role faint">{person.character}</span>{/if}
						</a>
					{:else}
						<div class="plain">
							{#if person.photo}
								<img src={person.photo} alt="" loading="lazy" />
							{:else}
								<span class="noface" aria-hidden="true">?</span>
							{/if}
							<span class="who">{person.name}</span>
							{#if person.character}<span class="role faint">{person.character}</span>{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if note}<p class="faint hint">{note}</p>{/if}
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
		margin: 0 0 10px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		display: flex;
		gap: 14px;
		overflow-x: auto;
	}

	li {
		flex: 0 0 88px;
	}

	a,
	.plain {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	img,
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

	a:hover img,
	a:hover .noface {
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
</style>
