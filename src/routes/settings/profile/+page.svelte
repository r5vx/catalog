<script lang="ts">
	import { onMount } from 'svelte';
	import Avatar from '$lib/Avatar.svelte';

	/**
	 * Settings → Profile: the name and picture friends see online, for the profile using this page
	 * (each profile is its own person online: src/lib/server/online.ts). The picture is cut to a
	 * small square here, in the page, before it is sent; the meeting point keeps only that.
	 */
	type Account = { id: string; name: string; google: boolean; email: string | null; avatar: number };

	let loaded = $state(false);
	let connected = $state(false);
	let account = $state<Account | null>(null);
	let computers = $state(0);
	let name = $state('');
	let problem = $state('');
	let saved = $state('');
	let busy = $state(false);
	let fileBox = $state<HTMLInputElement | null>(null);

	/** The picture's side, in pixels, as it is kept. Big enough to stay sharp at any size it's shown. */
	const SIDE = 192;

	async function load() {
		const status = await fetch('/api/online')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		connected = Boolean(status?.connected);
		account = status?.account ?? null;
		computers = status?.computers ?? 0;
		if (account && !name) name = account.name;
		problem = status?.problem ?? '';
		loaded = true;
	}
	onMount(load);

	async function send(body: { name?: string; avatar?: string }, done: string) {
		busy = true;
		problem = '';
		saved = '';
		const answer = await fetch('/api/online/c/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
			.then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
			.catch(() => ({ ok: false, data: null }));
		busy = false;
		if (!answer.ok) {
			problem = answer.data?.error ?? "The server couldn't be reached";
			return;
		}
		if (answer.data?.account) account = answer.data.account;
		saved = done;
	}

	function saveName(event: SubmitEvent) {
		event.preventDefault();
		const clean = name.trim();
		if (clean && clean !== account?.name) send({ name: clean }, 'Name saved.');
	}

	/** The middle square of the chosen image, drawn small, as a JPEG. */
	async function squared(file: File): Promise<string> {
		const image = await createImageBitmap(file);
		const side = Math.min(image.width, image.height);
		const canvas = document.createElement('canvas');
		canvas.width = SIDE;
		canvas.height = SIDE;
		const pen = canvas.getContext('2d')!;
		pen.imageSmoothingQuality = 'high';
		pen.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
		return canvas.toDataURL('image/jpeg', 0.85);
	}

	async function pickPicture(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (fileBox) fileBox.value = '';
		if (!file) return;
		try {
			await send({ avatar: await squared(file) }, 'Picture saved.');
		} catch {
			problem = "That file isn't a picture Catalog can read.";
		}
	}
</script>

<svelte:head><title>Profile · Catalog</title></svelte:head>

{#if !loaded}
	<p class="muted">Loading…</p>
{:else if !connected}
	<section>
		<h2>Your profile online</h2>
		<p class="muted">The name and picture friends see. This Catalog isn't online yet: <a href="/settings/online">Settings → Online</a>.</p>
	</section>
{:else if !account}
	<p class="msg bad">{problem || "The server couldn't be reached"}</p>
{:else}
	<section>
		<h2>Your profile online</h2>
		<p class="muted">What friends see beside what you're watching and what you've watched. Each profile on this computer has its own.</p>

		<div class="card">
			<Avatar id={account.id} name={name || account.name} rev={account.avatar} size={96} />
			<div class="side">
				<div class="row">
					<button type="button" class="btn" onclick={() => fileBox?.click()} disabled={busy}>{account.avatar ? 'Change picture' : 'Choose a picture'}</button>
					{#if account.avatar}<button type="button" class="btn" onclick={() => send({ avatar: '' }, 'Picture removed.')} disabled={busy}>Remove</button>{/if}
				</div>
				<p class="faint small">Any image. The middle of it is used, as a circle.</p>
				<input bind:this={fileBox} type="file" accept="image/*" hidden onchange={pickPicture} />
			</div>
		</div>

		<form onsubmit={saveName}>
			<label for="name">Name</label>
			<div class="row">
				<input id="name" type="text" bind:value={name} maxlength="30" autocomplete="off" />
				<button type="submit" class="btn btn-primary" disabled={busy || !name.trim() || name.trim() === account.name}>Save</button>
			</div>
		</form>

		{#if problem}<p class="msg bad">{problem}</p>{/if}
		{#if saved}<p class="faint small">{saved}</p>{/if}
		{#if account.google}<p class="muted">Signed in with Google as <strong>{account.email}</strong>.</p>{/if}
		{#if computers > 1}<p class="muted">The same on your {computers} computers.</p>{/if}
		<p class="faint small">Friends, your other computers and what's shared: <a href="/settings/online">Settings → Online</a>.</p>
	</section>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	p {
		margin: 0;
		max-width: 62ch;
	}

	.card {
		display: flex;
		align-items: center;
		gap: 18px;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label {
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.row input {
		width: min(100%, 20rem);
	}

	.small {
		font-size: 0.85rem;
	}
</style>
