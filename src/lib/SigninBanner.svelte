<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Says when there's no Showbox sign-in, or Showbox has stopped accepting it — otherwise
	 * Showbox episodes just won't load and nothing says why. "Not now" hides it until Catalog
	 * is opened again.
	 */
	type Signin = { state: 'ok' | 'missing' | 'expired' };

	let { signin }: { signin: Signin | undefined } = $props();

	const SESSION_KEY = 'catalog.signinDismissed';
	let dismissed = $state(false);

	$effect(() => {
		try {
			if (sessionStorage.getItem(SESSION_KEY) === signin?.state) dismissed = true;
		} catch {}
	});

	function notNow() {
		dismissed = true;
		try {
			sessionStorage.setItem(SESSION_KEY, signin?.state ?? '');
		} catch {}
	}

	// Not where you sign in, on the PIN page, or over the player.
	const here = $derived(['/settings/services', '/login', '/watch'].includes(page.url.pathname));
	const showing = $derived(Boolean(signin && signin.state !== 'ok') && !dismissed && !here);
</script>

{#if showing && signin}
	<div class="banner" role="status">
		<span class="what">
			{#if signin.state === 'expired'}
				<strong>Your Showbox sign-in has run out.</strong> Showbox episodes won't play until you sign in again.
			{:else}
				<strong>Showbox isn't signed in.</strong> Only anime from other sources will play.
			{/if}
		</span>
		<span class="actions">
			<a href="/settings/services" class="btn btn-primary">Sign in</a>
			<button type="button" class="btn" onclick={notNow}>Not now</button>
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
