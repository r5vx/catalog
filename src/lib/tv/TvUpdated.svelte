<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { isTv } from '$lib/tv';
	import { TV_APP_VERSION } from '$lib/tvInstall';

	/**
	 * A TV keeps the Catalog it loaded until it's reloaded, so after the computer updates, it's
	 * still the old one (the TV app was force-stopped each time). The TV asks the computer its
	 * version every minute; when it changes, Reload comes up, highlighted, so OK picks it up — or
	 * by itself if the remote isn't touched for 10 minutes. Never over something playing: it waits
	 * until the player is left.
	 */
	const LOOK_EVERY = 60 * 1000;
	const BY_ITSELF_AFTER = 10 * 60 * 1000;

	let updated = $state(false);
	let button: HTMLButtonElement | undefined = $state();
	let lastKey = Date.now();
	const watching = $derived(page.url.pathname.startsWith('/watch'));

	const reload = () => location.reload();

	/*
	 * The TV app itself (android/), newer on the computer than on this TV: Update installs it from
	 * the computer over this one, keeping everything (SelfUpdate.java, TV app 1.4 on). Fire TV asks
	 * once to allow it, then shows its own Update screen.
	 */
	type TvApp = { appVersion?: () => number; installUpdate?: (url: string) => void };
	let appOld = $state(false);
	let appState = $state('');
	let appButton: HTMLButtonElement | undefined = $state();
	function updateApp() {
		const tv = (window as unknown as { CatalogTV?: TvApp }).CatalogTV;
		if (!tv?.installUpdate) return;
		appState = 'Getting the update…';
		tv.installUpdate(`${location.origin}/catalog-tv.apk`);
	}
	onMount(() => {
		const tv = (window as unknown as { CatalogTV?: TvApp }).CatalogTV;
		if (!tv?.appVersion || !tv.installUpdate) return;
		appOld = tv.appVersion() < TV_APP_VERSION;
		(window as unknown as { __catalogTvUpdate: (state: string, detail: string) => void }).__catalogTvUpdate = (state, detail) => {
			if (state === 'downloading') appState = `Getting the update… ${detail}%`;
			else if (state === 'allow') appState = 'Allow it first: Settings → My Fire TV → Developer options → Install unknown apps → Catalog → On, then Update again';
			else if (state === 'confirm') appState = 'Choose Update on the next screen';
			else if (state === 'failed') appState = `The update didn't install: ${detail}`;
		};
	});

	onMount(() => {
		if (!isTv()) return;
		let first = '';
		const look = async () => {
			try {
				const { version } = await (await fetch('/api/version', { cache: 'no-store' })).json();
				if (!version) return;
				if (!first) first = version;
				else if (version !== first) updated = true;
			} catch {
				// The computer restarting to install it: asked again in a minute.
			}
		};
		look();
		const timer = setInterval(() => {
			look();
			if (updated && !watching && Date.now() - lastKey > BY_ITSELF_AFTER) reload();
		}, LOOK_EVERY);
		const pressed = () => (lastKey = Date.now());
		window.addEventListener('keydown', pressed, true);
		return () => {
			clearInterval(timer);
			window.removeEventListener('keydown', pressed, true);
		};
	});

	// Highlighted when it appears (not while something's playing), so OK reloads.
	$effect(() => {
		if (updated && !watching && button) button.focus({ preventScroll: true });
	});
</script>

{#if appOld && !watching && !updated}
	<div class="tv-updated" role="status">
		<span>{appState || 'A new Catalog TV app is ready'}</span>
		<button type="button" data-tv-item bind:this={appButton} onclick={updateApp}>Update</button>
	</div>
{/if}

{#if updated && !watching}
	<div class="tv-updated" role="status">
		<span>Catalog was updated</span>
		<button type="button" data-tv-item bind:this={button} onclick={reload}>Reload</button>
	</div>
{/if}

<style>
	.tv-updated {
		position: fixed;
		top: 2.2vw;
		right: 3vw;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 1.2vw;
		padding: 0.8vw 0.8vw 0.8vw 1.6vw;
		border-radius: 999px;
		background: rgba(20, 24, 22, 0.94);
		box-shadow: 0 0.4vw 1.6vw rgba(0, 0, 0, 0.5);
		color: #fff;
		font-size: 1.5vw;
	}

	button {
		padding: 0.6vw 1.6vw;
		border: 0.2vw solid transparent;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:focus {
		outline: none;
		border-color: #fff;
		background: #fff;
		color: #000;
	}
</style>
