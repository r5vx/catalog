<script lang="ts">
	import { SOURCE_GROUPS, ALL_SOURCES } from '$lib/sourceList';

	/** name → true (answers) / false (no answer); missing while the first check runs. */
	let online = $state<Record<string, boolean>>({});
	/** name → the color picked out of its site icon, the card's theme. */
	let brand = $state<Record<string, string>>({});
	/** Icons that didn't load: the card shows the first letter instead. */
	let noIcon = $state<Record<string, boolean>>({});

	const checked = $derived(Object.keys(online).length);
	const up = $derived(Object.values(online).filter(Boolean).length);

	$effect(() => {
		let stopped = false;
		const ask = () =>
			fetch('/api/sources/status')
				.then((r) => r.json())
				.then((answer) => { if (!stopped) online = answer; })
				.catch(() => {});
		ask();
		const timer = setInterval(ask, 2 * 60 * 1000);
		return () => { stopped = true; clearInterval(timer); };
	});

	/** The icon's main color: the average of its colorful pixels (or all of them, for a grey icon). */
	function themeFrom(img: HTMLImageElement, name: string) {
		const size = 24;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return;
		ctx.drawImage(img, 0, 0, size, size);
		const px = ctx.getImageData(0, 0, size, size).data;
		const colorful = [0, 0, 0, 0];
		const any = [0, 0, 0, 0];
		for (let i = 0; i < px.length; i += 4) {
			const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
			if (a < 128) continue;
			const max = Math.max(r, g, b), min = Math.min(r, g, b);
			const sum = max > 20 && max - min > 50 ? colorful : any;
			sum[0] += r; sum[1] += g; sum[2] += b; sum[3]++;
		}
		const pick = colorful[3] >= 6 ? colorful : any;
		if (!pick[3]) return;
		brand[name] = `rgb(${Math.round(pick[0] / pick[3])} ${Math.round(pick[1] / pick[3])} ${Math.round(pick[2] / pick[3])})`;
	}
</script>

<section class="sources">
	<div class="sources-head">
		<h2 class="sources-title">Sources</h2>
		<span class="sources-count">
			{checked ? `${up} of ${ALL_SOURCES.length} online` : 'Checking…'}
		</span>
	</div>

	{#each SOURCE_GROUPS as group (group.title)}
		<h3 class="group-title">{group.title}</h3>
		<div class="source-grid">
			{#each group.sources as source (source.name)}
				{@const state = online[source.name] === undefined ? 'checking' : online[source.name] ? 'up' : 'down'}
				<div class="source-card" class:down={state === 'down'} style={brand[source.name] ? `--brand: ${brand[source.name]}` : ''}>
					<div class="icon-tile">
						{#if noIcon[source.name]}
							<span class="letter">{source.name[0]}</span>
						{:else}
							<img
								src="/api/sources/icon/{encodeURIComponent(source.name)}"
								alt=""
								width="22"
								height="22"
								onload={(e) => themeFrom(e.currentTarget as HTMLImageElement, source.name)}
								onerror={() => (noIcon[source.name] = true)}
							/>
						{/if}
					</div>
					<div class="source-words">
						<span class="source-name">{source.name}</span>
						<span class="source-about">{source.about}</span>
					</div>
					<span class="status {state}" title={state === 'down' ? "The site didn't answer just now" : undefined}>
						<span class="status-dot" aria-hidden="true"></span>
						{state === 'up' ? 'Online' : state === 'down' ? 'Not reachable' : 'Checking'}
					</span>
				</div>
			{/each}
		</div>
	{/each}
</section>

<style>
	.sources {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 26px;
	}

	.sources-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.sources-title {
		font-size: 1.1rem;
		margin: 0;
	}

	.sources-count {
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	.group-title {
		margin: 10px 0 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.source-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 10px;
	}

	/* --brand is the color taken from the site's icon; the accent until it has loaded. */
	.source-card {
		--brand: var(--accent);
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		column-gap: 12px;
		row-gap: 8px;
		padding: 13px 14px;
		border: 1px solid color-mix(in srgb, var(--brand) 35%, var(--rule));
		border-radius: 12px;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%),
			var(--surface);
		overflow: hidden;
		transition: border-color 0.3s, opacity 0.3s;
	}

	.source-card::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 3px;
		background: var(--brand);
		opacity: 0.85;
	}

	.source-card.down {
		opacity: 0.6;
	}

	.icon-tile {
		grid-row: span 2;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--brand) 20%, var(--surface-2));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.icon-tile img {
		width: 22px;
		height: 22px;
		border-radius: 4px;
	}

	.letter {
		font-weight: 700;
		color: var(--brand);
	}

	.source-words {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.source-name {
		font-size: 0.94rem;
		font-weight: 600;
		color: var(--ink);
	}

	.source-about {
		font-size: 0.8rem;
		line-height: 1.35;
		color: var(--ink-faint);
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		justify-self: start;
		padding: 2px 9px;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 600;
		background: var(--surface-2);
		color: var(--ink-soft);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--status-offline);
	}

	.status.up { color: var(--status-online); background: color-mix(in srgb, var(--status-online) 12%, transparent); }
	.status.up .status-dot { background: var(--status-online); box-shadow: 0 0 6px var(--status-online); }
	.status.down { color: var(--status-dnd); background: color-mix(in srgb, var(--status-dnd) 12%, transparent); }
	.status.down .status-dot { background: var(--status-dnd); }
	.status.checking .status-dot { animation: pulse 1.2s ease-in-out infinite; }

	@keyframes pulse {
		50% { opacity: 0.3; }
	}
</style>
