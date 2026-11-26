<script lang="ts">
	/*
	 * Where to hear the whole song: Spotify and YouTube, found by the song's name and artist.
	 * On a phone with the Spotify app, open.spotify.com links open the app by themselves; in
	 * Catalog's desktop app, electron/main.cjs turns them into the app's own link when Spotify is
	 * installed (else they open in the browser). No Spotify key is needed for a search link.
	 */
	let { song, artist, extra = '' }: { song: string; artist: string | null; extra?: string } = $props();

	const words = $derived([song, artist].filter(Boolean).join(' '));
	const spotify = $derived(`https://open.spotify.com/search/${encodeURIComponent(words)}`);
	const youtube = $derived(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${words} ${extra}`.trim())}`);
</script>

<div class="links">
	<a class="spotify" href={spotify} target="_blank" rel="noopener noreferrer">
		<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
			<circle cx="12" cy="12" r="12" fill="currentColor" />
			<path d="M6.5 9.3c3.8-1.1 8-.8 11.2 1M7.2 12.6c3.1-.9 6.5-.6 9.2.9M7.9 15.7c2.4-.7 5-.5 7.1.7" fill="none" stroke="#121212" stroke-width="1.6" stroke-linecap="round" />
		</svg>
		Spotify
	</a>
	<a class="youtube" href={youtube} target="_blank" rel="noopener noreferrer">
		<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
			<rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="currentColor" />
			<path d="M10 8.8v6.4l5.6-3.2z" fill="#fff" />
		</svg>
		YouTube
	</a>
</div>

<style>
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 14px 7px 10px;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: none;
		color: var(--ink);
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
		backdrop-filter: blur(6px);
		transition:
			transform 0.12s ease,
			border-color 0.2s ease;
	}
	a:hover {
		transform: translateY(-1px);
	}
	.spotify svg {
		color: #1ed760;
	}
	.spotify:hover {
		border-color: #1ed760;
	}
	.youtube svg {
		color: #ff0033;
	}
	.youtube:hover {
		border-color: #ff0033;
	}
</style>
