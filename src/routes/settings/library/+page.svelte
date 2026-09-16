<script lang="ts">
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
