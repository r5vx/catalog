<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Catalog</title></svelte:head>

<div class="gate">
	<div class="circle" aria-hidden="true"></div>
	<h1>Catalog</h1>

	{#if form?.error}
		<p class="error" role="alert">{form.error}</p>
	{/if}

	<!-- svelte-ignore a11y_autofocus -->
	<form method="POST">
		<input
			type="password"
			id="pin"
			name="pin"
			placeholder="PIN"
			autocomplete="current-password"
			autofocus
			aria-label="PIN"
		/>
		<button type="submit" class="btn btn-primary">Open</button>
	</form>
</div>

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 80px 0 40px;
		max-width: 320px;
		margin: 0 auto;
		text-align: center;
	}

	.circle {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: #e994c2;
	}

	h1 {
		font-size: 1.7rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		margin-top: 6px;
	}

	.error {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
		border-radius: var(--radius-sm);
		padding: 8px 12px;
		margin: 0;
		font-size: 0.88rem;
		width: 100%;
	}
</style>
