<!--
	A note shown read-only: a deleted page, or an earlier version of one.
	Looks the same as the editor. The body was cleaned when it was saved, so it's safe to show.
-->
<script lang="ts">
	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="wrap">
	<h1 class="title">{title}</h1>
	<div class="page">
		{#if body.trim()}
			{@html body}
		{:else}
			<p class="faint">Empty</p>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.title {
		font-family: var(--display);
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 600;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.page {
		min-height: 30vh;
		padding: 20px 22px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		line-height: 1.7;
		overflow-wrap: anywhere;
	}

	.page :global(h2) {
		font-size: 1.4rem;
		margin: 1.2em 0 0.4em;
	}
	.page :global(h3) {
		font-size: 1.15rem;
		margin: 1.1em 0 0.35em;
	}
	.page :global(p) {
		margin: 0 0 0.7em;
	}
	.page :global(ul),
	.page :global(ol) {
		margin: 0 0 0.7em;
		padding-left: 1.5em;
	}
	.page :global(li) {
		margin-bottom: 0.25em;
	}
	.page :global(blockquote) {
		margin: 0.8em 0;
		padding-left: 14px;
		border-left: 3px solid var(--accent);
		color: var(--ink-soft);
	}
	.page :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
		margin: 0.5em 0;
		display: block;
	}
	.page :global(hr) {
		border: none;
		border-top: 1px solid var(--rule-firm);
		margin: 1.2em 0;
	}
	.page :global(a) {
		color: var(--accent);
		text-decoration: underline;
	}
	.page :global(code) {
		font-family: var(--mono);
		font-size: 0.88em;
		background: var(--sunk);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
	.page :global(table) {
		border-collapse: collapse;
		margin: 0.6em 0;
	}
	.page :global(td),
	.page :global(th) {
		border: 1px solid var(--rule);
		padding: 5px 9px;
	}
</style>
