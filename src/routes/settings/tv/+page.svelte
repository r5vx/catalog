<script lang="ts">
	import { onMount } from 'svelte';
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
</script>

<svelte:head><title>Watch on TV · Catalog</title></svelte:head>

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
				In Downloader, type
				{#if where}<strong class="tabular">http://{where}/catalog-tv.apk</strong>{:else}this computer's address followed by <strong>/catalog-tv.apk</strong>{/if}
				and press Go, then Install.
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

	.others {
		margin: 0;
		padding-left: 1.2em;
		font-size: 0.9rem;
	}

	button {
		align-self: flex-start;
	}
</style>
