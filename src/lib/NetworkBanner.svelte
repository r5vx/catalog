<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * On the computer Catalog runs on, when Windows has set its network to Public: the TVs can't
	 * reach Catalog then (src/lib/server/networkType.ts). "Set to Private" asks Windows once;
	 * "Not now" leaves that network Public for good.
	 */
	let { network }: { network: { name: string } | null | undefined } = $props();

	let busy = $state(false);
	let declined = $state(false);

	async function act(action: 'private' | 'leave') {
		busy = true;
		declined = false;
		try {
			const r = await fetch('/api/desktop/network', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			const answer = (await r.json().catch(() => ({}))) as { ok?: boolean };
			if (action === 'private' && !answer.ok) declined = true;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	const showing = $derived(Boolean(network) && page.url.pathname !== '/watch');
</script>

{#if showing && network}
	<div class="banner" role="status">
		<span class="what">
			<strong>TVs can't connect to Catalog.</strong> Windows set this network ({network.name}) to Public.
			{#if declined}Windows didn't allow the change.{/if}
		</span>
		<span class="actions">
			<button type="button" class="btn btn-primary" disabled={busy} onclick={() => act('private')}>{busy ? 'Waiting for Windows…' : 'Set to Private'}</button>
			<button type="button" class="btn" disabled={busy} onclick={() => act('leave')}>Not now</button>
		</span>
	</div>
{/if}

<style>
	.banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
		background: var(--warn-bg);
		border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
		border-radius: var(--radius);
		padding: 11px 15px;
		margin-bottom: 18px;
		font-size: 0.9rem;
	}

	.what {
		min-width: 0;
	}

	.actions {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
	}

	.actions .btn {
		padding: 5px 11px;
		font-size: 0.85rem;
	}
</style>
