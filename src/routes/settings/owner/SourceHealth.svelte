<script lang="ts">
	type Result = { id: string; name: string; status: string; code: number; ms: number };
	let results = $state<Result[]>([]);
	let at = $state(0);
	let busy = $state(false);
	let problem = $state('');
	async function check() {
		busy = true;
		problem = '';
		try {
			const response = await fetch('/api/online/source-health', { method: 'POST' });
			if (!response.ok) throw Error();
			const data = await response.json();
			results = data.results;
			at = data.at;
		} catch { problem = 'Could not check sources. Make sure this profile still has owner access.'; }
		finally { busy = false; }
	}
</script>
<section>
	<h2>Source health</h2>
	<p>Check whether source sites and installed add-on hosts respond from this computer. This does not test account access or whether a particular title plays.</p>
	<button class="btn" onclick={check} disabled={busy}>{busy ? 'Checking sources…' : 'Check sources'}</button>
	<div role="status">{problem || (at ? `Last checked ${new Date(at).toLocaleTimeString()}` : '')}</div>
	{#if results.length}
		<table><thead><tr><th>Source</th><th>Site response</th><th>Time</th></tr></thead><tbody>
		{#each results as item (item.id)}<tr><th scope="row">{item.name}</th><td>{item.status}{item.code ? ` (${item.code})` : ''}</td><td>{item.ms} ms</td></tr>{/each}
		</tbody></table>
	{/if}
</section>
<style>
	section { margin-block: 1.5rem; }
	p, [role="status"] { color: var(--muted); margin-block: .65rem; }
	table { width:100%; border-collapse: collapse; }
	th, td { text-align: start; padding: .45rem .2rem; border-bottom: 1px solid var(--border); }
</style>
