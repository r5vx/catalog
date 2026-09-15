<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Welcome · Catalog</title></svelte:head>

<div class="wrap">
	<h1>Catalog</h1>
	<p class="lead">Your library of every film, series and anime you've watched.</p>

	<section>
		<h2>One thing to set up</h2>
		<p class="muted">
			Films and TV need a free key from
			<a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">themoviedb.org</a>.
			Anime doesn't.
		</p>

		<ol class="steps">
			<li>Make an account there.</li>
			<li>Open <strong>Settings → API</strong> and request a key.</li>
			<li>Paste it below.</li>
		</ol>

		{#if form?.keyError}
			<p class="msg bad" role="alert">{form.keyError}</p>
		{/if}

		<form method="POST" action="?/saveKey" class="inline-form">
			<input
				type="password"
				name="tmdbApiKey"
				placeholder="Paste your key"
				autocomplete="off"
				aria-label="TMDB key"
			/>
			<button type="submit" class="btn btn-primary">Start</button>
		</form>
	</section>

	<form method="POST" action="?/skip">
		<button type="submit" class="btn skip">Skip — I'll add it later</button>
	</form>
</div>

<style>
	.wrap {
		max-width: 46ch;
		margin: 6vh auto 0;
		display: flex;
		flex-direction: column;
		gap: 26px;
	}

	h1 {
		font-size: clamp(2rem, 7vw, 2.8rem);
		margin: 0;
	}

	.lead {
		color: var(--ink-soft);
		margin: -20px 0 0;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0 0 8px;
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

	.steps {
		margin: 14px 0;
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.inline-form {
		display: flex;
		gap: 8px;
		margin-top: 14px;
	}

	.inline-form input {
		flex: 1;
		min-width: 0;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 14px 0 0;
		font-size: 0.89rem;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.skip {
		border-color: transparent;
		background: transparent;
		color: var(--ink-faint);
		padding-left: 0;
	}

	.skip:hover {
		background: transparent;
		color: var(--ink);
	}
</style>
