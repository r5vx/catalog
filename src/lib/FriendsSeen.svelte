<script lang="ts">
	/**
	 * "Ann and 3 others watched this", on a title's page: which of your friends have watched it.
	 * Friends online (src/lib/server/online.ts `shareSeen` sends each person's watched titles; the
	 * meeting point answers for your friends only), and friends who shared their library as a file
	 * (src/lib/server/sharedSeen.ts), which needs nothing online. Click it for everyone and what
	 * they rated it. Shows nothing when no friend has watched it.
	 */
	import Avatar from '$lib/Avatar.svelte';

	/** `tv`: on a TV's title screen, only the line (nothing to click), in the screen's own text size. */
	type Props = { source: string; sourceId: string; title: string; year?: number | null; tv?: boolean };
	let { source, sourceId, title, year = null, tv = false }: Props = $props();

	type Friend = { id: string; name: string; avatar: number; rating: number | null };
	/** Friends online, and friends whose shared library file is kept here (the library's Friends). */
	let online = $state<Friend[]>([]);
	let fromFiles = $state<Friend[]>([]);
	let open = $state(false);
	// One person once: a friend online who also sent a file is the online one (it's the newer word).
	const friends = $derived([...online, ...fromFiles.filter((f) => !online.some((o) => o.name.trim().toLowerCase() === f.name.trim().toLowerCase()))]);

	$effect(() => {
		const asked = { source, sourceId, title, year };
		let current = true;
		online = [];
		fromFiles = [];
		open = false;
		const ask = (address: string, take: (list: Friend[]) => void) =>
			fetch(address)
				.then((r) => (r.ok ? r.json() : null))
				.then((answer) => {
					if (current && Array.isArray(answer?.friends)) take(answer.friends);
				})
				.catch(() => {});
		ask(`/api/online/c/seen?${new URLSearchParams({ key: `${asked.source}:${asked.sourceId}`, title: asked.title })}`, (list) => (online = list));
		ask(`/api/shared/seen?${new URLSearchParams({ source: asked.source, id: asked.sourceId, title: asked.title, year: String(asked.year ?? '') })}`, (list) => (fromFiles = list));
		return () => (current = false);
	});

	const line = $derived.by(() => {
		const names = friends.map((f) => f.name);
		if (names.length === 1) return `${names[0]} watched this`;
		if (names.length === 2) return `${names[0]} and ${names[1]} watched this`;
		return `${names[0]} and ${names.length - 1} others watched this`;
	});
	// Ratings are out of 10; a whole number shows without ".0".
	const rated = (rating: number) => `${Number.isInteger(rating) ? rating : rating.toFixed(1)}/10`;
</script>

{#if friends.length && tv}
	<p class="tv-line">
		<span class="faces">
			{#each friends.slice(0, 4) as friend (friend.id)}
				<Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={30} />
			{/each}
		</span>
		<span>{line}</span>
	</p>
{:else if friends.length}
	<div class="seen">
		<button type="button" class="summary" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="faces">
				{#each friends.slice(0, 4) as friend (friend.id)}
					<Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={26} />
				{/each}
			</span>
			<span>{line}</span>
		</button>
		{#if open}
			<ul>
				{#each friends as friend (friend.id)}
					<li>
						<Avatar id={friend.id} name={friend.name} rev={friend.avatar} size={26} />
						<span class="name">{friend.name}</span>
						<span class="faint tabular">{friend.rating === null ? 'Not rated' : rated(friend.rating)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.seen {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 10px;
	}

	.summary {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		width: fit-content;
		border: 0;
		background: none;
		padding: 0;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.92rem;
		text-align: left;
		cursor: pointer;
	}

	/* The TV's line: sized like the facts line above it (src/routes/tv/title). */
	.tv-line {
		display: flex;
		align-items: center;
		gap: 1vw;
		margin: 0;
		font-size: 1.4vw;
		color: var(--ink-soft);
	}

	.summary:hover {
		color: var(--accent);
	}

	/* The faces overlap a little, each ringed in the page's color so they read apart. */
	.faces {
		display: inline-flex;
	}

	.faces :global(.avatar) {
		box-shadow: 0 0 0 2px var(--paper);
	}

	.faces :global(.avatar + .avatar) {
		margin-left: -8px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: fit-content;
		min-width: 14rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.92rem;
	}

	.name {
		flex: 1;
		font-weight: 600;
	}
</style>
