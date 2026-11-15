<script lang="ts">
	import { page } from '$app/state';
	import { p } from '$lib/altText';

	/**
	 * Says when there's no TMDB key: without one Browse, the watch lists, posters and episode lists
	 * stay empty or keep loading, and nothing said why (a friend's first install, 2026-11-14).
	 * "Not now" hides it until Catalog is opened again; it comes back until a key is saved.
	 */
	let { missing }: { missing: boolean | undefined } = $props();

	const SESSION_KEY = 'catalog.tmdbBannerDismissed';
	let dismissed = $state(false);

	$effect(() => {
		try {
			if (sessionStorage.getItem(SESSION_KEY) === '1') dismissed = true;
		} catch {}
	});

	function notNow() {
		dismissed = true;
		try {
			sessionStorage.setItem(SESSION_KEY, '1');
		} catch {}
	}

	const t = (text: string) => (page.data.altMode ? p(text) : text);

	// Not where the key goes, on the PIN or first-run pages, over the player, or on a TV.
	const here = $derived(
		['/settings/services', '/login', '/welcome', '/watch'].includes(page.url.pathname) || page.url.pathname.startsWith('/tv')
	);
	const showing = $derived(Boolean(missing) && !dismissed && !here);
</script>

{#if showing}
	<div class="banner" role="status">
		<span class="what">
			<strong>{t('Catalog needs a TMDB key.')}</strong>
			{t("Without one, Browse, watch lists, posters and episodes stay empty. It's free from themoviedb.org.")}
		</span>
		<span class="actions">
			<a href="/settings/services" class="btn btn-primary">{t('Add a TMDB key')}</a>
			<button type="button" class="btn" onclick={notNow}>{t('Not now')}</button>
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
