<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { WATCH_REGIONS } from '$lib/constants';
	import { signInOutcome } from '$lib/signInWindow';
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
	/** Which debrid service the form is for: the one picked, else the saved one, else Real-Debrid. */
	let debridPick = $state('');
	const debridChoice = $derived(debridPick || data.debrid.service || 'realdebrid');
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
	/** How the last account added went, as the app saved it: shown under More accounts. */
	let moreResult = $state<{ ok: boolean; text: string } | null>(null);

	async function addAccount() {
		addingMore = true;
		moreFailed = false;
		moreResult = null;
		const asked = Date.now();
		const popup = window.open('https://www.febbox.com/login#catalog-more', '_blank');
		const last = await signInOutcome('more', asked, popup);
		await invalidateAll();
		addingMore = false;
		if (!last || last.result === 'closed') moreFailed = true;
		else if (last.result === 'added') moreResult = { ok: true, text: `Added ${last.name || 'the account'}.` };
		else if (last.result === 'same') moreResult = { ok: false, text: `${last.name || 'That account'} is already signed in here. Log in with a different one.` };
		else if (last.result === 'refused') moreResult = { ok: false, text: "Febbox didn't log that account in. Try again." };
		else moreResult = { ok: false, text: "Febbox couldn't be reached. Try again in a minute." };
	}

	async function loginToFebbox() {
		loggingIn = true;
		loginFailed = false;
		const asked = Date.now();
		const popup = window.open('https://www.febbox.com/login', '_blank');
		if (!popup) {
			loggingIn = false;
			return;
		}
		await signInOutcome('main', asked, popup);
		const result = await fetch('/api/watch/sync-cookies', { method: 'POST' })
			.then((r) => r.json())
			.catch(() => null);
		loginFailed = result?.signedIn === false;
		loggingIn = false;
		invalidateAll();
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
			>. Either key it shows works.
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
			Optional. IMDb, Rotten Tomatoes and Metacritic scores, age ratings and box office from
			<a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">OMDb</a>. Pick
			<strong>FREE</strong>, then click the link in their email.
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
			<h2>Showbox</h2>
			<span class="pill" class:completed={data.febboxKeySaved} class:planned={!data.febboxKeySaved}>
				{data.febboxKeySaved ? 'On' : 'Off'}
			</span>
		</div>

		<p class="muted">
			Optional. An extra source, often with the sharpest copies. Log in once with a free Febbox
			account and the key saves itself. A friend can use yours by pasting your key.
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
				<span class="muted">{mainAccount?.name ? `Logged in as ${mainAccount.name}.` : 'Logged in.'}{#if mainAccount && usage(mainAccount)}<span class="usage">{usage(mainAccount)}</span>{/if}</span>
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
					Each account has its own daily HD allowance. Catalog uses whichever has the most left.
				</p>
				{#if moreResult}
					<p class="msg" class:good={moreResult.ok} class:bad={!moreResult.ok} role="status">{moreResult.text}</p>
				{:else if form?.moreError}
					<p class="msg bad" role="alert">{form.moreError}</p>
				{:else if form?.moreOk}
					<p class="msg good" role="status">{form.moreOk}</p>
				{:else if moreFailed}
					<p class="msg bad" role="alert">No account was added: the login window closed before Febbox logged in.</p>
				{/if}
				{#each others as account, at (account.key)}
					<div class="saved-row">
						<span class="muted">{account.name || `Account ${at + 2}`}{#if usage(account)}<span class="usage">{usage(account)}</span>{/if}</span>
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

	<!-- A debrid service (src/lib/server/sources/debrid.ts): two more copies of everything when a key is saved. -->
	<section>
		<div class="head">
			<h2>Debrid</h2>
			<span class="pill" class:completed={data.debrid.on}>{data.debrid.on ? data.debrid.name : 'Off'}</span>
		</div>

		<p class="muted">
			Optional. Adds a 1080p and a 4K copy of everything from your Real-Debrid, TorBox, AllDebrid or
			Premiumize account.
		</p>

		{#if form?.debridError}
			<p class="msg bad" role="alert">{form.debridError}</p>
		{:else if form?.debridOk}
			<p class="msg good" role="status">{form.debridOk}</p>
		{/if}

		{#if data.debrid.on}
			<div class="saved-row">
				<span class="muted">{data.debrid.name} key saved.</span>
				<form method="POST" action="?/removeDebrid">
					<button type="submit" class="btn btn-danger">Remove</button>
				</form>
			</div>
			<details>
				<summary>Use another account or service</summary>
				{@render debridForm()}
			</details>
		{:else}
			{@render debridForm()}
		{/if}
	</section>

	<!-- Stremio addons (src/lib/server/sources/addons.ts): two more copies of everything per addon. -->
	<section>
		<div class="head">
			<h2>Stremio addons</h2>
			<span class="pill" class:completed={data.addons.length > 0}>{data.addons.length ? `${data.addons.length} added` : 'None'}</span>
		</div>

		<p class="muted">
			Optional. Paste an addon's install link (it ends in manifest.json). Its streams become copies in the
			player and its lists become rows in Browse. Torrent-only addons need debrid.
		</p>

		{#if form?.addonError}
			<p class="msg bad" role="alert">{form.addonError}</p>
		{:else if form?.addonOk}
			<p class="msg good" role="status">{form.addonOk}</p>
		{/if}

		{#if data.addons.length}
			<ul class="addons">
				{#each data.addons as addon, i (addon.key)}
					<li>
						<div>
							<strong>{addon.name}</strong>
							<span class="muted">{[addon.site, addon.movies && addon.shows ? 'streams for films and shows' : addon.movies ? 'streams for films' : addon.shows ? 'streams for shows' : '', addon.lists ? `${addon.lists} ${addon.lists === 1 ? 'list' : 'lists'} in Browse` : ''].filter(Boolean).join(' · ')}</span>
						</div>
						{#if i > 0}
							<form method="POST" action="?/raiseAddon">
								<input type="hidden" name="key" value={addon.key} />
								<button type="submit" class="btn" title="Its copies come before the one above">Move up</button>
							</form>
						{/if}
						<form method="POST" action="?/removeAddon">
							<input type="hidden" name="key" value={addon.key} />
							<button type="submit" class="btn btn-danger">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form method="POST" action="?/addAddon" class="inline-form">
			<input type="password" name="addonLink" placeholder="https://.../manifest.json or stremio://..." autocomplete="off" />
			<button type="submit" class="btn btn-primary">Add</button>
		</form>
	</section>

	{#snippet debridForm()}
		<form method="POST" action="?/saveDebrid" class="inline-form">
			<select name="debridService" aria-label="Debrid service" value={debridChoice} onchange={(e) => (debridPick = e.currentTarget.value)}>
				{#each data.debrid.services as service (service.id)}
					<option value={service.id}>{service.name}</option>
				{/each}
			</select>
			<input type="password" name="debridKey" placeholder="Paste your API key" autocomplete="off" />
			<button type="submit" class="btn btn-primary">Save</button>
		</form>
		{@const chosen = data.debrid.services.find((s) => s.id === debridChoice)}
		{#if chosen}
			<p class="muted">Your key is on <a href={chosen.keyPage} target="_blank" rel="noreferrer">{chosen.name}'s API page</a>.</p>
		{/if}
	{/snippet}

	<section>
		<div class="head">
			<h2>Where to watch</h2>
			<span class="pill completed">{data.regionInUse}</span>
		</div>

		<p class="muted">
			What's streaming, free or for rent depends on the country. Catalog uses this computer's unless
			you pick one.
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

	/* Key boxes look like every other box (app.css styles text boxes, not password ones). */
	.inline-form input[type='password'] {
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		padding: 8px 10px;
	}

	.addons {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.addons li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--rule);
		border-radius: 8px;
		background: var(--surface-2);
	}
	.addons li > div {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.addons li form {
		margin: 0;
	}

	/* Debrid's service menu: only as wide as its longest name, so the key box keeps the room. */
	.inline-form select {
		flex: none;
		width: auto;
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
		/* On a phone the buttons go under the name instead of past the screen's edge. */
		flex-wrap: wrap;
	}

	.saved-row .muted {
		font-size: 0.9rem;
	}

	.saved-actions {
		display: flex;
		flex-wrap: wrap;
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
