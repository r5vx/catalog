<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { WATCH_REGIONS } from '$lib/constants';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loggingIn = $state(false);
	/** The login window closed without Febbox signing anyone in (a wrong password, say). */
	let loginFailed = $state(false);
	let copied = $state(false);

	function copyKey() {
		navigator.clipboard.writeText(data.febboxToken);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const countries = (() => {
		let name: (code: string) => string;

		try {
			const names = new Intl.DisplayNames(undefined, { type: 'region' });
			name = (code) => names.of(code) ?? code;
		} catch {
			name = (code) => code;
		}

		return WATCH_REGIONS.map((code) => ({ code, name: name(code) })).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
	})();

	const inDesktopApp = typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent);
	const others = $derived(data.febboxAccounts.filter((a) => !a.main));
	const mainAccount = $derived(data.febboxAccounts.find((a) => a.main));
	let addingMore = $state(false);
	let moreFailed = $state(false);

	/** "2.4 of 10 GB used today", or when a used-up allowance comes back. */
	function usage(account: (typeof data.febboxAccounts)[number]): string {
		if (account.expired) return 'Logged out: remove it and add it again';
		const flow = account.flow;
		if (!flow) return '';
		if (flow.out) {
			const hours = flow.resetsAt ? Math.max(1, Math.round((flow.resetsAt - Date.now()) / 3600_000)) : 0;
			return hours ? `HD used up for today, back in about ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'HD used up for today';
		}
		return `${flow.used} of ${flow.allowance} GB of HD used today`;
	}

	/** Another Febbox account's sign-in, in a window of its own (the main account stays signed in). */
	function addAccount() {
		addingMore = true;
		moreFailed = false;
		const before = others.length;
		const popup = window.open('https://www.febbox.com/login#catalog-more', '_blank');
		if (!popup) {
			addingMore = false;
			return;
		}
		const poll = setInterval(async () => {
			if (!popup.closed) return;
			clearInterval(poll);
			// The window saves the sign-in as it closes: a moment for that, then look again.
			await new Promise((r) => setTimeout(r, 2500));
			await invalidateAll();
			moreFailed = others.length === before;
			addingMore = false;
		}, 500);
	}

	function loginToFebbox() {
		loggingIn = true;
		loginFailed = false;
		const popup = window.open('https://www.febbox.com/login', '_blank');
		if (!popup) {
			loggingIn = false;
			return;
		}
		const poll = setInterval(async () => {
			if (popup.closed) {
				clearInterval(poll);
				const result = await fetch('/api/watch/sync-cookies', { method: 'POST' })
					.then((r) => r.json())
					.catch(() => null);
				loginFailed = result?.signedIn === false;
				loggingIn = false;
				invalidateAll();
			}
		}, 500);
	}
</script>

<svelte:head><title>Services · Catalog</title></svelte:head>

<div class="sections">
	<section>
		<div class="head">
			<h2>Film and TV search</h2>
			<span class="pill" class:completed={data.tmdbKeySaved} class:planned={!data.tmdbKeySaved}>
				{data.tmdbKeySaved ? 'On' : 'Off'}
			</span>
		</div>

		<p class="muted">
			Films and TV need a free key from
			<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer"
				>themoviedb.org</a
			>. Anime doesn't. Either key they show you works.
		</p>

		{#if form?.tmdbError}
			<p class="msg bad" role="alert">{form.tmdbError}</p>
		{:else if form?.tmdbOk}
			<p class="msg good" role="status">{form.tmdbOk}</p>
		{/if}

		{#if data.tmdbKeySaved}
			<div class="saved-row">
				<span class="muted">A key is saved and working.</span>
				<form method="POST" action="?/removeTmdb">
					<button type="submit" class="btn btn-danger">Remove</button>
				</form>
			</div>
			<details>
				<summary>Replace it</summary>
				<form method="POST" action="?/saveTmdb" class="inline-form">
					<input
						type="password"
						name="tmdbApiKey"
						placeholder="Paste a new key"
						autocomplete="off"
					/>
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
		{:else}
			<form method="POST" action="?/saveTmdb" class="inline-form">
				<input
					type="password"
					name="tmdbApiKey"
					placeholder="Paste your TMDB key here"
					autocomplete="off"
				/>
				<button type="submit" class="btn btn-primary">Save</button>
			</form>
		{/if}
	</section>

	<section>
		<div class="head">
			<h2>More scores</h2>
			<span class="pill" class:completed={data.omdbKeySaved}>
				{data.omdbKeySaved ? 'On' : 'Off'}
			</span>
		</div>

		<p class="muted">
			IMDb, Rotten Tomatoes, Metacritic, the age rating, awards and box office. Optional,
			from <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">OMDb</a>
			— pick <strong>FREE</strong>, then click the link they email you or the key won't work.
		</p>

		{#if form?.omdbError}
			<p class="msg bad" role="alert">{form.omdbError}</p>
		{:else if form?.omdbOk}
			<p class="msg good" role="status">{form.omdbOk}</p>
		{/if}

		{#if data.omdbKeySaved}
			<div class="saved-row">
				<span class="muted">A key is saved and working.</span>
				<form method="POST" action="?/removeOmdb">
					<button type="submit" class="btn btn-danger">Remove</button>
				</form>
			</div>
			<details>
				<summary>Replace it</summary>
				<form method="POST" action="?/saveOmdb" class="inline-form">
					<input
						type="password"
						name="omdbApiKey"
						placeholder="Paste a new key"
						autocomplete="off"
					/>
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
		{:else}
			<form method="POST" action="?/saveOmdb" class="inline-form">
				<input
					type="password"
					name="omdbApiKey"
					placeholder="Paste your OMDb key here"
					autocomplete="off"
				/>
				<button type="submit" class="btn">Save</button>
			</form>
		{/if}
	</section>

	<section>
		<div class="head">
			<h2>Watch</h2>
			<span class="pill" class:completed={data.febboxKeySaved} class:planned={!data.febboxKeySaved}>
				{data.febboxKeySaved ? 'On' : 'Off'}
			</span>
		</div>

		<p class="muted">
			Lets you watch movies and shows inside Catalog. Log in once and the key saves itself.
			To share with a friend, have them paste your key below.
		</p>

		{#if loginFailed}
			<p class="msg bad" role="alert">Febbox didn't log you in. Check the email and password, and try again.</p>
		{:else if form?.febboxError}
			<p class="msg bad" role="alert">{form.febboxError}</p>
		{:else if form?.febboxOk}
			<p class="msg good" role="status">{form.febboxOk}</p>
		{/if}

		{#if data.febboxKeySaved}
			<div class="saved-row">
				<span class="muted">Logged in.{#if mainAccount && usage(mainAccount)}<span class="usage">{usage(mainAccount)}</span>{/if}</span>
				<div class="saved-actions">
					<button type="button" class="btn" onclick={copyKey}>
						{copied ? 'Copied' : 'Copy key'}
					</button>
					<button type="button" class="btn" onclick={loginToFebbox} disabled={loggingIn}>
						{loggingIn ? 'Logging in…' : 'Log in again'}
					</button>
					<form method="POST" action="?/removeFebbox">
						<button type="submit" class="btn btn-danger">Remove</button>
					</form>
				</div>
			</div>
			<details>
				<summary>Paste a key instead</summary>
				<form method="POST" action="?/saveFebbox" class="inline-form">
					<input
						type="password"
						name="febboxKey"
						placeholder="Paste a key"
						autocomplete="off"
					/>
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
			<div class="more">
				<h3>More accounts</h3>
				<p class="muted">
					Each Febbox account gets its own HD allowance a day. With more than one, every video uses
					whichever has the most left, so several TVs can watch at once without dropping to 360p.
				</p>
				{#if form?.moreError}
					<p class="msg bad" role="alert">{form.moreError}</p>
				{:else if form?.moreOk}
					<p class="msg good" role="status">{form.moreOk}</p>
				{:else if moreFailed}
					<p class="msg bad" role="alert">No account was added. A different account than the ones above has to log in.</p>
				{/if}
				{#each others as account, at (account.key)}
					<div class="saved-row">
						<span class="muted">Account {at + 2}{#if usage(account)}<span class="usage">{usage(account)}</span>{/if}</span>
						<form method="POST" action="?/removeFebboxMore">
							<input type="hidden" name="key" value={account.key} />
							<button type="submit" class="btn btn-danger">Remove</button>
						</form>
					</div>
				{/each}
				{#if inDesktopApp}
					<button type="button" class="btn" onclick={addAccount} disabled={addingMore}>
						{addingMore ? 'Logging in…' : 'Add another account'}
					</button>
				{/if}
				<details>
					<summary>{inDesktopApp ? 'Paste its key instead' : "Paste another account's key"}</summary>
					<form method="POST" action="?/saveFebboxMore" class="inline-form">
						<input type="password" name="febboxKey" placeholder="Paste a key" autocomplete="off" />
						<button type="submit" class="btn btn-primary">Add</button>
					</form>
				</details>
			</div>
		{:else}
			<button type="button" class="btn btn-primary login-btn" onclick={loginToFebbox} disabled={loggingIn}>
				{loggingIn ? 'Logging in…' : 'Log in with Google'}
			</button>
			<details>
				<summary>Paste a key instead</summary>
				<form method="POST" action="?/saveFebbox" class="inline-form">
					<input
						type="password"
						name="febboxKey"
						placeholder="Paste a key"
						autocomplete="off"
					/>
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
		{/if}
	</section>

	<section>
		<div class="head">
			<h2>Where to watch</h2>
			<span class="pill completed">{data.regionInUse}</span>
		</div>

		<p class="muted">
			Titles show what's streaming, free, or for rent — which depends entirely on the country
			asking. Catalog follows this PC unless you tell it otherwise.
		</p>

		<select
			aria-label="Country"
			onchange={async (e) => {
				const body = new FormData();
				body.set('watchRegion', e.currentTarget.value);
				await fetch('?/saveRegion', { method: 'POST', body });
			}}
		>
			<option value="" selected={!data.region}>This PC's country ({data.detectedRegion})</option>
			{#each countries as country (country.code)}
				<option value={country.code} selected={data.region === country.code}>
					{country.name}
				</option>
			{/each}
		</select>
	</section>
</div>

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: 38px;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
	}

	h2 {
		font-size: 1.1rem;
	}

	.muted {
		font-size: 0.93rem;
		margin: 0;
	}

	.muted a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.inline-form {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}

	.inline-form input {
		flex: 1;
		min-width: 0;
	}

	.saved-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
	}

	.saved-row .muted {
		font-size: 0.9rem;
	}

	.saved-actions {
		display: flex;
		gap: 8px;
	}

	.login-btn {
		align-self: flex-start;
	}

	details summary {
		font-size: 0.87rem;
		color: var(--ink-soft);
		cursor: pointer;
		padding: 4px 0;
	}

	details summary:hover {
		color: var(--accent);
	}

	details .inline-form {
		margin-top: 10px;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.good {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
	}

	.usage {
		display: block;
		font-size: 0.82rem;
		color: var(--ink-faint);
	}

	.more {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		margin-top: 8px;
		padding-top: 16px;
		border-top: 1px solid var(--rule);
	}

	.more h3 {
		margin: 0;
		font-size: 1rem;
	}

	.more p {
		margin: 0;
	}

	.more .saved-row {
		align-self: stretch;
	}
</style>
