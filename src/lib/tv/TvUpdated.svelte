<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { isTv } from '$lib/tv';
	import { FIRE_TV_CODE, TV_APP_VERSION } from '$lib/tvInstall';

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
	type TvApp = { appVersion?: () => number; installUpdate?: (url: string) => void; canInstall?: () => boolean };
	const tvApp = () => (window as unknown as { CatalogTV?: TvApp }).CatalogTV;
	let appOld = $state(false);
	let appState = $state('');

	/*
	 * Fire TV lets an app install an update only once "Install unknown apps" is switched on for
	 * it, in Fire TV's own settings. The app opens those settings, but they open on a page that
	 * doesn't say what to do, and the one-line hint was hidden behind them (a family TV, 2026-11-12:
	 * Update "brought her to a device and software page" and nothing worked). So the steps are
	 * shown as a whole screen: before the settings open when the TV app can say the switch is off
	 * (1.9 on, `canInstall`), and for older ones when she comes back from them.
	 */
	let steps = $state(false);
	let stepsButton: HTMLButtonElement | undefined = $state();
	/** The settings were opened from the steps: back in Catalog with the switch on, the update starts by itself. */
	let wentToSettings = false;

	/*
	 * An update the TV app can't install by itself: an app from before 1.4 (no self-update), or one
	 * whose own install failed. Then it's Downloader, as when it was first put on the TV, and the
	 * steps say so (owner, 2026-11-22: a TV that needs Downloader should say that).
	 */
	let downloader = $state(false);
	let downloaderWhy = $state('');
	let downloaderButton: HTMLButtonElement | undefined = $state();

	const LATER = 'catalog:tvAppLater';
	const DAY = 24 * 60 * 60 * 1000;

	function startInstall() {
		const tv = tvApp();
		if (!tv?.installUpdate) return;
		appState = 'Getting the update…';
		tv.installUpdate(`${location.origin}/catalog-tv.apk`);
	}

	function updateApp() {
		const tv = tvApp();
		if (!tv?.installUpdate) return;
		// The switch is known to be off: the steps first, the settings from there.
		if (tv.canInstall && !tv.canInstall()) {
			steps = true;
			return;
		}
		startInstall();
	}

	/** Continue on the steps: opens Fire TV's settings while the switch is off, installs once it's on. */
	function continueSteps() {
		const tv = tvApp();
		if (!tv?.installUpdate) return;
		if (tv.canInstall?.()) steps = false;
		else wentToSettings = true;
		startInstall();
	}

	/** Not now: the offer stays away for a day. */
	function later() {
		steps = false;
		appOld = false;
		downloader = false;
		try {
			localStorage.setItem(LATER, String(Date.now()));
		} catch {}
	}

	function stepsKey(event: KeyboardEvent) {
		if (!steps && !downloader) return;
		const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tv-steps button'));
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const next = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, at - 1) : Math.min(buttons.length - 1, at + 1);
			buttons[next]?.focus();
		} else if (event.key === 'Escape' || event.key === 'GoBack' || event.key === 'BrowserBack' || event.key === 'Backspace') {
			if (downloader) later();
			else steps = false;
		} else if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		} else if (at < 0) {
			buttons[0]?.click();
		} else {
			return; // Enter on a button presses it as usual
		}
		event.preventDefault();
		event.stopPropagation();
	}

	onMount(() => {
		const tv = tvApp();
		if (!tv) return;
		let putOff = 0;
		try {
			putOff = Number(localStorage.getItem(LATER)) || 0;
		} catch {}
		const offer = Date.now() - putOff > DAY;
		// Too old to update itself: Downloader's steps instead.
		if (!tv.appVersion || !tv.installUpdate) {
			downloader = offer;
			window.addEventListener('keydown', stepsKey, true);
			return () => window.removeEventListener('keydown', stepsKey, true);
		}
		appOld = tv.appVersion() < TV_APP_VERSION && offer;
		(window as unknown as { __catalogTvUpdate: (state: string, detail: string) => void }).__catalogTvUpdate = (state, detail) => {
			if (state === 'downloading') appState = `Getting the update… ${detail}%`;
			else if (state === 'allow') {
				appState = '';
				steps = true;
			} else if (state === 'confirm') {
				steps = false;
				appState = 'Choose Update on the next screen';
			} else if (state === 'failed') {
				// Its own install didn't work: Downloader does it the way it was first installed.
				appState = '';
				steps = false;
				downloaderWhy = detail;
				downloader = true;
			}
		};
		// Back from Fire TV's settings with the switch on: the update carries on by itself.
		const back = () => {
			if (document.visibilityState !== 'visible' || !steps || !wentToSettings) return;
			if (tvApp()?.canInstall?.()) {
				wentToSettings = false;
				steps = false;
				startInstall();
			}
		};
		document.addEventListener('visibilitychange', back);
		window.addEventListener('focus', back);
		window.addEventListener('keydown', stepsKey, true);
		return () => {
			document.removeEventListener('visibilitychange', back);
			window.removeEventListener('focus', back);
			window.removeEventListener('keydown', stepsKey, true);
		};
	});

	$effect(() => {
		if (steps && stepsButton) stepsButton.focus({ preventScroll: true });
	});
	$effect(() => {
		if (!downloader || watching || !downloaderButton) return;
		const button = downloaderButton;
		button.focus({ preventScroll: true });
		// (Again once the TV layout has put its own first highlight on the page behind.)
		const again = setTimeout(() => button.focus({ preventScroll: true }), 800);
		return () => clearTimeout(again);
	});

	/*
	 * The TV app showing the computer's screens (the "normal layout" switch, for every TV in the
	 * house): on the library, the way back to the TV layout is offered, highlighted, so OK takes
	 * it. A family TV ended up here without anyone meaning to (2026-11-13).
	 */
	let onTvApp = $state(false);
	let layoutButton: HTMLButtonElement | undefined = $state();
	const offerTvLayout = $derived(onTvApp && page.url.pathname === '/' && !updated && !steps && !appOld && !downloader);

	onMount(() => {
		onTvApp = Boolean(tvApp());
	});

	async function useTvLayout() {
		await fetch('/api/tv-layout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ layout: 'tv' })
		}).catch(() => {});
		location.href = '/';
	}

	$effect(() => {
		if (offerTvLayout && layoutButton) layoutButton.focus({ preventScroll: true });
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

{#if appOld && !watching && !updated && !steps && !downloader}
	<div class="tv-updated" role="status">
		<span>{appState || 'A new Catalog TV app is ready'}</span>
		<button type="button" data-tv-item onclick={updateApp}>Update</button>
		<button type="button" data-tv-item onclick={later}>Later</button>
	</div>
{/if}

{#if appOld && steps && !watching}
	<div class="tv-steps" role="dialog" aria-label="Updating the Catalog TV app">
		<div class="card">
			<h2>One switch to turn on first</h2>
			<p>Fire TV asks this once, before Catalog can update itself.</p>
			<ol>
				<li>Choose <strong>Continue</strong> below. Fire TV's settings open.</li>
				<li>If you see <strong>Install unknown apps</strong>, choose it.</li>
				<li>Choose <strong>Catalog</strong>, so it says <strong>ON</strong>.</li>
				<li>Press <strong>Back</strong> on the remote until this screen shows again.</li>
				<li>Choose <strong>Continue</strong> again, then <strong>Update</strong> on Fire TV's screen.</li>
			</ol>
			<div class="row">
				<button type="button" bind:this={stepsButton} onclick={continueSteps}>Continue</button>
				<button type="button" onclick={later}>Not now</button>
			</div>
		</div>
	</div>
{/if}

{#if downloader && !watching}
	<div class="tv-steps" role="dialog" aria-label="Updating the Catalog TV app with Downloader">
		<div class="card">
			<h2>A new Catalog TV app is ready</h2>
			<p>{downloaderWhy ? `It didn't install by itself (${downloaderWhy}). ` : "This TV's Catalog app is too old to update itself. "}Downloader gets it, the same way it was first put on this TV.</p>
			<ol>
				<li>Press <strong>Home</strong> on the remote and open <strong>Downloader</strong>.</li>
				<li>Type the code <strong>{FIRE_TV_CODE}</strong> and choose <strong>Go</strong>.</li>
				<li>Choose <strong>Install</strong>, then <strong>Open</strong>.</li>
			</ol>
			<p>Profiles, Continue Watching and everything else on this TV stay as they are.</p>
			<div class="row">
				<button type="button" bind:this={downloaderButton} onclick={later}>OK</button>
			</div>
		</div>
	</div>
{/if}

{#if offerTvLayout}
	<div class="tv-updated" role="status">
		<span>This TV is on the computer's layout</span>
		<button type="button" data-tv-item bind:this={layoutButton} onclick={useTvLayout}>Use the TV layout</button>
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

	/* The steps for Fire TV's "Install unknown apps" switch: a whole screen, readable from the sofa. */
	.tv-steps {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		place-items: center;
		background: rgba(8, 10, 9, 0.92);
		color: #fff;
	}

	.tv-steps .card {
		width: min(62vw, 1100px);
		padding: 3vw 3.4vw;
		border-radius: 1.6vw;
		background: #171c1a;
		box-shadow: 0 1vw 4vw rgba(0, 0, 0, 0.6);
	}

	.tv-steps h2 {
		margin: 0 0 0.6vw;
		font-size: 2.6vw;
	}

	.tv-steps p {
		margin: 0 0 1.4vw;
		font-size: 1.5vw;
		color: rgba(255, 255, 255, 0.7);
	}

	.tv-steps ol {
		margin: 0 0 2vw;
		padding-left: 2.2vw;
		font-size: 1.8vw;
		line-height: 1.55;
	}

	.tv-steps .row {
		display: flex;
		gap: 1.2vw;
	}

	.tv-steps button {
		font-size: 1.7vw;
		padding: 0.8vw 2.4vw;
	}
</style>
