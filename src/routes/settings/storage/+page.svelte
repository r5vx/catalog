<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const r = $derived(data.report);
	/** What counts towards the limit: everything that can be had again. */
	const kept = $derived(r.previews + r.subtitles + r.lookups + r.appCache);

	/** Each kind's own share of the limit. */
	const shareOf = (kind: keyof typeof data.shares) => r.limitMb * 1024 * 1024 * data.shares[kind];

	function size(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
		// A thousand megabytes is a gigabyte here, as in the sizes to pick from.
		const mb = bytes / 1024 / 1024;
		if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
		return `${Number((mb / 1000).toFixed(1))} GB`;
	}
</script>

<svelte:head><title>Storage · Catalog</title></svelte:head>

<div class="sections">
	<section>
		<div class="head"><h2>Kept to load faster</h2></div>
		<p class="muted">
			Copies Catalog keeps on this computer so things open without asking the internet again. Anything here can
			be fetched again, so clearing it loses nothing.
		</p>

		<ul class="sizes">
			<li><span>Pictures and video</span><span class="faint">posters, and pieces of what you've watched</span><b class="tabular">{size(r.appCache)} <span class="of faint">of {size(shareOf('appCache'))}</span></b></li>
			<li><span>Preview pictures</span><span class="faint">shown on the progress bar</span><b class="tabular">{size(r.previews)} <span class="of faint">of {size(shareOf('previews'))}</span></b></li>
			<li><span>Subtitles</span><span class="faint">for shows you're watching</span><b class="tabular">{size(r.subtitles)} <span class="of faint">of {size(shareOf('subtitles'))}</span></b></li>
			<li><span>Looked up</span><span class="faint">details, scores, which file is which episode</span><b class="tabular">{size(r.lookups)} <span class="of faint">of {size(shareOf('lookups'))}</span></b></li>
			<li class="total"><span>Altogether</span><span></span><b class="tabular">{size(kept)} <span class="of faint">of {r.limitMb >= 1000 ? `${r.limitMb / 1000} GB` : `${r.limitMb} MB`}</span></b></li>
		</ul>

		<form method="POST" action="?/limit" use:enhance class="limit">
			<label class="field">
				<span>Keep at most</span>
				<select name="mb" value={String(r.limitMb)} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					{#each data.limits as limit (limit.mb)}
						<option value={String(limit.mb)}>{limit.label}</option>
					{/each}
				</select>
			</label>
			<p class="faint hint">Each kind has its own share, so none can crowd out the rest; past it, the oldest goes first. Pictures and video change to the new size the next time Catalog opens.</p>
		</form>

		<form method="POST" action="?/clear" use:enhance>
			<button type="submit" class="btn">Clear it all now</button>
			{#if form && 'cleared' in form}<span class="faint done">Cleared.</span>{/if}
		</form>
	</section>

	<section>
		<div class="head"><h2>Episodes downloaded ahead</h2></div>
		<ul class="sizes">
			<li><span>7Movies and Movy</span><span class="faint">the episodes playing on every screen and the next ones, deleted 6 hours after</span><b class="tabular">{size(r.downloadsAhead)} <span class="of faint">of {data.downloadLimitGb} GB</span></b></li>
		</ul>
		<form method="POST" action="?/downloads" use:enhance class="limit">
			<label class="field">
				<span>Keep at most</span>
				<select name="gb" value={String(data.downloadLimitGb)} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					{#each data.downloadLimits as gb (gb)}
						<option value={String(gb)}>{gb} GB</option>
					{/each}
				</select>
			</label>
			<p class="faint hint">Separate from the limit above. An episode takes about 0.5 to 2 GB; with several TVs watching, each has its own. It never leaves less than 5 GB free on the disk.</p>
		</form>
	</section>

	<section>
		<div class="head"><h2>Never cleared</h2></div>
		<ul class="sizes">
			<li><span>Your library</span><span class="faint">titles, ratings, notes, where you're up to</span><b class="tabular">{size(r.library)}</b></li>
			<li><span>Backups</span><span class="faint">copies of your library</span><b class="tabular">{size(r.backups)}</b></li>
		</ul>
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

	.sizes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.sizes li {
		display: grid;
		grid-template-columns: 150px 1fr auto;
		gap: 12px;
		align-items: baseline;
		padding: 8px 0;
		border-bottom: 1px solid var(--rule);
		font-size: 0.92rem;
	}

	.sizes .faint {
		font-size: 0.82rem;
	}

	.of {
		font-weight: 400;
		font-size: 0.8rem;
	}

	.sizes .total {
		border-bottom: none;
		font-weight: 600;
	}

	.limit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 260px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.85rem;
	}

	.hint {
		font-size: 0.82rem;
		margin: 0;
	}

	.done {
		margin-left: 10px;
		font-size: 0.85rem;
	}

	@media (max-width: 520px) {
		.sizes li {
			grid-template-columns: 1fr auto;
		}

		.sizes .faint {
			display: none;
		}
	}
</style>
