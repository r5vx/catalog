<script lang="ts">
	/**
	 * Settings → TV and phones: puts the Catalog app on a Fire TV from here, or updates it
	 * (src/lib/server/fireTvInstall.ts), through the TV's developer connection. Lists the Fire TVs
	 * that have opened Catalog and any with ADB debugging on, says which still need it turned on,
	 * and shows each step of an install ("Press Allow on the TV", sending, installing).
	 */
	type FireTv = { address: string; name: string; seen: number | null; open: boolean };
	type Job = { status: 'connecting' | 'allow' | 'sending' | 'installing' | 'opening' | 'done' | 'error'; percent: number; message: string };

	let tvs = $state<FireTv[] | null>(null);
	let looking = $state(false);
	let typed = $state('');
	let picked = $state('');
	let job = $state<Job | null>(null);
	let working = $state(false);

	const chosen = $derived(tvs?.find((tv) => tv.address === picked) ?? null);
	const label = (tv: FireTv) => tv.name || (tv.seen ? 'Fire TV with Catalog' : 'Fire TV');
	const when = (at: number) => {
		const days = Math.floor((Date.now() - at) / 86_400_000);
		return days <= 0 ? 'opened Catalog today' : days === 1 ? 'opened Catalog yesterday' : `opened Catalog ${days} days ago`;
	};

	async function look(address?: string) {
		looking = true;
		job = null;
		try {
			const r = await fetch(address ? `/api/firetv-install?address=${encodeURIComponent(address)}` : '/api/firetv-install');
			const found = r.ok ? ((await r.json()) as { tvs: FireTv[] }).tvs : [];
			tvs = address ? [...(tvs ?? []).filter((tv) => tv.address !== address), ...found] : found;
			if (!tvs.some((tv) => tv.address === picked)) picked = tvs.find((tv) => tv.open)?.address ?? tvs[0]?.address ?? '';
		} finally {
			looking = false;
		}
	}

	async function install() {
		if (!chosen) return;
		working = true;
		job = { status: 'connecting', percent: 0, message: '' };
		try {
			const r = await fetch('/api/firetv-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: chosen.address }) });
			const id = r.ok ? ((await r.json()) as { job: string }).job : '';
			if (!id) {
				job = { status: 'error', percent: 0, message: (await r.json().catch(() => null))?.message ?? "Couldn't start." };
				return;
			}
			// Asked every second until it's done (the TV may wait for Allow up to a minute and a half).
			for (;;) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const now = await fetch(`/api/firetv-install?job=${encodeURIComponent(id)}`)
					.then((x) => (x.ok ? x.json() : null))
					.catch(() => null);
				if (!now) break;
				job = now;
				if (now.status === 'done' || now.status === 'error') break;
			}
			if (job?.status === 'done') await look();
		} finally {
			working = false;
		}
	}

	const stepText = (j: Job) =>
		j.status === 'connecting'
			? 'Connecting to the TV…'
			: j.status === 'allow'
				? 'Press Allow on the TV. Tick "Always allow from this computer" so it never asks again.'
				: j.status === 'sending'
					? `Sending the app… ${j.percent}%`
					: j.status === 'installing'
						? 'Installing…'
						: j.status === 'opening'
							? 'Opening Catalog on the TV…'
							: j.message;
</script>

<div class="firetv">
	<button type="button" class="btn" disabled={looking || working} onclick={() => look()}>{looking ? 'Looking… (a few seconds)' : tvs ? 'Look again' : 'Find Fire TVs'}</button>

	{#if tvs && !tvs.length}
		<p class="muted">No Fire TV found. Turn on ADB debugging on it (below), or type its address (Fire TV Settings → My Fire TV → About → Network).</p>
	{/if}

	{#if tvs?.length}
		<ul class="list">
			{#each tvs as tv (tv.address)}
				<li>
					<label>
						<input type="radio" name="firetv" value={tv.address} bind:group={picked} disabled={working} />
						<span class="name">{label(tv)}</span>
						<span class="faint">{[tv.address, tv.seen ? when(tv.seen) : tv.name ? 'installed from here' : ''].filter(Boolean).join(' · ')}</span>
						<span class="mode" class:off={!tv.open}>{tv.open ? 'Ready' : 'ADB debugging off'}</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}

	{#if tvs}
		<form class="typed" onsubmit={(e) => { e.preventDefault(); if (typed.trim()) look(typed.trim()); }}>
			<input type="text" placeholder="Or type its address, like 192.168.1.50" bind:value={typed} aria-label="The Fire TV's address" />
			<button type="submit" class="btn" disabled={looking || !typed.trim()}>Add</button>
		</form>
	{/if}

	{#if chosen && !chosen.open}
		<div class="howto">
			<p><strong>Let this computer in, once, on {label(chosen)}:</strong></p>
			<ol>
				<li>Settings → My Fire TV → <em>Developer options</em>. (No Developer options? Open <em>About</em> and press OK on the TV's name seven times.)</li>
				<li>Turn on <em>ADB debugging</em>.</li>
				<li>Press Look again, then Install. The TV asks "Allow USB debugging?": tick <em>Always allow from this computer</em> and press Allow.</li>
			</ol>
			<p class="muted">After that, installing and updating from here needs nothing on the TV. Fire TV sometimes turns ADB debugging off after its own updates; turn it on again then.</p>
		</div>
	{/if}

	{#if chosen?.open}
		<button type="button" class="btn btn-primary" disabled={working} onclick={install}>{working ? 'Installing…' : `Install on ${label(chosen)}`}</button>
		<p class="faint small">Installs the newest Catalog app, or updates the one there. What it saved (this computer, profiles) stays.</p>
	{/if}

	{#if job}
		<p class="msg" class:bad={job.status === 'error'} class:allow={job.status === 'allow'} aria-live="polite">{stepText(job)}</p>
	{/if}
</div>

<style>
	.firetv {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 62ch;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.list label {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
	}

	.list input {
		width: auto;
	}

	.name {
		font-weight: 600;
	}

	.mode {
		margin-left: auto;
		font-size: 0.82rem;
		color: var(--ok, var(--accent));
	}

	.mode.off {
		color: var(--warn);
	}

	.typed {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.typed input {
		flex: 1;
		min-width: 220px;
	}

	.howto {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--rule);
	}

	.howto p,
	.howto ol {
		margin: 0;
	}

	.howto ol {
		padding-left: 1.3em;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.allow {
		border-color: var(--accent);
		font-weight: 600;
	}

	.small {
		font-size: 0.85rem;
	}

	button {
		align-self: flex-start;
	}
</style>
