<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	/**
	 * "Who's watching?" on a phone (or another computer): asked the first time it opens Catalog,
	 * kept on that device. Each person has their own Continue Watching, places, episodes watched
	 * and list, the same as on the TVs. The picture at the top of the library comes back here.
	 */
	let { data }: { data: PageData } = $props();

	let choosing = $state(false);
	let adding = $state(false);
	let newName = $state('');
	let problem = $state('');

	async function choose(id: number) {
		if (choosing) return;
		choosing = true;
		try {
			await fetch('/api/profiles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'choose', id })
			});
			await goto(data.next, { invalidateAll: true });
		} finally {
			choosing = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		const name = newName.trim();
		if (!name) return;
		problem = '';
		const resp = await fetch('/api/profiles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'add', name })
		});
		const answer = await resp.json().catch(() => null);
		if (!resp.ok || typeof answer?.id !== 'number') {
			problem = answer?.message ?? "That profile couldn't be added.";
			return;
		}
		await choose(answer.id);
	}

	const initial = (name: string) => name.slice(0, 1).toUpperCase();
</script>

<svelte:head><title>Who's watching? · Catalog</title></svelte:head>

<main class="picker">
	<h1>Who's watching?</h1>

	<div class="people">
		{#each data.profiles as person (person.id)}
			<button type="button" class="person" class:current={person.id === data.current} onclick={() => choose(person.id)} disabled={choosing}>
				<span class="avatar" style:background={person.color}>{initial(person.name)}</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
		{#if data.profiles.length < 8 && !adding}
			<button type="button" class="person" onclick={() => (adding = true)}>
				<span class="avatar add">+</span>
				<span class="name">Add profile</span>
			</button>
		{/if}
	</div>

	{#if adding}
		<form class="add-form" onsubmit={add}>
			<!-- svelte-ignore a11y_autofocus -->
			<input type="text" maxlength="20" placeholder="Name" bind:value={newName} autofocus />
			<button type="submit" class="btn btn-primary" disabled={!newName.trim()}>Add</button>
			<button type="button" class="btn" onclick={() => { adding = false; newName = ''; }}>Cancel</button>
		</form>
		{#if problem}<p class="problem">{problem}</p>{/if}
	{/if}

	<p class="note">Remembered on this device. Tap your picture at the top of the library to change it.</p>
</main>

<style>
	.picker {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 28px;
		padding: 24px 16px;
		box-sizing: border-box;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.6rem, 6vw, 2.4rem);
		text-align: center;
	}

	.people {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(96px, 120px));
		justify-content: center;
		gap: 22px;
		width: 100%;
		max-width: 560px;
	}

	.person {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		cursor: pointer;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 96px;
		height: 96px;
		border-radius: 18px;
		font-size: 2.6rem;
		font-weight: 600;
		color: #fff;
		border: 3px solid transparent;
	}

	.person.current .avatar,
	.person:hover .avatar,
	.person:focus-visible .avatar {
		border-color: var(--ink);
	}

	.person.current .name {
		color: var(--ink);
	}

	.avatar.add {
		background: var(--surface);
		color: var(--ink-soft);
		border: 2px dashed var(--rule);
	}

	.name {
		font-size: 0.95rem;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.add-form {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}

	.add-form input {
		font: inherit;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
	}

	.problem {
		margin: 0;
		color: var(--accent);
	}

	.note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink-faint);
		text-align: center;
	}
</style>
