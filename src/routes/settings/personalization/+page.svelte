<script lang="ts">
	import { untrack } from 'svelte';
	import { ACCENT_PRESETS } from '$lib/accent';
	import { SORTS, SORT_GROUPS } from '$lib/constants';
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

<svelte:head><title>Personalization · Catalog</title></svelte:head>

<div class="sections">
<section style="--accent: {accent}">
	<div class="head"><h2>Colour</h2></div>
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

<section>
	<div class="head"><h2>Sorting</h2></div>
	<p class="muted">Turn off the orders you never use and they stop appearing in the list.</p>

	{#if form?.sortError}
		<p class="msg bad" role="alert">{form.sortError}</p>
	{:else if form?.sortOk}
		<p class="msg good" role="status">{form.sortOk}</p>
	{/if}

	<form method="POST" action="?/saveSorts" class="sorts">
		{#each SORT_GROUPS as group (group.key)}
			<fieldset>
				<legend>{group.label}</legend>
				{#each SORTS.filter((one) => one.group === group.key) as option (option.value)}
					<label class="toggle">
						<input
							type="checkbox"
							name="sort"
							value={option.value}
							checked={!data.hiddenSorts.includes(option.value)}
						/>
						{option.label}
					</label>
				{/each}
			</fieldset>
		{/each}

		<button type="submit" class="btn btn-primary">Save sorting</button>
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
		gap: 14px;
		align-items: flex-start;
	}

	.head {
		width: 100%;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
	}

	h2 {
		font-size: 1.1rem;
	}

	.sorts {
		display: flex;
		flex-direction: column;
		gap: 18px;
		align-items: flex-start;
		width: 100%;
	}

	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	legend {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 0 0 6px;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.toggle input {
		width: auto;
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
