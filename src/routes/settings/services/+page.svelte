<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
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
			Anime works without setup. Films and TV need a free key from
			<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer"
				>themoviedb.org</a
			>. Either the API Key or the Read Access Token works.
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
			<p class="faint hint">Checked against TMDB before saving.</p>
		{/if}
	</section>

	<section>
		<div class="head">
			<h2>IMDb and Rotten Tomatoes</h2>
			<span class="pill" class:completed={data.omdbKeySaved}>
				{data.omdbKeySaved ? 'On' : 'Off'}
			</span>
		</div>

		<p class="muted">
			Optional. TMDB carries its own score and nothing else, so IMDb, Rotten Tomatoes and
			Metacritic come from
			<a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">OMDb</a>,
			which is free for 1,000 lookups a day. Pick <strong>FREE</strong>, and they email you a
			key you have to click to activate.
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
			<p class="faint hint">
				Scores are looked up once per title and then stored, so the daily limit is generous.
			</p>
		{/if}
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

	.hint {
		font-size: 0.8rem;
		margin: 0;
	}
</style>
