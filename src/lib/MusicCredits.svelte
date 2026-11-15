<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The Music tab beside Cast (src/lib/server/metadata/music.ts): who did the music, an anime's
	 * openings and endings, and each soundtrack album with its tracks and who performs them. Each
	 * song links to a YouTube search for it. Asked for when the tab is opened (MusicBrainz takes a
	 * few seconds the first time; after that it's kept).
	 */
	type Person = { name: string; job: string; photo: string | null; sourceId: string | null };
	type Track = { n: string; title: string; artist: string; length: number | null };
	type Album = { title: string; year: string; artist: string; link: string; tracks: Track[] };
	type Theme = { kind: 'Opening' | 'Ending'; title: string; artist: string; episodes: string };

	let { source, sourceId, title, year, type, anime = false, back = null }: { source: string; sourceId: string; title: string; year: string | number | null; type: 'movie' | 'tv'; anime?: boolean; back?: string | null } = $props();

	let music = $state<{ people: Person[]; albums: Album[]; themes: Theme[] } | null>(null);
	let failed = $state(false);
	/** Albums opened to show their tracks (the first one is, to begin with). */
	let opened = $state<Set<number>>(new Set([0]));

	onMount(async () => {
		const params = new URLSearchParams({ source, id: sourceId, title, year: String(year ?? ''), type, anime: anime ? '1' : '0' });
		try {
			const response = await fetch(`/api/music?${params}`);
			music = response.ok ? await response.json() : null;
			failed = !response.ok;
		} catch {
			failed = true;
		}
	});

	const youtube = (song: string, artist: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song} ${artist}`.trim())}`;
	const length = (seconds: number | null) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '');
	const personHref = (person: Person) => {
		const params = new URLSearchParams({ name: person.name });
		if (person.photo) params.set('photo', person.photo);
		if (back) params.set('back', back);
		return `/person/${person.sourceId}?${params}`;
	};

	function toggle(index: number) {
		const next = new Set(opened);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		opened = next;
	}
</script>

{#if !music && !failed}
	<p class="faint">Looking up the music…</p>
{:else if !music || (!music.people.length && !music.albums.length && !music.themes.length)}
	<p class="faint">No music credits found for this one.</p>
{:else}
	<div class="music">
		{#if music.people.length}
			<ul class="people">
				{#each music.people as person (person.name + person.job)}
					<li>
						<a href={person.sourceId ? personHref(person) : undefined}>
							{#if person.photo}<img src={person.photo} alt="" loading="lazy" />{:else}<span class="noface" aria-hidden="true">♪</span>{/if}
							<span class="who">{person.name}</span>
							<span class="role faint">{person.job}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if music.themes.length}
			<section>
				<h3>Openings and endings</h3>
				<ol class="songs">
					{#each music.themes as theme, index (index)}
						<li>
							<span class="kind faint">{theme.kind}</span>
							<a class="song" href={youtube(theme.title, theme.artist)} target="_blank" rel="noreferrer">{theme.title}</a>
							{#if theme.artist}<span class="artist">{theme.artist}</span>{/if}
							{#if theme.episodes}<span class="faint small">ep. {theme.episodes}</span>{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#each music.albums as album, index (album.link)}
			<section class="album">
				<button type="button" class="album-head" onclick={() => toggle(index)} aria-expanded={opened.has(index)}>
					<span class="album-title">{album.title}</span>
					<span class="faint small">{[album.artist, album.year, `${album.tracks.length} tracks`].filter(Boolean).join(' · ')}</span>
				</button>
				{#if opened.has(index)}
					<ol class="songs">
						{#each album.tracks as track, n (n)}
							<li>
								<span class="faint tabular n">{track.n}</span>
								<a class="song" href={youtube(track.title, track.artist)} target="_blank" rel="noreferrer">{track.title}</a>
								{#if track.artist && track.artist !== album.artist}<span class="artist">{track.artist}</span>{/if}
								<span class="faint tabular small len">{length(track.length)}</span>
							</li>
						{/each}
					</ol>
					<a class="faint small source" href={album.link} target="_blank" rel="noreferrer">MusicBrainz</a>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
	.music {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	ul,
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.people {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	.people li {
		flex: 0 0 88px;
	}

	.people a {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--ink);
		text-decoration: none;
	}

	.people img,
	.noface {
		width: 88px;
		height: 88px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--rule);
	}

	.noface {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--ink-faint);
		font-size: 1.6rem;
	}

	.people a[href]:hover img {
		border-color: var(--accent);
	}

	.who {
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.25;
	}

	.role {
		font-size: 0.73rem;
		line-height: 1.25;
	}

	h3 {
		margin: 0 0 8px;
		font-size: 0.95rem;
	}

	.songs {
		display: flex;
		flex-direction: column;
	}

	.songs li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		padding: 6px 4px;
		border-bottom: 1px solid var(--rule);
		font-size: 0.92rem;
	}

	.songs li:last-child {
		border-bottom: 0;
	}

	.n {
		min-width: 2.2em;
		font-size: 0.8rem;
	}

	.kind {
		min-width: 4.6em;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.song {
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	.song:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.artist {
		color: var(--ink-soft);
	}

	.len {
		margin-left: auto;
	}

	.album-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
		width: 100%;
		padding: 8px 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.album-title {
		font-weight: 700;
	}

	.album-head:hover .album-title {
		color: var(--accent);
	}

	.small {
		font-size: 0.8rem;
	}

	.source {
		display: inline-block;
		margin-top: 6px;
	}
</style>
