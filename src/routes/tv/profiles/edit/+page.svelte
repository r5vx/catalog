<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TvKeyboard from '$lib/tv/TvKeyboard.svelte';
	import { PROFILE_COLORS as COLORS } from '$lib/constants';
	import type { PageData } from './$types';

	/**
	 * A profile's name and colour, typed with the TV keyboard. With no ?id it's a new profile.
	 * Anyone but the library's owner can be deleted, along with what they've watched.
	 */
	let { data }: { data: PageData } = $props();

	const editing = $derived(data.profiles.find((one) => String(one.id) === page.url.searchParams.get('id')) ?? null);

	let typed = $state('');
	let color = $state('');
	let confirmDelete = $state(false);
	let saving = $state(false);
	$effect(() => {
		typed = editing?.name ?? '';
		color = editing?.color ?? '';
	});

	// Names start with capitals: "mum" is shown and saved as "Mum".
	const name = $derived(typed.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()).slice(0, 20));

	async function send(body: Record<string, unknown>) {
		saving = true;
		try {
			const response = await fetch('/api/profiles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (response.ok) await goto('/tv/profiles', { invalidateAll: true, replaceState: true });
		} finally {
			saving = false;
		}
	}

	function save() {
		if (!name.trim() || saving) return;
		send(editing ? { action: 'edit', id: editing.id, name, color } : { action: 'add', name });
	}

	function remove() {
		if (!editing || saving) return;
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		send({ action: 'delete', id: editing.id });
	}
</script>

<svelte:head><title>{editing ? 'Edit profile' : 'Add profile'} · Catalog</title></svelte:head>

<div class="editor">
	<div class="left">
		<h1>{editing ? 'Edit profile' : 'Add profile'}</h1>
		<div class="who">
			<span class="avatar" style:background={color || editing?.color || COLORS[data.profiles.length % COLORS.length]}>
				{name.slice(0, 1) || '?'}
			</span>
			<p class="typed" class:placeholder={!name}>{name || 'Name'}<span class="caret"></span></p>
		</div>
		<TvKeyboard bind:value={typed} keys="abcdefghijklmnopqrstuvwxyz" />
	</div>

	<div class="right">
		{#if editing}
			<p class="label">Colour</p>
			<div class="colors" data-tv-row>
				{#each COLORS as swatch (swatch)}
					<button
						type="button"
						class="swatch"
						class:on={color === swatch}
						style:background={swatch}
						data-tv-item
						aria-label="Colour"
						onclick={() => (color = swatch)}
					></button>
				{/each}
			</div>
		{/if}
		<div class="buttons" data-tv-row data-tv-grid>
			<button type="button" class="button primary" data-tv-item onclick={save} class:dim={!name.trim()}>Save</button>
			<a class="button" href="/tv/profiles" data-tv-item data-sveltekit-replacestate>Cancel</a>
			{#if editing && editing.id !== 0}
				<button type="button" class="button danger" data-tv-item onclick={remove} onblur={() => (confirmDelete = false)}>
					{confirmDelete ? 'Press again to delete' : 'Delete profile'}
				</button>
			{/if}
		</div>
		{#if confirmDelete}
			<p class="warning">{editing?.name}'s Continue Watching and list go too.</p>
		{/if}
	</div>
</div>

<style>
	.editor {
		position: absolute;
		inset: 0;
		display: flex;
		gap: 5vw;
		padding: 7vh 5vw 0;
	}

	.left {
		display: flex;
		flex-direction: column;
		gap: 2vw;
	}

	h1 {
		margin: 0;
		font-family: var(--display);
		font-size: 3vw;
		font-weight: 600;
	}

	.who {
		display: flex;
		align-items: center;
		gap: 1.6vw;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 6vw;
		height: 6vw;
		flex: none;
		border-radius: 0.6vw;
		color: #1a1a1a;
		font-size: 3vw;
		font-weight: 800;
	}

	.typed {
		margin: 0;
		font-size: 2.6vw;
		font-weight: 700;
	}

	.typed.placeholder {
		color: var(--ink-soft);
	}

	.caret {
		display: inline-block;
		width: 0.2vw;
		height: 2.4vw;
		margin-left: 0.3vw;
		vertical-align: -0.3vw;
		background: var(--accent);
	}

	.right {
		display: flex;
		flex-direction: column;
		gap: 1.4vw;
		padding-top: 12vh;
	}

	.label {
		margin: 0;
		color: var(--ink-soft);
		font-size: 1.4vw;
		font-weight: 600;
	}

	.colors {
		display: flex;
		gap: 1vw;
		margin-bottom: 2vw;
	}

	.swatch {
		width: 3.6vw;
		height: 3.6vw;
		border: 0.3vw solid transparent;
		border-radius: 0.5vw;
		cursor: pointer;
		outline: none;
		transition: transform 0.1s ease;
	}

	.swatch.on {
		border-color: var(--paper);
		box-shadow: 0 0 0 0.2vw var(--ink-soft);
	}

	.swatch:focus,
	.swatch:global(.tv-focused) {
		border-color: var(--ink);
		transform: scale(1.12);
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: 1vw;
		width: 22vw;
	}

	.button {
		padding: 1vw 2vw;
		border: none;
		border-radius: 0.5vw;
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: 1.6vw;
		font-weight: 700;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		outline: none;
	}

	.button.dim {
		opacity: 0.5;
	}

	.button:focus,
	.button:global(.tv-focused) {
		background: var(--ink);
		color: var(--paper);
	}

	.button.danger:focus,
	.button.danger:global(.tv-focused) {
		background: #d9534f;
		color: #fff;
	}

	.warning {
		margin: 0;
		max-width: 22vw;
		color: var(--ink-soft);
		font-size: 1.3vw;
	}
</style>
