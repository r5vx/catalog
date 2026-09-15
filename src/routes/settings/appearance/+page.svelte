<script lang="ts">
	import { untrack } from 'svelte';
	import { ACCENT_PRESETS } from '$lib/accent';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Live preview: the page recolours as you pick, before you save.
	let accent = $state(untrack(() => data.accent));
	/** What's in the text box, which can be half-typed while you paste. */
	let typed = $state(untrack(() => data.accent));

	const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v.trim());

	function pick(value: string) {
		accent = value;
		typed = value;
	}

	/** Accept a pasted hex with or without the #, and only once it's complete. */
	function onHexInput(event: Event) {
		const raw = (event.target as HTMLInputElement).value.trim();
		typed = raw.startsWith('#') || raw === '' ? raw : `#${raw}`;
		if (isHex(typed)) accent = typed.toLowerCase();
	}
</script>

<svelte:head><title>Appearance · Catalog</title></svelte:head>

<section style="--accent: {accent}">
	<p class="muted">Buttons, links and highlights.</p>

	{#if form?.accentError}
		<p class="msg bad" role="alert">{form.accentError}</p>
	{:else if form?.accentOk}
		<p class="msg good" role="status">{form.accentOk}</p>
	{/if}

	<form method="POST" action="?/saveAccent" class="accent-form">
		<div class="swatches">
			{#each ACCENT_PRESETS as preset (preset.value)}
				<button
					type="button"
					class="swatch"
					class:picked={accent.toLowerCase() === preset.value}
					style="background: {preset.value}"
					title={preset.name}
					aria-label={preset.name}
					onclick={() => pick(preset.value)}
				></button>
			{/each}
		</div>

		<div class="accent-row">
			<input
				type="color"
				aria-label="Pick a colour"
				value={accent}
				oninput={(e) => pick(e.currentTarget.value)}
			/>

			<!-- The submitted value: type or paste a hex here, or use the picker. -->
			<input
				type="text"
				id="accentColor"
				name="accentColor"
				class="hex"
				value={typed}
				oninput={onHexInput}
				spellcheck="false"
				autocomplete="off"
				maxlength="7"
				placeholder="#8c2f39"
				aria-label="Colour hex code"
			/>

			<button type="submit" class="btn btn-primary" disabled={!isHex(typed)}>Save colour</button>
		</div>

		{#if typed && !isHex(typed)}
			<p class="faint hint">Needs six characters, like <code>#7a5af5</code>.</p>
		{/if}
	</form>

	<form method="POST" action="?/resetAccent">
		<button type="submit" class="btn btn-danger">Back to the original</button>
	</form>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: flex-start;
	}

	.muted {
		font-size: 0.93rem;
		margin: 0;
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

	.accent-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.swatch {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 2px solid transparent;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 15%);
		cursor: pointer;
		padding: 0;
	}

	.swatch.picked {
		border-color: var(--ink);
	}

	.accent-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.accent-row input[type='color'] {
		width: 52px;
		height: 36px;
		padding: 2px;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		background: var(--surface);
		cursor: pointer;
	}

	.hex {
		font-family: var(--mono);
		font-size: 0.88rem;
		width: 8.5em;
		flex: 0 0 auto;
		text-transform: lowercase;
	}

	.hint {
		font-size: 0.8rem;
		margin: 0;
	}

	.hint code {
		font-family: var(--mono);
		font-size: 0.85em;
	}
</style>
