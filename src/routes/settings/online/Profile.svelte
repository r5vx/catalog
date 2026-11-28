<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Avatar from '$lib/Avatar.svelte';
	import PictureCropDialog from '$lib/PictureCropDialog.svelte';
	import { squarePicture, type Fit } from '$lib/pictureFit';

	/**
	 * Settings → Online's name and picture (its own page, Profile, until 2026-11-14): what friends see, for the profile using this page
	 * (each profile is its own person online: src/lib/server/online.ts). The picture is cut to a
	 * small square here, in the page, before it is sent; the meeting point keeps only that.
	 */
	type Account = { id: string; name: string; google: boolean; email: string | null; avatar: number };

	let loaded = $state(false);
	let connected = $state(false);
	let account = $state<Account | null>(null);
	let name = $state('');
	let problem = $state('');
	let saved = $state('');
	let busy = $state(false);
	let fileBox = $state<HTMLInputElement | null>(null);

	async function load() {
		const status = await fetch('/api/online')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		connected = Boolean(status?.connected);
		account = status?.account ?? null;
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
		// The sidebar and top bar picture and name come from the page's data, which isn't asked
		// again on its own: the old picture stayed there until Catalog was opened again (2026-11-26).
		await invalidateAll();
	}

	function saveName(event: SubmitEvent) {
		event.preventDefault();
		const clean = name.trim();
		if (clean && clean !== account?.name) send({ name: clean }, 'Name saved.');
	}

	/** A picture just chosen: moved and zoomed in a round frame before it's sent (as Discord does). */
	let adjusting = $state<{ file: File; url: string } | null>(null);

	function pickPicture(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (fileBox) fileBox.value = '';
		if (!file) return;
		adjusting = { file, url: URL.createObjectURL(file) };
	}

	function stopAdjusting() {
		if (adjusting) URL.revokeObjectURL(adjusting.url);
		adjusting = null;
	}

	async function applyPicture(fit: Fit) {
		const file = adjusting?.file;
		stopAdjusting();
		if (!file) return;
		try {
			await send({ avatar: await squarePicture(file, fit) }, 'Picture saved.');
		} catch {
			problem = "That file isn't a picture Catalog can read.";
		}
	}
</script>


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
		<div class="row">
			<a class="btn btn-primary" href="/friends/{account.id}">Open my profile</a>
			<a class="btn" href="/friends/{account.id}?edit=1">Edit profile</a>
		</div>

		<div class="card">
			<Avatar id={account.id} name={name || account.name} rev={account.avatar} size={96} />
			<div class="side">
				<div class="row">
					<button type="button" class="btn" onclick={() => fileBox?.click()} disabled={busy}>{account.avatar ? 'Change picture' : 'Choose a picture'}</button>
					{#if account.avatar}<button type="button" class="btn" onclick={() => send({ avatar: '' }, 'Picture removed.')} disabled={busy}>Remove</button>{/if}
				</div>
				<input bind:this={fileBox} type="file" accept="image/*" hidden onchange={pickPicture} />
				{#if adjusting}
					<PictureCropDialog src={adjusting.url} title="Adjust your picture" round onapply={applyPicture} oncancel={stopAdjusting} />
				{/if}
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
