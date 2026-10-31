<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import qrcode from 'qrcode-generator';
	import type { PageData } from './$types';

	/**
	 * Catalog on a phone as an app (src/lib/server/tailscale.ts, static/offline.html): the secure
	 * address to open, as a picture the phone's camera can read, and the button that turns it on.
	 */
	let { data }: { data: PageData } = $props();

	let working = $state(false);
	let enableLink = $state('');
	let problem = $state('');

	const address = $derived(data.phone.on ? data.phone.address : null);
	const picture = $derived.by(() => {
		if (!address) return '';
		const code = qrcode(0, 'M');
		code.addData(`${address}/`);
		code.make();
		return code.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
	});

	async function turnOn() {
		working = true;
		problem = '';
		enableLink = '';
		try {
			const answer = await fetch('/api/phone-address', { method: 'POST' }).then((r) => r.json());
			if (answer.enable) enableLink = answer.enable;
			else if (!answer.ok) problem = answer.message ?? "Tailscale didn't turn it on.";
			await invalidateAll();
		} catch {
			problem = "Tailscale didn't answer.";
		} finally {
			working = false;
		}
	}
</script>

<svelte:head><title>Phones · Catalog</title></svelte:head>

<section>
	<h2>Catalog on a phone</h2>
	<p class="muted">
		Phones open Catalog through Tailscale, at home or away. On its secure address, Catalog can be added to the Home
		Screen as an app that keeps downloads on the phone and plays them with no connection. Each phone asks who's
		watching the first time.
	</p>
</section>

{#if !data.phone.tailscale}
	<section>
		<h2>Tailscale first</h2>
		<p class="muted">
			Tailscale isn't installed or signed in on this computer. Install it from tailscale.com/download, sign in, then come
			back here.
		</p>
	</section>
{:else if address}
	<section>
		<h2>The phone's address</h2>
		<div class="address">
			<div class="qr" aria-hidden="true">{@html picture}</div>
			<div>
				<p class="big">{address}</p>
				<p class="muted">
					On the phone (with Tailscale on): point the camera at the picture, or type the address in Safari. Then tap
					Share, then Add to Home Screen.
				</p>
			</div>
		</div>
	</section>
{:else}
	<section>
		<h2>The phone's address</h2>
		{#if data.onComputer}
			<p class="muted">Not turned on yet. It's Tailscale's own secure address for this computer, only reachable on your Tailscale network.</p>
			<button type="button" class="btn btn-primary" onclick={turnOn} disabled={working}>{working ? 'Turning it on…' : 'Turn on the phone address'}</button>
			{#if enableLink}
				<p class="muted">
					Tailscale wants HTTPS turned on for your network first (once). Open
					<a href={enableLink} target="_blank" rel="noreferrer">this Tailscale page</a>, sign in with the Tailscale
					account, click Enable, then press the button again.
				</p>
			{/if}
			{#if problem}<p class="problem">{problem}</p>{/if}
		{:else}
			<p class="muted">Not turned on yet: turn it on in Settings → Phones on the computer Catalog runs on.</p>
		{/if}
		{#if data.phone.plain}
			<p class="muted">Meanwhile phones can open <strong>{data.phone.plain}</strong> (no offline downloads there).</p>
		{/if}
	</section>
{/if}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 26px;
	}

	h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.muted {
		margin: 0;
		color: var(--ink-soft);
	}

	.address {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 18px;
	}

	.qr {
		width: 180px;
		height: 180px;
		flex: none;
		padding: 6px;
		border-radius: var(--radius);
		background: #fff;
	}

	.qr :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	.big {
		margin: 0 0 6px;
		font-size: 1.15rem;
		font-weight: 600;
		word-break: break-all;
	}

	.problem {
		margin: 0;
		color: var(--accent);
	}

	.btn {
		align-self: flex-start;
	}
</style>
