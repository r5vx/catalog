<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Offers an update when one is waiting.
	 *
	 * Appears once per launch rather than nagging: dismissing it hides it for
	 * this session, and "Don't ask again" turns it off for good (Settings →
	 * Updates can turn it back on).
	 */
	type Offer = { kind: 'release' | 'source'; version: string | null };

	let offer = $state<Offer | null>(null);
	let dismissed = $state(false);
	let starting = $state(false);
	/** So a successful answer isn't asked for again on every navigation. */
	let answered = $state(false);

	const SESSION_KEY = 'catalog.updateDismissed';

	$effect(() => {
		try {
			if (sessionStorage.getItem(SESSION_KEY)) dismissed = true;
		} catch {
			// No session storage. It just shows again.
		}

		/**
		 * Read so this re-runs when you move between pages.
		 *
		 * With a PIN set, Catalog opens on the login page — and this component
		 * lives in the layout, which stays mounted right through signing in. It
		 * asked once, from behind the lock, got the login page instead of an
		 * answer, and never asked again. Anyone with a PIN was simply never
		 * told an update was waiting.
		 */
		const path = page.url.pathname;
		if (path === '/login' || answered) return;

		look();
	});

	async function look() {
		try {
			const response = await fetch('/api/update');
			if (!response.ok) return;

			// Behind the lock this comes back as the login page, with a cheerful
			// 200. Parsing it would throw, be swallowed, and look like "no update".
			if (!response.headers.get('content-type')?.includes('application/json')) return;

			offer = (await response.json()).offer ?? null;
			answered = true;
		} catch {
			// Not the desktop app, or offline.
		}
	}

	function notNow() {
		dismissed = true;
		try {
			sessionStorage.setItem(SESSION_KEY, '1');
		} catch {
			// Then it asks again next time, which is the safe way to fail.
		}
	}

	async function never() {
		dismissed = true;
		await fetch('/api/update?action=mute', { method: 'POST' });
	}

	async function updateNow() {
		starting = true;

		// A source build rebuilds; an installed one restarts into what it
		// already downloaded.
		const action = offer?.kind === 'release' ? '?action=install' : '';
		await fetch(`/api/update${action}`, { method: 'POST' });

		if (offer?.kind === 'source') window.location.href = '/settings/updates';
	}

	const showing = $derived(Boolean(offer) && !dismissed);
</script>

{#if showing}
	<div class="banner" role="status">
		<span class="what">
			{#if offer?.kind === 'release'}
				<strong>Catalog {offer.version} is ready.</strong> Restart to install it.
			{:else}
				<strong>An update is ready.</strong> There are changes that aren't in your app yet.
			{/if}
		</span>

		<span class="actions">
			<button type="button" class="btn btn-primary" disabled={starting} onclick={updateNow}>
				{starting ? 'Starting…' : 'Update'}
			</button>
			<button type="button" class="btn" onclick={notNow}>Not now</button>
			<button type="button" class="btn quiet" onclick={never}>Don't ask again</button>
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
		background: var(--accent-bg);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
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

	.quiet {
		border-color: transparent;
		background: transparent;
		color: var(--ink-faint);
	}

	.quiet:hover {
		background: transparent;
		color: var(--ink);
	}
</style>
