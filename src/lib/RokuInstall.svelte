<script lang="ts">
	/**
	 * Settings → TV: puts Catalog on a Roku from here (src/lib/server/rokuInstall.ts). Finds the
	 * Rokus on the Wi-Fi, says which have developer mode on, and installs with the password set
	 * when it was turned on (used once, never kept).
	 */
	type Roku = { address: string; name: string; model: string; developerMode: boolean };

	let rokus = $state<Roku[] | null>(null);
	let looking = $state(false);
	let typed = $state('');
	let picked = $state('');
	let password = $state('');
	let installing = $state(false);
	let answer = $state<{ ok: boolean; message: string } | null>(null);

	const chosen = $derived(rokus?.find((r) => r.address === picked) ?? null);

	async function look(address?: string) {
		looking = true;
		answer = null;
		try {
			const r = await fetch(address ? `/api/roku-install?address=${encodeURIComponent(address)}` : '/api/roku-install');
			const found = r.ok ? ((await r.json()) as { rokus: Roku[] }).rokus : [];
			// One typed in joins the ones found.
			rokus = address ? [...(rokus ?? []).filter((x) => x.address !== address), ...found] : found;
			if (!rokus.some((x) => x.address === picked)) picked = rokus.find((x) => x.developerMode)?.address ?? rokus[0]?.address ?? '';
		} finally {
			looking = false;
		}
	}

	async function install() {
		if (!chosen) return;
		installing = true;
		answer = null;
		try {
			const r = await fetch('/api/roku-install', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: chosen.address, password })
			});
			answer = r.ok ? await r.json() : { ok: false, message: (await r.json().catch(() => null))?.message ?? "Couldn't install." };
			if (answer?.ok) password = '';
		} finally {
			installing = false;
		}
	}
</script>

<div class="roku">
	<button type="button" class="btn" disabled={looking} onclick={() => look()}>{looking ? 'Looking…' : rokus ? 'Look again' : 'Find Rokus'}</button>

	{#if rokus && !rokus.length}
		<p class="muted">No Roku found on this Wi-Fi. Make sure it's on, or type its address (Roku Settings → Network → About).</p>
	{/if}

	{#if rokus?.length}
		<ul class="list">
			{#each rokus as roku (roku.address)}
				<li>
					<label>
						<input type="radio" name="roku" value={roku.address} bind:group={picked} />
						<span class="name">{roku.name}</span>
						<span class="faint">{[roku.model, roku.address].filter(Boolean).join(' · ')}</span>
						<span class="mode" class:off={!roku.developerMode}>{roku.developerMode ? 'Developer mode on' : 'Developer mode off'}</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}

	{#if rokus}
		<form class="typed" onsubmit={(e) => { e.preventDefault(); if (typed.trim()) look(typed.trim()); }}>
			<input type="text" placeholder="Or type its address, like 192.168.1.40" bind:value={typed} aria-label="The Roku's address" />
			<button type="submit" class="btn" disabled={looking || !typed.trim()}>Add</button>
		</form>
	{/if}

	{#if chosen && !chosen.developerMode}
		<div class="howto">
			<p><strong>Turn on developer mode on {chosen.name}</strong> (once). With the Roku remote, on the Home screen press:</p>
			<p class="keys">Home ×3, Up ×2, Right, Left, Right, Left, Right</p>
			<p class="muted">
				Choose <em>Enable installer and restart</em>, agree, and set a password (write it down). The Roku restarts; then press
				Look again.
			</p>
		</div>
	{/if}

	{#if chosen?.developerMode}
		<form class="install" onsubmit={(e) => { e.preventDefault(); install(); }}>
			<input type="password" autocomplete="off" placeholder="The Roku's developer password" bind:value={password} aria-label="The Roku's developer password" />
			<button type="submit" class="btn btn-primary" disabled={installing || !password}>{installing ? 'Installing…' : `Install on ${chosen.name}`}</button>
		</form>
		<p class="faint small">The password is the one set when developer mode was turned on. Catalog doesn't keep it.</p>
	{/if}

	{#if answer}
		<p class="msg" class:bad={!answer.ok}>{answer.message}</p>
	{/if}
</div>

<style>
	.roku {
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

	.typed,
	.install {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.typed input,
	.install input {
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

	.keys {
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.small {
		font-size: 0.85rem;
	}

	button {
		align-self: flex-start;
	}
</style>
