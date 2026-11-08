<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { ACCENT_PRESETS } from '$lib/accent';
	import { CUSTOM_COLOURS, THEME_COLOURS, applyCustomTheme, type CustomTheme } from '$lib/customTheme';
	import { DEFAULT_DIM, MAX_DIM, MAX_BLUR } from '$lib/background';
	import { backgroundPreview } from '$lib/backgroundPreview.svelte';
	import { codeBox } from '$lib/codeBox.svelte';
	import { SORTS, SORT_GROUPS } from '$lib/constants';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Live preview: the page recolours as you pick, before you save.
	let accent = $state(untrack(() => data.accent));
	/** What's in the text box, which can be half-typed while you paste. */
	let typed = $state(untrack(() => data.accent));

	let theme = $state(untrack(() => data.theme));
	let wideLayout = $state(untrack(() => data.wideLayout));
	let sideNav = $state(untrack(() => data.sideNav));
	let ratingStars = $state(untrack(() => data.ratingStars));
	const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';

	async function chooseRatingStars(count: 5 | 10) {
		ratingStars = count;
		const body = new FormData();
		body.set('ratingStars', String(count));
		await fetch('?/saveRatingStars', { method: 'POST', body });
		await invalidateAll();
	}

	async function chooseSideNav(on: boolean) {
		sideNav = on;
		const body = new FormData();
		body.set('sideNav', on ? '1' : '0');
		await fetch('?/saveSideNav', { method: 'POST', body });
		await invalidateAll();
	}
	const altMode = $derived((data as any).altMode as boolean);
	let codeText = $state('');
	let codeError = $state('');

	async function applyCode(off = false) {
		codeError = '';
		const body = new FormData();
		if (off) body.set('off', '1');
		else body.set('code', codeText);
		const resp = await fetch('?/saveCode', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const answer = await resp.json().catch(() => null);
		if (answer?.type === 'success') window.location.reload();
		else codeError = 'That code does nothing.';
	}

	const THEMES = [
		{ value: '', label: 'System', desc: 'Follows your device', bg: '' },
		{ value: 'light', label: 'Light', desc: 'Bright background', bg: '#f1f3f1' },
		{ value: 'dark', label: 'Dark', desc: 'Easy on the eyes', bg: '#111614' },
		{ value: 'black', label: 'Black', desc: 'OLED-friendly', bg: '#000000' },
		{ value: 'custom', label: 'Custom', desc: 'Your own colors', bg: '' }
	];

	async function pickTheme(value: string) {
		if (value === 'custom') return pickCustom();
		theme = value;
		if (value) document.documentElement.dataset.theme = value;
		else delete document.documentElement.dataset.theme;
		applyCustomTheme(null);
		const body = new FormData();
		body.set('theme', value);
		await fetch('?/saveTheme', { method: 'POST', body });
		await invalidateAll();
	}

	/* ----------------------------------------------------------- custom theme */

	// Every colour of the Custom theme, as exact hex codes; `customTyped` is what's in each text
	// box, which can be half-typed while you paste.
	let custom = $state<CustomTheme>(untrack(() => ({ ...data.customTheme })));
	let customTyped = $state<CustomTheme>(untrack(() => ({ ...data.customTheme })));
	let customSaved = untrack(() => data.customSaved);
	let copied = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	/** The look in use right now, as a starting point the first time Custom is picked. */
	function currentLook(): CustomTheme {
		if (theme === 'light' || theme === 'dark' || theme === 'black') return { ...THEME_COLOURS[theme] };
		return { ...THEME_COLOURS[matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'] };
	}

	function pickCustom() {
		if (!customSaved) setCustom(currentLook());
		theme = 'custom';
		document.documentElement.dataset.theme = 'custom';
		applyCustomTheme($state.snapshot(custom));
		saveCustomSoon(0);
	}

	/** All colours at once (a starting point). */
	function setCustom(colours: CustomTheme) {
		custom = { ...colours };
		customTyped = { ...colours };
	}

	/** One colour changed: shown at once, saved a moment after the last change. */
	function setColour(key: string, value: string) {
		custom[key] = value.toLowerCase();
		customTyped[key] = value.toLowerCase();
		applyCustomTheme($state.snapshot(custom));
		saveCustomSoon();
	}

	function onCustomHex(key: string, event: Event) {
		const raw = (event.target as HTMLInputElement).value.trim();
		const typedNow = raw.startsWith('#') || raw === '' ? raw : `#${raw}`;
		customTyped[key] = typedNow;
		if (isHex(typedNow)) {
			custom[key] = typedNow.toLowerCase();
			applyCustomTheme($state.snapshot(custom));
			saveCustomSoon();
		}
	}

	function startFrom(base: 'light' | 'dark' | 'black') {
		setCustom(THEME_COLOURS[base]);
		applyCustomTheme($state.snapshot(custom));
		saveCustomSoon(0);
	}

	function saveCustomSoon(wait = 400) {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			const body = new FormData();
			for (const { key } of CUSTOM_COLOURS) body.set(key, custom[key]);
			await fetch('?/saveCustomTheme', { method: 'POST', body });
			customSaved = true;
			await invalidateAll();
		}, wait);
	}

	/** Every code at once, one per line ("Background #111614"), to keep or to share. */
	async function copyCodes() {
		const lines = CUSTOM_COLOURS.map(({ key, label }) => `${label} ${custom[key]}`);
		lines.push(`Accent ${accent}`);
		await navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	/* ------------------------------------------------------- background picture */

	let dim = $state(untrack(() => data.background?.dim ?? DEFAULT_DIM));
	let blur = $state(untrack(() => data.background?.blur ?? 0));
	let uploading = $state(false);
	let backgroundError = $state('');

	async function saveBackground(fields: Record<string, string>) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		await fetch('?/saveBackground', { method: 'POST', body });
		await invalidateAll();
		backgroundPreview.dim = null;
		backgroundPreview.blur = null;
	}

	/** Stored like a note's pictures (on this computer), then put behind the pages. */
	async function choosePicture(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		backgroundError = '';
		// Checked here, so the message is about the picture's real size.
		if (file.size > 20 * 1024 * 1024) {
			backgroundError = 'That picture is larger than 20 MB.';
			return;
		}
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const resp = await fetch('/api/media', { method: 'POST', body });
			if (!resp.ok) {
				backgroundError = 'That picture could not be used.';
				return;
			}
			const { url } = await resp.json();
			await saveBackground({ image: url, dim: String(dim), blur: String(blur) });
		} catch {
			backgroundError = 'That picture could not be used.';
		} finally {
			uploading = false;
		}
	}

	async function removeBackground() {
		await fetch('?/removeBackground', { method: 'POST', body: new FormData() });
		dim = DEFAULT_DIM;
		blur = 0;
		await invalidateAll();
	}

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
<section>
	<div class="head"><h2>Theme</h2></div>
	<p class="muted">Pick the background style.</p>

	<div class="theme-options">
		{#each THEMES as t (t.value)}
			<button
				type="button"
				class="theme-card"
				class:picked={theme === t.value}
				onclick={() => pickTheme(t.value)}
			>
				{#if t.value === 'custom'}
					<!-- The Custom theme's own background, cards, text and accent. -->
					<span class="theme-swatch custom-swatch" style:background={custom.paper}>
						<span style:background={custom.surface}></span>
						<span style:background={custom.ink}></span>
						<span style:background={accent}></span>
					</span>
				{:else}
					<span
						class="theme-swatch"
						class:system={!t.bg}
						style={t.bg ? `background: ${t.bg}` : ''}
					></span>
				{/if}
				<span class="theme-label">{t.label}</span>
				<span class="theme-desc faint">{t.desc}</span>
			</button>
		{/each}
	</div>

	{#if theme === 'custom'}
		<div class="custom">
			<div class="custom-colours">
				{#each CUSTOM_COLOURS as colour (colour.key)}
					<div class="custom-row">
						<input
							type="color"
							aria-label="Pick the {colour.label} color"
							value={custom[colour.key]}
							oninput={(e) => setColour(colour.key, e.currentTarget.value)}
						/>
						<span class="custom-name">
							<span class="custom-label">{colour.label}</span>
							<span class="faint custom-hint">{colour.hint}</span>
						</span>
						<input
							type="text"
							class="hex"
							class:wrong={!isHex(customTyped[colour.key] ?? '')}
							value={customTyped[colour.key]}
							oninput={(e) => onCustomHex(colour.key, e)}
							spellcheck="false"
							autocomplete="off"
							maxlength="7"
							aria-label="{colour.label} hex code"
						/>
					</div>
				{/each}
			</div>
			<p class="faint hint">Buttons and links use the accent below.</p>
			<div class="custom-actions">
				<span class="faint">Start from</span>
				<button type="button" class="btn" onclick={() => startFrom('light')}>Light</button>
				<button type="button" class="btn" onclick={() => startFrom('dark')}>Dark</button>
				<button type="button" class="btn" onclick={() => startFrom('black')}>Black</button>
				<button type="button" class="btn copy" onclick={copyCodes}>{copied ? 'Copied' : 'Copy codes'}</button>
			</div>
		</div>
	{/if}
</section>

<section>
	<div class="head"><h2>Background</h2></div>
	<p class="muted">A picture behind every page except the player.</p>

	{#if backgroundError}<p class="msg bad" role="alert">{backgroundError}</p>{/if}

	<div class="background-row">
		{#if data.background}
			<span class="background-thumb" style:background-image="url('{data.background.image}')">
				<span class="background-thumb-dim" style:opacity={dim / 100}></span>
			</span>
		{/if}
		<div class="background-actions">
			<label class="btn" class:disabled={uploading}>
				{uploading ? 'Uploading…' : data.background ? 'Change picture' : 'Choose picture'}
				<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.avif" onchange={choosePicture} disabled={uploading} hidden />
			</label>
			{#if data.background}
				<button type="button" class="btn btn-danger" onclick={removeBackground}>Remove</button>
			{/if}
		</div>
	</div>

	{#if data.background}
		<div class="sliders">
			<label class="slider">
				<span class="label">Dim</span>
				<input
					type="range"
					min="0"
					max={MAX_DIM}
					bind:value={dim}
					oninput={() => (backgroundPreview.dim = dim)}
					onchange={() => saveBackground({ dim: String(dim) })}
				/>
				<span class="faint tabular">{dim}%</span>
			</label>
			<label class="slider">
				<span class="label">Blur</span>
				<input
					type="range"
					min="0"
					max={MAX_BLUR}
					bind:value={blur}
					oninput={() => (backgroundPreview.blur = blur)}
					onchange={() => saveBackground({ blur: String(blur) })}
				/>
				<span class="faint tabular">{blur}</span>
			</label>
		</div>
	{/if}
</section>

<section>
	<div class="head"><h2>Layout</h2></div>
	<p class="muted">How content fills the screen when the window is wide.</p>

	<div class="layout-options">
		<button
			type="button"
			class="layout-card"
			class:picked={!wideLayout}
			onclick={async () => { wideLayout = false; const b = new FormData(); b.set('wideLayout', '0'); await fetch('?/saveLayout', { method: 'POST', body: b }); window.location.reload(); }}
		>
			<span class="layout-preview centered-preview">
				<span class="layout-bar"></span>
				<span class="layout-grid">
					<span></span><span></span><span></span>
				</span>
			</span>
			<span class="layout-label">Centered</span>
			<span class="layout-desc faint">Content stays in the middle</span>
		</button>
		<button
			type="button"
			class="layout-card"
			class:picked={wideLayout}
			onclick={async () => { wideLayout = true; const b = new FormData(); b.set('wideLayout', '1'); await fetch('?/saveLayout', { method: 'POST', body: b }); window.location.reload(); }}
		>
			<span class="layout-preview wide-preview">
				<span class="layout-bar"></span>
				<span class="layout-grid">
					<span></span><span></span><span></span><span></span><span></span>
				</span>
			</span>
			<span class="layout-label">Wide</span>
			<span class="layout-desc faint">Uses the full window width</span>
		</button>
	</div>

	<p class="muted side-intro">A sidebar with every part of the library, Browse and Settings, on every page.</p>
	<div class="layout-options">
		<button type="button" class="layout-card" class:picked={!sideNav} onclick={() => chooseSideNav(false)}>
			<span class="layout-preview centered-preview">
				<span class="layout-bar"></span>
				<span class="layout-grid">
					<span></span><span></span><span></span>
				</span>
			</span>
			<span class="layout-label">No sidebar</span>
			<span class="layout-desc faint">Tabs at the top of the library</span>
		</button>
		<button type="button" class="layout-card" class:picked={sideNav} onclick={() => chooseSideNav(true)}>
			<span class="layout-preview side-preview">
				<span class="side-strip"></span>
				<span class="side-page">
					<span class="layout-bar"></span>
					<span class="layout-grid">
						<span></span><span></span><span></span>
					</span>
				</span>
			</span>
			<span class="layout-label">Sidebar</span>
			<span class="layout-desc faint">Always one click from the library</span>
		</button>
	</div>
</section>

<section>
	<div class="head"><h2>Ratings</h2></div>
	<p class="muted">Your ratings are out of 10 either way.</p>

	<div class="layout-options">
		<button type="button" class="layout-card" class:picked={ratingStars === 5} onclick={() => chooseRatingStars(5)}>
			<span class="star-preview" aria-hidden="true">
				{#each [1, 2, 3, 4, 5] as n (n)}<svg viewBox="0 0 24 24" class:half={n === 5}><path d={STAR} /></svg>{/each}
			</span>
			<span class="layout-label">5 stars</span>
			<span class="layout-desc faint">4½ stars is 9</span>
		</button>
		<button type="button" class="layout-card" class:picked={ratingStars === 10} onclick={() => chooseRatingStars(10)}>
			<span class="star-preview ten" aria-hidden="true">
				{#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as n (n)}<svg viewBox="0 0 24 24" class:half={n === 9} class:off={n === 10}><path d={STAR} /></svg>{/each}
			</span>
			<span class="layout-label">10 stars</span>
			<span class="layout-desc faint">8½ stars is 8.5</span>
		</button>
	</div>
</section>

<section style="--accent: {accent}">
	<div class="head"><h2>Color</h2></div>
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
				aria-label="Pick a color"
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
				placeholder="#e994c2"
				aria-label="Color hex code"
			/>

			<button type="submit" class="btn btn-primary" disabled={!isHex(typed)}>Save color</button>
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

	<div class="sorts">
		{#each SORT_GROUPS as group (group.key)}
			<fieldset>
				<legend>{group.label}</legend>
				{#each SORTS.filter((one) => one.group === group.key) as option (option.value)}
					<label class="toggle">
						<input
							type="checkbox"
							value={option.value}
							checked={!data.hiddenSorts.includes(option.value)}
							onchange={async (e) => {
								const checked = e.currentTarget.checked;
								if (checked) {
									data.hiddenSorts = data.hiddenSorts.filter((v: string) => v !== option.value);
								} else {
									data.hiddenSorts = [...data.hiddenSorts, option.value];
								}
								const body = new FormData();
								for (const s of SORTS) {
									if (!data.hiddenSorts.includes(s.value)) body.append('sort', s.value);
								}
								await fetch('?/saveSorts', { method: 'POST', body });
							}}
						/>
						{option.label}
					</label>
				{/each}
			</fieldset>
		{/each}
	</div>
</section>
<!-- Hidden until Personalization is pressed 7 times in a row (src/lib/codeBox.svelte.ts). -->
{#if altMode || codeBox.shown}
<section>
	<div class="head"><h2>Code</h2></div>
	{#if altMode}
		<div class="code-row">
			<span class="muted">On</span>
			<button type="button" class="btn" onclick={() => applyCode(true)}>Turn off</button>
		</div>
	{:else}
		<form
			class="code-row"
			onsubmit={(e) => {
				e.preventDefault();
				applyCode();
			}}
		>
			<input type="text" inputmode="numeric" autocomplete="off" placeholder="Enter a code" aria-label="Code" bind:value={codeText} />
			<button type="submit" class="btn" disabled={!codeText.trim()}>Apply</button>
		</form>
		{#if codeError}<p class="msg bad" role="alert">{codeError}</p>{/if}
	{/if}
</section>
{/if}
</div>

<style>
	.code-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.code-row input {
		width: 160px;
	}

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

	.theme-options {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 14px;
	}

	.theme-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 12px 16px;
		border: 2px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
		min-width: 90px;
	}

	.theme-card.picked {
		border-color: var(--accent);
	}

	.theme-card:hover {
		border-color: var(--ink-faint);
	}

	.theme-swatch {
		width: 44px;
		height: 30px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-firm);
	}

	.theme-swatch.system {
		background: linear-gradient(135deg, #f1f3f1 50%, #111614 50%);
	}

	/* The Custom card's swatch: its background, with cards, text and accent stripes on it. */
	.custom-swatch {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		padding: 5px;
	}

	.custom-swatch span {
		flex: 1;
		height: 60%;
		border-radius: 2px;
	}

	.custom-swatch span:nth-child(2) {
		height: 30%;
	}

	/* The Custom theme's colours: a picker, the name, and the exact hex code for each. */
	.custom {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		padding: 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.custom-colours {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr));
		gap: 10px 22px;
	}

	.custom-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.custom-row input[type='color'] {
		flex: none;
		width: 40px;
		height: 32px;
		padding: 2px;
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		background: var(--surface);
		cursor: pointer;
	}

	.custom-name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}

	.custom-label {
		font-size: 0.88rem;
		font-weight: 600;
	}

	.custom-hint {
		font-size: 0.74rem;
	}

	.custom-row .hex {
		width: 6.6em;
	}

	.hex.wrong {
		border-color: var(--accent);
	}

	.custom-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 0.85rem;
	}

	.custom-actions .copy {
		margin-left: auto;
	}

	.theme-label {
		font-size: 0.88rem;
		font-weight: 600;
	}

	.theme-desc {
		font-size: 0.72rem;
	}

	.background-row {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}

	.background-thumb {
		position: relative;
		width: 160px;
		height: 90px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-firm);
		background-size: cover;
		background-position: center;
		overflow: hidden;
	}

	.background-thumb-dim {
		position: absolute;
		inset: 0;
		background: var(--paper);
	}

	.background-actions {
		display: flex;
		gap: 8px;
	}

	.background-actions .disabled {
		opacity: 0.6;
		pointer-events: none;
	}

	.sliders {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: min(100%, 420px);
	}

	.slider {
		display: grid;
		grid-template-columns: 48px 1fr 44px;
		align-items: center;
		gap: 12px;
	}

	.slider input {
		width: 100%;
		accent-color: var(--accent);
	}

	.layout-options {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 14px;
	}

	.layout-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 12px 16px;
		border: 2px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
		min-width: 120px;
	}

	/* The Ratings choice's little stars (the star colour is --star in src/app.css). */
	.star-preview {
		display: flex;
		gap: 2px;
		height: 60px;
		align-items: center;
	}

	.star-preview svg {
		width: 18px;
		height: 18px;
		fill: var(--star);
		stroke: var(--star);
		stroke-width: 1.4;
		stroke-linejoin: round;
	}

	.star-preview.ten svg {
		width: 12px;
		height: 12px;
	}

	.star-preview svg.half {
		fill: color-mix(in srgb, var(--star) 45%, transparent);
	}

	.star-preview svg.off {
		fill: none;
		stroke: var(--ink-faint);
	}

	.layout-card.picked {
		border-color: var(--accent);
	}

	.layout-card:hover {
		border-color: var(--ink-faint);
	}

	.layout-preview {
		width: 100px;
		height: 60px;
		background: var(--sunk);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		overflow: hidden;
	}

	.centered-preview {
		align-items: center;
	}

	.wide-preview {
		align-items: stretch;
	}

	.side-intro {
		margin-top: 18px;
	}

	.side-preview {
		flex-direction: row;
	}

	.side-strip {
		width: 18px;
		border-radius: 2px;
		background: var(--accent);
		opacity: 0.5;
	}

	.side-page {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.side-page .layout-bar {
		width: 50%;
	}

	.layout-bar {
		height: 6px;
		border-radius: 2px;
		background: var(--rule-firm);
	}

	.centered-preview .layout-bar {
		width: 50%;
	}

	.wide-preview .layout-bar {
		width: 30%;
	}

	.layout-grid {
		display: flex;
		gap: 3px;
		flex: 1;
	}

	.centered-preview .layout-grid {
		width: 70%;
	}

	.layout-grid span {
		flex: 1;
		background: var(--rule);
		border-radius: 2px;
	}

	.layout-label {
		font-size: 0.88rem;
		font-weight: 600;
	}

	.layout-desc {
		font-size: 0.72rem;
	}
</style>
