<script lang="ts">
	import { untrack } from 'svelte';
	import { STATUSES, SORTS } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	/* ------------------------------------------------------- filling it in */

	type Backfill = {
		status: 'idle' | 'working' | 'done' | 'failed';
		done: number;
		total: number;
		label: string;
		message?: string;
	};

	let fill = $state<Backfill>({ status: 'idle', done: 0, total: 0, label: '' });
	// Seeded once; from then on the count comes from the job's own polling.
	let missing = $state(untrack(() => data.missing));

	const filling = $derived(fill.status === 'working');

	const percent = $derived(fill.total > 0 ? Math.round((fill.done / fill.total) * 100) : 0);

	async function read() {
		try {
			const response = await fetch('/api/backfill');
			if (!response.ok) return;

			const payload = await response.json();
			fill = payload.state;
			missing = payload.missing;
		} catch {
			// Offline. What's on screen stays.
		}
	}

	let polling = false;

	async function poll() {
		if (polling) return;
		polling = true;

		try {
			while (true) {
				await new Promise((resolve) => setTimeout(resolve, 900));
				await read();
				if (fill.status !== 'working') break;
			}
		} finally {
			polling = false;
		}
	}

	async function startFilling() {
		fill = { status: 'working', done: 0, total: missing, label: 'Starting…' };
		await fetch('/api/backfill', { method: 'POST' });
		poll();
	}

	/* ------------------------------------------------------------- sharing */

	let shareRatings = $state(true);
	let shareNotes = $state(false);
	let shareName = $state('');

	const shareHref = $derived(
		'/api/export?' +
			new URLSearchParams({
				format: 'share',
				ratings: shareRatings ? '1' : '0',
				notes: shareNotes ? '1' : '0',
				...(shareName.trim() ? { from: shareName.trim() } : {})
			}).toString()
	);
</script>

<svelte:head><title>Library · Catalog</title></svelte:head>

<div class="sections">
	<section>
		<div class="head"><h2>Export</h2></div>

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
			{#if data.canMakePdf}
				<a class="btn btn-primary" href={fileHref('pdf')} download>PDF</a>
			{/if}
			<a class="btn" href="/export?{exportQuery}">Printable page</a>
			<a class="btn" href={fileHref('csv')} download>Spreadsheet</a>
			<a class="btn" href={fileHref('txt')} download>Plain list</a>
		</div>

		<div class="saved-row">
			<span class="muted">Full backup</span>
			<a class="btn" href="/api/export?format=json" download>Download</a>
		</div>
	</section>

	<section>
		<div class="head"><h2>Missing information</h2></div>

		<p class="muted">
			Runtimes, box office and IMDb scores need a second lookup, which happens on its own
			shortly after Catalog opens.
		</p>

		{#if filling}
			<div class="progress" role="status" aria-live="polite">
				<div class="bar"><div class="fill" style="width: {Math.max(3, percent)}%"></div></div>
				<p class="step">
					<span>{fill.label}</span>
					<span class="faint tabular">{fill.done} of {fill.total}</span>
				</p>
			</div>
		{:else if fill.status === 'done'}
			<p class="msg good" role="status">{fill.message}</p>
		{:else if missing === 0}
			<p class="msg good" role="status">Everything is filled in.</p>
		{:else}
			<div class="saved-row">
				<span class="muted tabular">
					{missing}
					{missing === 1 ? 'title' : 'titles'} still to go.
				</span>
				<button type="button" class="btn" onclick={startFilling}>Do it now</button>
			</div>
		{/if}
	</section>

	<section>
		<div class="head"><h2>Share with someone</h2></div>

		<p class="muted">
			A copy of your list they can open in their own Catalog. No note pages, and nothing of
			yours unless you tick it.
		</p>

		<label class="field">
			<span>Your name, if you want it on there</span>
			<input type="text" bind:value={shareName} placeholder="Optional" maxlength="40" />
		</label>

		<label class="toggle">
			<input type="checkbox" bind:checked={shareRatings} />
			Include my ratings
		</label>

		<label class="toggle">
			<input type="checkbox" bind:checked={shareNotes} />
			Include my reviews
		</label>

		<div class="export-actions">
			<a class="btn btn-primary" href={shareHref} download>Make a share file</a>
			<a class="btn" href="/shared">Open someone else's</a>
		</div>
	</section>

	<section>
		<div class="head"><h2>Your files</h2></div>
		<dl class="paths">
			<dt>Library</dt>
			<dd><code>{data.dbPath}</code></dd>
			<dt>Folder</dt>
			<dd><code>{data.dataDir}</code></dd>
		</dl>
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

	/* ---------------------------------------------------------- progress */

	.progress {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bar {
		width: 100%;
		height: 8px;
		background: var(--sunk);
		border-radius: 100px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 100px;
		transition: width 0.4s ease;
	}

	.step {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
	}

	.good {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
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
