<script lang="ts">
	import { onMount } from 'svelte';
	import NetworkBanner from '$lib/NetworkBanner.svelte';
	import RokuInstall from '$lib/RokuInstall.svelte';
	import { FIRE_TV_CODE } from '$lib/tvInstall';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const home = $derived(data.addresses.find((a) => !a.tailscale) ?? data.addresses[0] ?? null);
	const where = $derived(home ? `${home.address}:${data.port}` : null);

	/** Opened on the TV itself: offer switching to another computer instead of the setup steps. */
	let onTv = $state(false);
	onMount(() => {
		onTv = typeof (window as unknown as { CatalogTV?: unknown }).CatalogTV !== 'undefined';
	});

	function changeComputer() {
		(window as unknown as { CatalogTV: { forget: () => void } }).CatalogTV.forget();
	}

	/** The TV app's layout: big rows made for the remote (on), or the same screens as here. */
	let tvLayout = $state(true);
	$effect(() => {
		tvLayout = data.tvLayout;
	});

	async function setTvLayout(on: boolean) {
		tvLayout = on;
		await fetch('/api/tv-layout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ layout: on ? 'tv' : 'full' })
		});
		// On the TV itself, switch straight away.
		if (onTv && on) window.location.href = '/tv';
	}
</script>

<svelte:head><title>Watch on TV · Catalog</title></svelte:head>

{#await data.publicNetwork then network}<NetworkBanner {network} />{/await}

<section>
	<h2>On the Fire TV</h2>
	<label class="toggle">
		<input type="checkbox" checked={tvLayout} onchange={(e) => setTvLayout(e.currentTarget.checked)} />
		Use the TV layout on the TV app
	</label>
	<p class="muted">
		Big rows made for the remote, like Netflix. Off, the TV app shows the same screens as this computer. Only the
		TV app changes: computers and phones always have the normal layout.
	</p>
	{#if !onTv}
		<p class="muted">
			<a href="/tv">Try the TV layout here</a> — the arrow keys move, Enter picks, Esc goes back.
		</p>
	{/if}
</section>

{#if onTv}
	<section>
		<h2>This TV</h2>
		<p class="muted">It's showing Catalog from <strong>{data.name}</strong>.</p>
		<button type="button" class="btn" onclick={changeComputer}>Use a different computer</button>
	</section>
{:else}
	<section>
		<h2>Catalog on a Fire TV</h2>
		<p class="muted">
			The TV shows the Catalog on this computer, so this computer needs to be on, with Catalog open, while
			you watch, and on the same Wi-Fi as the TV.
		</p>

		{#if where}
			<div class="address">
				<span class="faint">This computer</span>
				<strong class="tabular">{where}</strong>
				<span class="faint">{data.name}</span>
			</div>
		{:else}
			<p class="msg bad">This computer doesn't seem to be on a network right now.</p>
		{/if}
	</section>

	<section>
		<h2>Setting it up (once)</h2>
		<ol class="steps">
			<li>
				On the Fire TV, install <strong>Downloader</strong> from the Amazon Appstore (search for it, it's free).
			</li>
			<li>
				Let it install apps: <strong>Settings → My Fire TV → Developer options → Install unknown apps</strong>,
				and turn it on for Downloader. (If there's no Developer options, open <em>About</em> and press OK on the
				device name seven times.)
			</li>
			<li>
				{#if FIRE_TV_CODE}
					In Downloader, type the code <strong class="tabular">{FIRE_TV_CODE}</strong> and press Go, then Install.
					(Or type
					{#if where}<strong class="tabular">http://{where}/catalog-tv.apk</strong>{:else}this computer's address followed by <strong>/catalog-tv.apk</strong>{/if}.)
				{:else}
					In Downloader, type
					{#if where}<strong class="tabular">http://{where}/catalog-tv.apk</strong>{:else}this computer's address followed by <strong>/catalog-tv.apk</strong>{/if}
					and press Go, then Install.
				{/if}
			</li>
			<li>
				Open <strong>Catalog</strong> from the TV's apps. It finds this computer by itself; if it doesn't, type
				{#if where}<strong class="tabular">{where}</strong>{:else}the address above{/if}.
			</li>
		</ol>
		<p class="faint small">
			If Windows asks whether Catalog may use the network, allow it on private networks — otherwise the TV can't
			reach it.
		</p>
	</section>

	<section>
		<h2>Catalog on a Roku</h2>
		<p class="muted">
			Like the Fire TV, the Roku shows the Catalog on this computer. Catalog puts the app on the Roku from here; it
			finds this computer by itself when it opens.
		</p>
		<RokuInstall />
	</section>

	{#if data.addresses.length > 1}
		<section>
			<h2>Other addresses</h2>
			<ul class="others tabular">
				{#each data.addresses as a (a.address)}
					<li>{a.address}:{data.port}{a.tailscale ? ' — Tailscale (only for a TV that has Tailscale too)' : ''}</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 28px;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	p {
		margin: 0;
		max-width: 62ch;
	}

	.address {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		max-width: 420px;
	}

	.address strong {
		font-size: 1.5rem;
	}

	.address span {
		font-size: 0.8rem;
	}

	.steps {
		margin: 0;
		padding-left: 1.3em;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 62ch;
		line-height: 1.5;
	}

	.small {
		font-size: 0.85rem;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.toggle input {
		width: auto;
	}

	.others {
		margin: 0;
		padding-left: 1.2em;
		font-size: 0.9rem;
	}

	button {
		align-self: flex-start;
	}
</style>
