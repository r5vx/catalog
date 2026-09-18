<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Privacy · Catalog</title></svelte:head>

<section>
	<div class="head">
		<h2>PIN lock</h2>
		<span class="pill" class:completed={data.pinSet}>{data.pinSet ? 'On' : 'Off'}</span>
	</div>

	<p class="muted">Only matters if you use Tailscale or similar to reach your library from your phone. Asks for a PIN before anyone on your network can open it.</p>

	{#if form?.pinError}
		<p class="msg bad" role="alert">{form.pinError}</p>
	{:else if form?.pinOk}
		<p class="msg good" role="status">{form.pinOk}</p>
	{/if}

	{#if data.pinSet}
		<div class="saved-row">
			<span class="muted">A PIN is set.</span>
			<form method="POST" action="?/removePin">
				<button type="submit" class="btn btn-danger">Remove PIN</button>
			</form>
		</div>
		<details>
			<summary>Change it</summary>
			<form method="POST" action="?/savePin" class="inline-form">
				<input type="password" name="pin" placeholder="New PIN" autocomplete="off" />
				<button type="submit" class="btn btn-primary">Save</button>
			</form>
		</details>
	{:else}
		<form method="POST" action="?/savePin" class="inline-form">
			<input
				type="password"
				name="pin"
				placeholder="Choose a PIN (4+ characters)"
				autocomplete="off"
			/>
			<button type="submit" class="btn">Set PIN</button>
		</form>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--rule);
		padding-bottom: 8px;
	}

	h2 {
		font-size: 1.1rem;
	}

	.muted {
		font-size: 0.93rem;
		margin: 0;
	}

	.inline-form {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}

	.inline-form input {
		flex: 1;
		min-width: 0;
	}

	.saved-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
	}

	.saved-row .muted {
		font-size: 0.9rem;
	}

	details summary {
		font-size: 0.87rem;
		color: var(--ink-soft);
		cursor: pointer;
		padding: 4px 0;
	}

	details summary:hover {
		color: var(--accent);
	}

	details .inline-form {
		margin-top: 10px;
	}

	.msg {
		border-radius: var(--radius-sm);
		padding: 9px 13px;
		margin: 0;
		font-size: 0.89rem;
	}

	.bad {
		background: var(--accent-bg);
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.good {
		background: var(--good-bg);
		border: 1px solid var(--good);
		color: var(--good);
	}
</style>
