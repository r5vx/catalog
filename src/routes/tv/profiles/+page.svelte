<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	/**
	 * "Who's watching?", like Netflix's: everyone in the house has their own Continue Watching,
	 * episodes watched and My List. The TV app opens here once there's more than one person, and
	 * the picture at the top of the menu comes back to it. Manage profiles turns the pictures into
	 * ways to rename or delete them.
	 */
	let { data }: { data: PageData } = $props();

	let managing = $state(false);
	let choosing = $state(false);

	async function choose(id: number) {
		if (choosing) return;
		choosing = true;
		try {
			await fetch('/api/profiles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'choose', id })
			});
			await goto('/tv', { invalidateAll: true });
		} finally {
			choosing = false;
		}
	}

	const initial = (name: string) => name.slice(0, 1).toUpperCase();
</script>

<svelte:head><title>Who's watching? · Catalog</title></svelte:head>

<div class="picker">
	<h1>{managing ? 'Manage profiles' : "Who's watching?"}</h1>

	<div class="people" data-tv-row>
		{#each data.profiles as person (person.id)}
			{#if managing}
				<a class="person" href="/tv/profiles/edit?id={person.id}" data-tv-item data-tv-autofocus={person.id === data.profile.id || undefined}>
					<span class="avatar" style:background={person.color}>
						{initial(person.name)}
						<span class="pencil" aria-hidden="true">
							<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
						</span>
					</span>
					<span class="name">{person.name}</span>
				</a>
			{:else}
				<button
					type="button"
					class="person"
					data-tv-item
					data-tv-autofocus={person.id === data.profile.id || undefined}
					onclick={() => choose(person.id)}
				>
					<span class="avatar" style:background={person.color}>{initial(person.name)}</span>
					<span class="name">{person.name}</span>
				</button>
			{/if}
		{/each}
		{#if data.profiles.length < 8}
			<a class="person" href="/tv/profiles/edit" data-tv-item>
				<span class="avatar add">+</span>
				<span class="name">Add profile</span>
			</a>
		{/if}
	</div>

	<div class="actions" data-tv-row>
		<button type="button" class="manage" data-tv-item onclick={() => (managing = !managing)}>
			{managing ? 'Done' : 'Manage profiles'}
		</button>
	</div>
</div>

<style>
	.picker {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4vw;
		padding: 0 4vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3.6vw;
		font-weight: 600;
	}

	.people {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 2.4vw;
	}

	.person {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1vw;
		padding: 0;
		border: none;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		outline: none;
	}

	.avatar {
		position: relative;
		display: grid;
		place-items: center;
		width: 11vw;
		height: 11vw;
		border-radius: 0.8vw;
		border: 0.3vw solid transparent;
		color: #1a1a1a;
		font-size: 5vw;
		font-weight: 800;
		transition: transform 0.12s ease, border-color 0.12s ease;
	}

	.avatar.add {
		background: var(--surface-2);
		color: var(--ink-soft);
		font-weight: 300;
	}

	.pencil {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border-radius: 0.5vw;
		background: rgb(0 0 0 / 45%);
	}

	.pencil svg {
		width: 4vw;
		height: 4vw;
		fill: none;
		stroke: #fff;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.name {
		font-size: 1.7vw;
		font-weight: 600;
	}

	/* Highlighted: a white ring and a little bigger, like the posters. */
	.person:focus .avatar,
	.person:global(.tv-focused) .avatar {
		border-color: var(--ink);
		transform: scale(1.08);
	}

	.person:focus,
	.person:global(.tv-focused) {
		color: var(--ink);
	}

	.manage {
		padding: 0.9vw 2.4vw;
		border: 0.15vw solid var(--ink-soft);
		border-radius: 0.5vw;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: 1.5vw;
		font-weight: 600;
		letter-spacing: 0.05em;
		cursor: pointer;
		outline: none;
	}

	.manage:focus,
	.manage:global(.tv-focused) {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}
</style>
