<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import Avatar from '$lib/Avatar.svelte';
	import { wording } from '$lib/altText';

	/**
	 * What friends watched lately, newest first, with the rating they gave (the library's Friends,
	 * under Friends online). Each Catalog sends its own newest 20 (online.ts `shareActivity`); here
	 * each friend shows at most PER_FRIEND, from the last DAYS days, so one person adding a pile of
	 * titles at once can't fill it.
	 */
	type Item = { key: string; title: string; year: string; type: 'tv' | 'movie'; poster: string; rating: number | null; at: number; season?: number; episode?: number };
	type FromFriend = { id: string; name: string; avatar: number; items: Item[] };

	const PER_FRIEND = 3;
	const MOST = 18;
	const DAYS = 60;

	let { start = null }: { start?: unknown } = $props();
	let friends = $state<FromFriend[]>(untrack(() => ((start as { friends?: FromFriend[] } | null)?.friends ?? [])));

	const t = (text: string) => wording(page.data.altMode, text);

	const feed = $derived.by(() => {
		const since = Date.now() - DAYS * 86_400_000;
		return friends
			.flatMap((friend) =>
				friend.items
					.filter((item) => item.at >= since)
					.sort((a, b) => b.at - a.at)
					.slice(0, PER_FRIEND)
					.map((item) => ({ ...item, friend }))
			)
			.sort((a, b) => b.at - a.at)
			.slice(0, MOST);
	});

	/** The title's own page: "tmdb:movie:550" opens /title/tmdb/movie:550?back=…. */
	const href = (key: string) => {
		const at = key.indexOf(':');
		// With the way back, so the title page's Back returns to Friends rather than the library.
		const back = encodeURIComponent(page.url.pathname + page.url.search);
		return `/title/${key.slice(0, at)}/${encodeURIComponent(key.slice(at + 1))}?back=${back}`;
	};

	/** Today, Yesterday, then the date itself ("Nov 12"; with the year when it isn't this year). Owner, 2026-11-15. */
	function ago(at: number): string {
		const then = new Date(at);
		const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		const days = Math.round((start(new Date()) - start(then)) / 86_400_000);
		if (days <= 0) return t('Today');
		if (days === 1) return t('Yesterday');
		const sameYear = then.getFullYear() === new Date().getFullYear();
		return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
	}

	onMount(() => {
		fetch('/api/online/c/activity')
			.then((r) => (r.ok ? r.json() : null))
			.then((answer) => {
				if (answer?.friends) friends = answer.friends;
			})
			.catch(() => {});
	});
</script>

{#if feed.length}
	<section class="feed">
		<h2>{t('Friends watched lately')}</h2>
		<ul>
			{#each feed as item (`${item.friend.id}|${item.key}`)}
				<li>
					<a class="poster" href={href(item.key)} aria-label={item.title}>
						{#if item.poster}<img src={item.poster} alt="" loading="lazy" />{:else}<span class="empty" aria-hidden="true"></span>{/if}
					</a>
					<div class="about">
						<a class="title" href={href(item.key)}>{item.title}</a>
						{#if item.episode}<span class="episode tabular">S{item.season}E{item.episode}</span>{/if}
						<span class="faint small">{item.year}</span>
						<span class="who">
							<Avatar id={item.friend.id} name={item.friend.name} rev={item.friend.avatar} size={20} />
							{item.friend.name}
						</span>
						<span class="small">
							{#if item.rating != null}<span class="rating tabular">★ {item.rating}/10</span> · {/if}<span class="faint">{ago(item.at)}</span>
						</span>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.feed {
		margin-bottom: 22px;
		padding: 14px 16px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		margin: 0 0 12px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 12px;
	}

	li {
		display: flex;
		gap: 10px;
		min-width: 0;
	}

	.poster img,
	.poster .empty {
		display: block;
		width: 48px;
		height: 72px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: var(--rule);
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The episode watched last, for a show or anime. */
	.episode {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.title:hover {
		color: var(--accent);
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
	}

	.rating {
		color: var(--accent);
	}

	.small {
		font-size: 0.8rem;
	}
</style>
