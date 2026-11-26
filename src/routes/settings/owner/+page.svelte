<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ServerUse from '$lib/ServerUse.svelte';
	import SourceHealth from './SourceHealth.svelte';
	type Report = { id: number; houseName: string; kind: string; title: string; body: string; created: number; reviewed?: boolean };
	let reports = $state<Report[]>([]);
	let reportsProblem = $state('');
	/** When the reports were last asked for, and whether they're being asked now ("Look again" showed nothing, 2026-11-18). */
	let reportsAt = $state(0);
	let reportsLooking = $state(false);
	let open = $state<number | null>(null);
	let openBody = $state('');
	async function forgetOwnerKey() {
		const response = await fetch('/api/online', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ action:'owner', key:'' }) });
		if (response.ok) await goto('/settings', { invalidateAll:true });
	}

	async function loadReports() {
		reportsLooking = true;
		const answer = await fetch('/api/online/reports')
			.then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
			.catch(() => null);
		reportsLooking = false;
		reportsProblem = answer?.ok ? '' : (answer?.data?.error ?? "The reports couldn't be read");
		reports = answer?.ok ? (answer.data.reports ?? []) : [];
		if (answer?.ok) reportsAt = Date.now();
	}

	async function openReport(report: Report) {
		if (open === report.id) {
			open = null;
			return;
		}
		open = report.id;
		openBody = 'Loading…';
		const full = await fetch(`/api/online/reports?id=${report.id}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		let text = full?.body ?? report.body;
		try {
			text = JSON.stringify(JSON.parse(text), null, 2);
		} catch {}
		openBody = text;
	}

	/** Marks reports as looked through (or not); the ones looked through go below, faded. */
	async function markReviewed(list: Report[], reviewed: boolean) {
		const ids = list.map((r) => r.id);
		reports = reports.map((r) => (ids.includes(r.id) ? { ...r, reviewed } : r));
		await fetch('/api/online/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, reviewed }) }).catch(() => null);
	}
	const shownReports = $derived([...reports.filter((r) => !r.reviewed), ...reports.filter((r) => r.reviewed)]);

	async function deleteReport(report: Report) {
		await fetch(`/api/online/reports?id=${report.id}`, { method: 'DELETE' }).catch(() => null);
		reports = reports.filter((r) => r.id !== report.id);
	}

	const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const kindName: Record<string, string> = { stop: 'Stopped to load', subtitles: "Subtitles didn't match", error: "Couldn't play or had an error" };
	onMount(() => { void loadReports(); });
</script>
<svelte:head><title>Owner · Catalog</title></svelte:head>
<h1>Owner</h1>
<SourceHealth />
		<ServerUse />
		<section>
			<h2>Problem reports</h2>
			{#if reportsProblem}<p class="msg bad">{reportsProblem}</p>{/if}
			{#if !reports.length && !reportsProblem}<p class="muted">None.</p>{/if}
			<p class="faint small">Stops of 4 seconds or more are sent. Shorter ones stay in that computer's stop log (Settings → Playback).</p>
			<ul class="reports">
				{#each shownReports as report (report.id)}
					<li class:reviewed={report.reviewed}>
						<button type="button" class="report" onclick={() => openReport(report)}>
							<strong>{report.title || 'A video'}</strong>
							<span class="faint">{kindName[report.kind] ?? report.kind} · {report.houseName || 'a computer'} · {when(report.created)}{report.reviewed ? ' · Reviewed' : ''}</span>
						</button>
						<button type="button" class="link" onclick={() => markReviewed([report], !report.reviewed)}>{report.reviewed ? 'Not reviewed' : 'Reviewed'}</button>
						<button type="button" class="link" onclick={() => deleteReport(report)}>Delete</button>
						{#if open === report.id}<pre>{openBody}</pre>{/if}
					</li>
				{/each}
			</ul>
			<div class="row">
				{#if reports.some((r) => !r.reviewed)}<button type="button" class="btn" onclick={() => markReviewed(reports.filter((r) => !r.reviewed), true)}>Mark all reviewed</button>{/if}
				<button type="button" class="btn" onclick={loadReports} disabled={reportsLooking}>{reportsLooking ? 'Looking…' : 'Look again'}</button>
				{#if reportsAt && !reportsLooking}<span class="faint small">Looked at {new Date(reportsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>{/if}
				<button type="button" class="btn" onclick={forgetOwnerKey}>Forget the owner's key</button>
			</div>
		</section>
<style>
	section { display:grid; gap:.65rem; margin-block:2rem; }
	.row { display:flex; flex-wrap:wrap; gap:.65rem; align-items:center; }
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.reports {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.reports li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.report {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.report span {
		font-size: 0.85rem;
	}

	.reports li.reviewed {
		opacity: 0.55;
	}

	pre {
		flex-basis: 100%;
		margin: 0;
		max-height: 24rem;
		overflow: auto;
		padding: 10px;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 0.78rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
