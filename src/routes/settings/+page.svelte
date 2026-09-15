<script lang="ts">
	import { untrack } from 'svelte';
	import { ACCENT_PRESETS } from '$lib/accent';
	import { STATUSES, SORTS } from '$lib/constants';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/* ------------------------------------------------------------- colour */

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

	/* ------------------------------------------------------------- export */

	let exportCat = $state('');
	let exportStatus = $state('');
	let exportSort = $state('title');

	// Same parameter names the library uses, so an export is described the
	// same way a view of the library is.
	const exportQuery = $derived(
		new URLSearchParams(
			Object.entries({ cat: exportCat, status: exportStatus, sort: exportSort }).filter(
				([, value]) => value
			)
		).toString()
	);

	const fileHref = (format: string) => `/api/export?format=${format}&${exportQuery}`;

	/* ---------------------------------------------- updates: built from source */

	let updating = $state(false);
	let updateNote = $state('');

	async function rebuild() {
		if (!confirm('Catalog will close, rebuild, and reopen. Continue?')) return;

		updating = true;
		updateNote = 'Starting the updater…';

		try {
			const response = await fetch('/api/update', { method: 'POST' });
			if (!response.ok) {
				updating = false;
				updateNote = 'Could not start the updater.';
				return;
			}
			updateNote = 'Catalog is closing. It will reopen when the update finishes.';
		} catch {
			updating = false;
			updateNote = 'Could not start the updater.';
		}
	}

	/* ------------------------------------------------ updates: installed copy */

	type UpdateState = {
		status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
		version?: string;
		percent?: number;
		message?: string;
	};

	let release = $state<UpdateState>({ status: 'idle' });

	// Progress lives in the Electron process, so the page asks the server for
	// it rather than being told.
	async function readRelease() {
		try {
			const response = await fetch('/api/update');
			if (response.ok) release = (await response.json()).state;
		} catch {
			// Offline, or the app is closing. Leave the last state alone.
		}
	}

	const SETTLED = ['none', 'ready', 'error'];
	let polling = false;

	async function pollRelease() {
		if (polling) return;
		polling = true;

		try {
			const until = Date.now() + 120_000;
			while (Date.now() < until) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				await readRelease();
				if (SETTLED.includes(release.status)) break;
			}
		} finally {
			polling = false;
		}
	}

	$effect(() => {
		// A check also runs when the app opens, so there may already be an
		// answer waiting before anyone presses anything.
		if (untrack(() => data.updateMode) === 'release') readRelease();
	});

	async function checkNow() {
		release = { status: 'checking' };
		await fetch('/api/update?action=check', { method: 'POST' });
		pollRelease();
	}

	async function installNow() {
		if (!confirm('Catalog will close, update, and reopen. Continue?')) return;
		release = { status: 'downloading', percent: 100, version: release.version };
		await fetch('/api/update?action=install', { method: 'POST' });
	}

	const releaseNote = $derived.by(() => {
		switch (release.status) {
			case 'checking':
				return 'Checking…';
			case 'downloading':
				return `Downloading ${release.version ?? 'the update'} — ${release.percent ?? 0}%`;
			case 'ready':
				return `Version ${release.version} is ready to install.`;
			case 'none':
				return 'You have the latest version.';
			case 'error':
				return `Could not check: ${release.message}`;
			default:
				return '';
		}
	});

	/* --------------------------------------------------------------- jump */

	// The page is long enough that a row of jump links beats scrolling.
	const jumps = $derived(
		[
			{ id: 'colour', label: 'Colour' },
			{ id: 'export', label: 'Export' },
			{ id: 'search', label: 'Search' },
			{ id: 'pin', label: 'PIN' },
			data.updateMode === 'none' ? null : { id: 'updates', label: 'Updates' },
			{ id: 'files', label: 'Files' }
		].filter((jump) => jump !== null)
	);
</script>

<svelte:head><title>Settings · Catalog</title></svelte:head>

<header>
	<a href="/" class="back faint">&larr; Library</a>
	<h1>Settings</h1>

	<nav class="jumps">
		{#each jumps as jump (jump.id)}
			<a href="#{jump.id}">{jump.label}</a>
		{/each}
	</nav>
</header>

<div class="sections">
	<section id="colour" style="--accent: {accent}">
		<div class="head">
			<h2>Colour</h2>
		</div>

		<p class="muted">Used for buttons, links and highlights throughout the app.</p>

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

				<button type="submit" class="btn btn-primary" disabled={!isHex(typed)}>
					Save colour
				</button>
			</div>

			{#if typed && !isHex(typed)}
				<p class="faint hint">Needs six characters, like <code>#7a5af5</code>.</p>
			{/if}
		</form>

		<form method="POST" action="?/resetAccent">
			<button type="submit" class="btn btn-danger">Back to the original</button>
		</form>
	</section>

	<section id="export">
		<div class="head">
			<h2>Export</h2>
		</div>

		<p class="muted">Your library as a file — to print, to open in a spreadsheet, or to keep.</p>

		<div class="picks">
			<label class="field">
				<span>Include</span>
				<select bind:value={exportCat}>
					<option value="">Everything</option>
					{#each data.categories as category (category.id)}
						<option value={category.slug}>{category.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>Status</span>
				<select bind:value={exportStatus}>
					<option value="">Any</option>
					{#each STATUSES as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>Order</span>
				<select bind:value={exportSort}>
					{#each SORTS as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="export-actions">
			<a class="btn btn-primary" href="/export?{exportQuery}">Printable / PDF</a>
			<a class="btn" href={fileHref('csv')} download>Spreadsheet</a>
			<a class="btn" href={fileHref('txt')} download>Plain list</a>
		</div>

		<p class="faint hint">
			Printable opens a clean page; print it and choose <strong>Save as PDF</strong>.
		</p>

		<div class="saved-row">
			<span class="muted">Full backup — every entry, note, tag and rating in one file.</span>
			<a class="btn" href="/api/export?format=json" download>Download</a>
		</div>
	</section>

	<section id="search">
		<div class="head">
			<h2>Movie and TV search</h2>
			{#if data.tmdbKeySaved}
				<span class="pill completed">On</span>
			{:else}
				<span class="pill planned">Off</span>
			{/if}
		</div>

		<p class="muted">
			Anime works without setup. Movies and TV need a free key from
			<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer"
				>themoviedb.org</a
			>. Either the API Key or the Read Access Token works.
		</p>

		{#if form?.keyError}
			<p class="msg bad" role="alert">{form.keyError}</p>
		{:else if form?.keyOk}
			<p class="msg good" role="status">{form.keyOk}</p>
		{/if}

		{#if data.tmdbKeySaved}
			<div class="saved-row">
				<span class="muted">A key is saved and working.</span>
				<form method="POST" action="?/removeKey">
					<button type="submit" class="btn btn-danger">Remove</button>
				</form>
			</div>
			<details>
				<summary>Replace it</summary>
				<form method="POST" action="?/saveKey" class="inline-form">
					<input type="password" id="tmdbApiKey" name="tmdbApiKey" placeholder="Paste a new key" autocomplete="off" />
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
		{:else}
			<form method="POST" action="?/saveKey" class="inline-form">
				<input
					type="password"
					id="tmdbApiKey"
					name="tmdbApiKey"
					placeholder="Paste your TMDB key here"
					autocomplete="off"
				/>
				<button type="submit" class="btn btn-primary">Save</button>
			</form>
			<p class="faint hint">Checked against TMDB before saving.</p>
		{/if}
	</section>

	<section id="pin">
		<div class="head">
			<h2>PIN lock</h2>
			{#if data.pinSet}
				<span class="pill completed">On</span>
			{:else}
				<span class="pill">Off</span>
			{/if}
		</div>

		<p class="muted">
			Your library is reachable from other devices on your network. A PIN means being on
			the network isn't enough to open it.
		</p>

		{#if form?.pinError}
			<p class="msg bad" role="alert">{form.pinError}</p>
		{:else if form?.pinOk}
			<p class="msg good" role="status">{form.pinOk}</p>
		{/if}

		{#if data.pinSet}
			<div class="saved-row">
				<span class="muted">A PIN is set.</span>
				<form method="POST" action="?/removePin">
					<button type="submit" class="btn btn-danger">Remove PIN</button>
				</form>
			</div>
			<details>
				<summary>Change it</summary>
				<form method="POST" action="?/savePin" class="inline-form">
					<input type="password" id="pin" name="pin" placeholder="New PIN" autocomplete="off" />
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			</details>
		{:else}
			<form method="POST" action="?/savePin" class="inline-form">
				<input
					type="password"
					id="pin"
					name="pin"
					placeholder="Choose a PIN (4+ characters)"
					autocomplete="off"
				/>
				<button type="submit" class="btn">Set PIN</button>
			</form>
		{/if}
	</section>

	{#if data.updateMode === 'source'}
		<section id="updates">
			<div class="head">
				<h2>Updates</h2>
			</div>

			<p class="muted">
				Applies code changes Claude has made. Catalog closes, rebuilds, and reopens on its
				own — your library isn't touched.
			</p>

			{#if updateNote}
				<p class="msg good" role="status">{updateNote}</p>
			{/if}

			<div>
				<button type="button" class="btn" disabled={updating} onclick={rebuild}>
					{updating ? 'Updating…' : 'Update Catalog'}
				</button>
			</div>

			<p class="faint hint">Takes about a minute. A window will appear showing progress.</p>
		</section>
	{:else if data.updateMode === 'release'}
		<section id="updates">
			<div class="head">
				<h2>Updates</h2>
				<!-- .pill uppercases, which would turn a "v" prefix into "V1.0.0". -->
				{#if data.appVersion}<span class="pill tabular">{data.appVersion}</span>{/if}
			</div>

			<p class="muted">
				Catalog looks for a new version each time it opens and downloads it in the
				background. Your library is never touched by an update.
			</p>

			{#if releaseNote}
				<p class="msg {release.status === 'error' ? 'bad' : 'good'}" role="status">
					{releaseNote}
				</p>
			{/if}

			<div>
				{#if release.status === 'ready'}
					<button type="button" class="btn btn-primary" onclick={installNow}>
						Restart and install
					</button>
				{:else}
					<button
						type="button"
						class="btn"
						disabled={release.status === 'checking' || release.status === 'downloading'}
						onclick={checkNow}
					>
						Check for updates
					</button>
				{/if}
			</div>
		</section>
	{/if}

	<section id="files">
		<div class="head">
			<h2>Your files</h2>
		</div>
		<p class="muted">Backups go in a <code>backups</code> subfolder.</p>
		<dl class="paths">
			<dt>Library</dt>
			<dd><code>{data.dbPath}</code></dd>
			<dt>Folder</dt>
			<dd><code>{data.dataDir}</code></dd>
		</dl>
	</section>
</div>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 26px;
	}

	.back {
		font-size: 0.85rem;
		width: fit-content;
	}
	.back:hover {
		color: var(--accent);
	}

	h1 {
		font-size: clamp(1.6rem, 4vw, 2.1rem);
	}

	h2 {
		font-size: 1.15rem;
	}

	.jumps {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}

	.jumps a {
		font-size: 0.78rem;
		color: var(--ink-soft);
		border: 1px solid var(--rule);
		border-radius: 100px;
		padding: 3px 11px;
		background: var(--surface);
	}

	.jumps a:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 40px;
		max-width: 62ch;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		/* So a jump link doesn't leave the heading touching the window edge. */
		scroll-margin-top: 16px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
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

	/* ------------------------------------------------------------ export */

	.picks {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
	}

	.export-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	/* ------------------------------------------------------------ colour */

	.accent-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
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

	.hint code {
		font-family: var(--mono);
		font-size: 0.85em;
	}

	/* ------------------------------------------------------------- files */

	.paths {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 16px;
		align-items: baseline;
	}

	.paths dt {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.paths dd {
		margin: 0;
		min-width: 0;
	}

	.paths code {
		font-family: var(--mono);
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	@media (max-width: 520px) {
		.paths {
			grid-template-columns: 1fr;
			gap: 2px;
		}
		.paths dd {
			margin-bottom: 8px;
		}
	}
</style>
