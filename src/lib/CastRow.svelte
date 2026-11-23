<script lang="ts">
	import MusicCredits from '$lib/MusicCredits.svelte';

	/**
	 * Who's in it, in billing order.
	 *
	 * Anyone already in your library links to their page. On a title you don't
	 * own, most of the cast won't be — those render as plain faces rather than
	 * dead links.
	 *
	 * With `music` (which title it is), a Music tab sits beside Cast: who did the music, the
	 * soundtrack's songs, an anime's openings and endings (lib/MusicCredits.svelte).
	 */
	let {
		cast,
		back = null,
		heading = 'Cast',
		note = null,
		music = null
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
		music?: { source: string; sourceId?: string; title: string; year: string | number | null; type: 'movie' | 'tv'; anime?: boolean } | null;
	} = $props();

	let tab = $state<'cast' | 'music'>('cast');
	/** The Music tab was opened once: it stays drawn (and doesn't ask again) after going back to Cast. */
	let musicSeen = $state(false);
	const showMusic = $derived(Boolean(music?.title && (music.sourceId || music.source === 'manual')));
	function pick(which: 'cast' | 'music') {
		tab = which;
		if (which === 'music') musicSeen = true;
	}

	/**
	 * Our own id where we have one; the provider's where we don't, with their name and photo, so
	 * their page opens even while AniList won't answer (it allows only so many questions a
	 * minute, and that used to be "404").
	 */
	const href = (person: { id?: number | null; sourceId?: string | null; name: string; photo: string | null }) => {
		const params = new URLSearchParams();
		if (!person.id) {
			params.set('name', person.name);
			if (person.photo) params.set('photo', person.photo);
		}
		if (back) params.set('back', back);
		const query = params.toString();
		return `/person/${person.id || person.sourceId}${query ? `?${query}` : ''}`;
	};
</script>

{#if cast.length > 0 || showMusic}
	<section class="cast">
		{#if showMusic}
			<div class="tabs" role="tablist">
				<button type="button" role="tab" class="label" class:on={tab === 'cast'} aria-selected={tab === 'cast'} onclick={() => pick('cast')}>{heading}</button>
				<button type="button" role="tab" class="label" class:on={tab === 'music'} aria-selected={tab === 'music'} onclick={() => pick('music')}>Music</button>
			</div>
		{:else}
			<h2 class="label">{heading}</h2>
		{/if}
		{#if showMusic && musicSeen && music}
			<div hidden={tab !== 'music'}>
				{#key JSON.stringify(music)}
					<MusicCredits {...music} {back} />
				{/key}
			</div>
		{/if}
		{#if tab === 'cast' && !cast.length}<p class="faint">No cast listed.</p>{/if}
		<ul hidden={tab !== 'cast' || !cast.length}>
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
		{#if note && tab === 'cast'}<p class="faint hint">{note}</p>{/if}
	</section>
{/if}

<style>
	.tabs {
		display: flex;
		gap: 18px;
		margin: 0 0 10px;
	}

	.tabs .label {
		margin: 0;
		padding: 0 0 4px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		cursor: pointer;
	}

	.tabs .label.on {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}

	ul[hidden] {
		display: none;
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
