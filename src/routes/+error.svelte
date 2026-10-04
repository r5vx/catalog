<script lang="ts">
	import { page } from '$app/state';

	function goBack() {
		if (window.history.length > 1) window.history.back();
		else window.location.href = '/';
	}
</script>

<div class="error-page">
	<h1>{page.status}</h1>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<button type="button" class="back-link" onclick={goBack}>← Go back</button>
	<a href="/">Library</a>
</div>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 50vh;
		gap: 12px;
		text-align: center;
		padding: 40px 20px;
	}

	h1 {
		font-size: 3rem;
		margin: 0;
		color: var(--ink-soft);
	}

	p {
		font-size: 1rem;
		color: var(--ink-soft);
		margin: 0;
	}

	.back-link {
		background: none;
		border: none;
		cursor: pointer;
		margin-top: 8px;
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0;
	}

	a {
		color: var(--ink-soft);
		font-size: 0.85rem;
	}
</style>
