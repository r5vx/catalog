<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { WATCH_REGIONS } from '$lib/constants';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loggingIn = $state(false);
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

	function loginToFebbox() {
		loggingIn = true;
		const popup = window.open('https://www.febbox.com/login', '_blank');
		if (!popup) {
			loggingIn = false;
			return;
		}
		const poll = setInterval(() => {
			if (popup.closed) {
				clearInterval(poll);
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

		{#if form?.febboxError}
			<p class="msg bad" role="alert">{form.febboxError}</p>
		{:else if form?.febboxOk}
			<p class="msg good" role="status">{form.febboxOk}</p>
		{/if}

		{#if data.febboxKeySaved}
			<div class="saved-row">
				<span class="muted">Logged in.</span>
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

		{#if form?.regionError}
			<p class="msg bad" role="alert">{form.regionError}</p>
		{:else if form?.regionOk}
			<p class="msg good" role="status">Saved.</p>
		{/if}

		<form method="POST" action="?/saveRegion" class="inline-form">
			<select name="watchRegion" aria-label="Country">
				<option value="" selected={!data.region}>This PC's country ({data.regionInUse})</option>
				{#each countries as country (country.code)}
					<option value={country.code} selected={data.region === country.code}>
						{country.name}
					</option>
				{/each}
			</select>
			<button type="submit" class="btn">Save</button>
		</form>
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
</style>
