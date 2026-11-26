<script lang="ts">
	let {
		title,
		year = null,
		kind = null
	}: {
		title: string;
		year?: string | number | null;
		kind?: string | null;
	} = $props();

	/** Deterministic subtle hue from title so placeholders feel distinct instead of uniform grey. */
	const hue = $derived.by(() => {
		let h = 215;
		for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
		return h;
	});
</script>

<div class="poster-card" style:--ph-hue={hue}>
	<span class="bar" aria-hidden="true"></span>
	<span class="name">{title}</span>
</div>

<style>
	.poster-card {
		position: relative;
		width: 100%;
		height: 100%;
		padding: 16px 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		background:
			radial-gradient(circle at 80% 15%, hsl(var(--ph-hue) 48% 36% / 0.35), transparent 60%),
			linear-gradient(160deg, hsl(var(--ph-hue) 26% 18%) 0%, hsl(var(--ph-hue) 22% 10%) 100%);
		color: #f3f4f6;
		text-align: center;
		overflow: hidden;
	}

	.bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: hsl(var(--ph-hue) 68% 60% / 0.75);
	}

	.name {
		font-size: 0.92rem;
		font-weight: 700;
		line-height: 1.3;
		letter-spacing: -0.01em;
		display: -webkit-box;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
	}
</style>
