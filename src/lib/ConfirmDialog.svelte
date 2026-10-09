<!-- The box confirmAction() opens. Placed once, in the root layout. -->
<script lang="ts">
	import { dialog } from '$lib/confirm.svelte';

	let confirmButton = $state<HTMLButtonElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!dialog.open) return;
		if (inputEl) {
			inputEl.focus();
			inputEl.select();
		} else confirmButton?.focus();
	});

	function onKey(e: KeyboardEvent) {
		if (!dialog.open) return;
		if (e.key === 'Escape') dialog.open.answer(false);
	}
</script>

<svelte:window onkeydown={onKey} />

{#if dialog.open}
	{@const open = dialog.open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={() => open.answer(false)}></div>
	<div class="box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
		<h2 id="confirm-title">{open.title}</h2>
		{#if open.message}<p class="muted">{open.message}</p>{/if}
		{#if open.input}
			<input
				type="text"
				maxlength="40"
				placeholder={open.input.placeholder}
				bind:this={inputEl}
				bind:value={open.input.value}
				onkeydown={(e) => e.key === 'Enter' && open.answer(true)}
			/>
		{/if}
		<div class="buttons">
			<button type="button" class="btn" onclick={() => open.answer(false)}>{open.cancelLabel ?? 'Cancel'}</button>
			<button
				type="button"
				class="btn btn-primary"
				bind:this={confirmButton}
				onclick={() => open.answer(true)}
			>
				{open.confirmLabel ?? 'OK'}
			</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgb(0 0 0 / 50%);
		animation: fade 0.12s ease;
	}

	.box {
		position: fixed;
		z-index: 1001;
		left: 50%;
		top: 30%;
		translate: -50% 0;
		width: min(420px, calc(100vw - 32px));
		padding: 20px 22px 18px;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow), 0 20px 50px -20px rgb(0 0 0 / 60%);
		animation: rise 0.14s ease;
	}

	h2 {
		font-size: 1.15rem;
		margin: 0 0 6px;
		overflow-wrap: anywhere;
	}

	p {
		margin: 0;
		font-size: 0.9rem;
	}

	input {
		width: 100%;
		margin-top: 8px;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			translate: -50% 8px;
		}
	}
</style>
