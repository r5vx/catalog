<script lang="ts">
	import { onMount } from 'svelte';
	import { isTv } from '$lib/tv';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	/* On the TV there's no keyboard to type with: number keys to press with the remote instead. */
	let tv = $state(false);
	let pin = $state('');
	let padStart: HTMLButtonElement | undefined = $state();
	onMount(() => {
		tv = isTv();
	});
	$effect(() => {
		if (tv && padStart) padStart.focus();
	});
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
			autofocus={!tv}
			readonly={tv}
			tabindex={tv ? -1 : undefined}
			aria-label="PIN"
			bind:value={pin}
		/>
		{#if tv}
			<div class="pad">
				{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit, i (digit)}
					{#if i === 0}
						<button type="button" class="btn" bind:this={padStart} onclick={() => (pin += digit)}>{digit}</button>
					{:else}
						<button type="button" class="btn" onclick={() => (pin += digit)}>{digit}</button>
					{/if}
				{/each}
				<button type="button" class="btn" onclick={() => (pin = pin.slice(0, -1))} aria-label="Delete">⌫</button>
				<button type="button" class="btn" onclick={() => (pin += '0')}>0</button>
				<button type="submit" class="btn btn-primary">Open</button>
			</div>
		{:else}
			<button type="submit" class="btn btn-primary">Open</button>
		{/if}
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

	/* The TV's number keys, three across. */
	.pad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.pad .btn {
		font-size: 1.3rem;
		padding: 12px 0;
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
