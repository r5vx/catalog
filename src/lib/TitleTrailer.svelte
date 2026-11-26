<script lang="ts">
	let { videoId, title }: { videoId: string; title: string } = $props();
</script>

<aside aria-label="Trailer">
	<h2>Trailer</h2>
	<iframe src="https://www.youtube-nocookie.com/embed/{encodeURIComponent(videoId)}?rel=0" title="{title} trailer" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>
</aside>

<style>
	aside { width:100%; max-width:34rem; min-width:0; }
	h2 { margin:0 0 .45rem; font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-faint); }
	iframe { display:block; width:100%; aspect-ratio:16/9; border:0; border-radius:var(--radius); background:#111; }
</style>
