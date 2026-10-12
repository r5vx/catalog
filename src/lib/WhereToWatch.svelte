<script lang="ts">
	/**
	 * Where you can watch it, in your country.
	 *
	 * The question a library can't normally answer — you know you want to see
	 * it, the problem is finding it. Asked for after the page has drawn,
	 * because it's an extra network round trip and the poster shouldn't wait.
	 */
	type Offer = { name: string; logo: string | null };

	type Where = {
		region: string;
		link: string | null;
		stream: Offer[];
		free: Offer[];
		rent: Offer[];
		buy: Offer[];
	};

	let {
		entryId = null,
		source = null,
		sourceId = null,
		title = null,
		year = null
	}: {
		/** For something in the library — the answer gets kept on the entry. */
		entryId?: number | null;
		source?: string | null;
		sourceId?: string | null;
		title?: string | null;
		year?: number | null;
	} = $props();

	/**
	 * Each service's own search, with the title filled in, so a logo takes you to it there.
	 * A service not listed here (or whose search can't be linked to) goes to the full listings
	 * instead, which link to every one.
	 */
	const SEARCHES: [RegExp, (q: string) => string][] = [
		[/netflix/i, (q) => `https://www.netflix.com/search?q=${q}`],
		[/amazon|prime video/i, (q) => `https://www.amazon.com/s?k=${q}&i=instant-video`],
		[/hulu/i, (q) => `https://www.hulu.com/search?q=${q}`],
		[/apple tv/i, (q) => `https://tv.apple.com/search?term=${q}`],
		[/google play/i, (q) => `https://play.google.com/store/search?q=${q}&c=movies`],
		[/youtube/i, (q) => `https://www.youtube.com/results?search_query=${q}`],
		[/crunchyroll/i, (q) => `https://www.crunchyroll.com/search?q=${q}`],
		[/tubi/i, (q) => `https://tubitv.com/search/${q}`],
	];

	function linkFor(offer: Offer): string | null {
		const search = SEARCHES.find(([name]) => name.test(offer.name))?.[1];
		return search && title ? search(encodeURIComponent(title)) : (where?.link ?? null);
	}

	let where = $state<Where | null>(null);
	let looking = $state(false);
	let asked = $state(false);

	const rows = $derived(
		where
			? [
					{ label: 'Streaming', offers: where.stream },
					{ label: 'Free', offers: where.free },
					{ label: 'Rent', offers: where.rent },
					{ label: 'Buy', offers: where.buy }
				].filter((row) => row.offers.length > 0)
			: []
	);

	/** The country the answer is for, written the way people say it. */
	const country = $derived.by(() => {
		if (!where) return '';
		try {
			return new Intl.DisplayNames(undefined, { type: 'region' }).of(where.region) ?? where.region;
		} catch {
			return where.region;
		}
	});

	$effect(() => {
		// Read up front so the effect re-runs when the page shows a different
		// title, rather than holding the first one's answer.
		const query = entryId
			? `entry=${entryId}`
			: source && sourceId
				? `source=${source}&id=${encodeURIComponent(sourceId)}` +
					`&title=${encodeURIComponent(title ?? '')}&year=${year ?? ''}`
				: '';

		if (!query) return;

		let stop = false;
		where = null;
		asked = false;
		looking = true;

		fetch(`/api/providers?${query}`)
			.then((response) => (response.ok ? response.json() : null))
			.then((payload) => {
				if (stop) return;
				where = payload?.where ?? null;
				asked = true;
			})
			.catch(() => {
				// Offline. The section simply doesn't appear.
			})
			.finally(() => {
				if (!stop) looking = false;
			});

		return () => {
			stop = true;
		};
	});
</script>

{#if looking}
	<section class="watch">
		<h2 class="label">Where to watch</h2>
		<p class="faint small">Checking…</p>
	</section>
{:else if rows.length > 0}
	<section class="watch">
		<h2 class="label">Where to watch <span class="faint where">in {country}</span></h2>

		{#each rows as row (row.label)}
			<div class="row">
				<span class="kind faint">{row.label}</span>
				<ul>
					{#each row.offers as offer (offer.name)}
						{@const href = linkFor(offer)}
						<li>
							<svelte:element this={href ? 'a' : 'span'} class="offer" {href} target={href ? '_blank' : undefined} rel={href ? 'noreferrer' : undefined}>
								{#if offer.logo}
									<!-- Not lazy: they're 92px icons, a handful at a time, and
									     they arrive after the rest of the page anyway. -->
									<img src={offer.logo} alt="" />
								{/if}
								<span>{offer.name}</span>
							</svelte:element>
						</li>
					{/each}
				</ul>
			</div>
		{/each}

		{#if where?.link}
			<p class="small">
				<a href={where.link} target="_blank" rel="noreferrer">
					Full listings &rarr;
				</a>
				<span class="faint">· from JustWatch</span>
			</p>
		{/if}
	</section>
{:else if asked && where}
	<section class="watch">
		<h2 class="label">Where to watch</h2>
		<p class="faint small">Not streaming anywhere in {country} right now.</p>
	</section>
{/if}

<style>
	.label {
		font-family: var(--body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0 0 10px;
	}

	.where {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 9px;
	}

	.kind {
		flex: 0 0 66px;
		font-size: 0.76rem;
	}

	ul {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin: 0;
		padding: 0;
	}

	/* The service's logo and its name, together a link to it. */
	.offer {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 0.78rem;
		padding: 3px 10px 3px 3px;
		border: 1px solid var(--rule);
		border-radius: 9px;
		background: var(--surface);
		color: var(--ink);
	}

	a.offer:hover {
		border-color: var(--accent);
	}

	.offer img {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		display: block;
		background: var(--surface-2);
	}

	.offer:not(:has(img)) {
		padding-left: 10px;
	}

	.small {
		font-size: 0.78rem;
		margin: 6px 0 0;
	}

	.small a {
		color: var(--accent);
	}

	.small a:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
