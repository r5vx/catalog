<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let timer: ReturnType<typeof setTimeout>;

	function onInput(event: Event) {
		const value = (event.target as HTMLInputElement).value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			goto(value ? `/people?q=${encodeURIComponent(value)}` : '/people', {
				keepFocus: true,
				noScroll: true
			});
		}, 250);
	}
</script>

<svelte:head><title>People · Catalog</title></svelte:head>

<header>
	<a href="/" class="back faint">&larr; Library</a>
	<h1>People</h1>
	<p class="muted sub">Anyone who appears in something you've watched.</p>
</header>

<!-- svelte-ignore a11y_autofocus -->
<input
	type="search"
	id="people-search"
	class="lookup"
	placeholder="Search actors and voice actors…"
	value={data.q}
	autocomplete="off"
	autofocus
	oninput={onInput}
	aria-label="Search people"
/>

{#if data.q.length >= 2 && data.people.length === 0}
	<p class="muted none">No one by that name in your library.</p>
{/if}

<ul class="people">
	{#each data.people as person (person.id)}
		<li>
			<a href="/person/{person.id}">
				{#if person.photo}
					<img src={person.photo} alt="" loading="lazy" />
				{:else}
					<span class="noface" aria-hidden="true">?</span>
				{/if}
				<span class="who">
					<span class="name">{person.name}</span>
					<span class="faint small tabular">
						{person.count}
						{person.count === 1 ? 'title' : 'titles'} · {person.sample}
					</span>
				</span>
			</a>
		</li>
	{/each}
</ul>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 18px;
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

	.sub {
		font-size: 0.92rem;
	}

	.lookup {
		font-size: 1.05rem;
		padding: 13px 16px;
	}

	.none {
		font-size: 0.9rem;
		margin: 16px 0 0;
	}

	.people {
		list-style: none;
		margin: 18px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 4px 16px;
	}

	.people a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		border-radius: var(--radius-sm);
	}

	.people a:hover {
		background: var(--surface);
	}

	.people img,
	.noface {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
		flex-shrink: 0;
	}

	.noface {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-weight: 600;
		font-size: 0.93rem;
	}

	.small {
		font-size: 0.76rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
