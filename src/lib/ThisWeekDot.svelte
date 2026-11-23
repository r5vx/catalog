<script lang="ts">
	import { onMount } from 'svelte';
	import { calendarWeekStart } from '$lib/thisWeekSeen';

	let unseen = $state(false);
	onMount(() => {
		let timer: ReturnType<typeof setTimeout>;
		const update = () => {
			clearTimeout(timer);
			const now = new Date();
			try {
				const seen = Number(localStorage.getItem('catalog:thisWeekOpened'));
				unseen = !Number.isFinite(seen) || seen < calendarWeekStart(now);
			} catch {}
			const nextMonday = new Date(calendarWeekStart(now));
			nextMonday.setDate(nextMonday.getDate() + 7);
			timer = setTimeout(update, nextMonday.getTime() - now.getTime());
		};
		update();
		window.addEventListener('storage', update);
		window.addEventListener('catalog:thisWeekSeen', update);
		window.addEventListener('focus', update);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('storage', update);
			window.removeEventListener('catalog:thisWeekSeen', update);
			window.removeEventListener('focus', update);
		};
	});
</script>

{#if unseen}<span class="week-dot" role="img" aria-label="New releases on Home"></span>{/if}

<style>
	.week-dot { display: inline-block; flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-left: 3px; }
</style>
