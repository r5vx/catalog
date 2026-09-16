<script lang="ts">
	/**
	 * A quiet line while runtimes and scores are being fetched.
	 *
	 * It runs by itself after the app opens, which is right — but invisible
	 * work looks like nothing happening, and "Longest" being empty for the
	 * first minute looks like a bug. So it says so, on the page you're already
	 * looking at, and disappears when it's done.
	 */
	type State = {
		status: 'idle' | 'working' | 'done' | 'failed';
		done: number;
		total: number;
		label: string;
	};

	let fill = $state<State>({ status: 'idle', done: 0, total: 0, label: '' });
	let finishedJustNow = $state(false);

	const percent = $derived(fill.total > 0 ? Math.round((fill.done / fill.total) * 100) : 0);

	async function read() {
		try {
			const response = await fetch('/api/backfill');
			if (!response.ok) return false;

			const was = fill.status;
			fill = (await response.json()).state;

			// Worth a moment of "done" rather than vanishing mid-sentence.
			if (was === 'working' && fill.status === 'done') {
				finishedJustNow = true;
				setTimeout(() => (finishedJustNow = false), 6000);
			}

			return fill.status === 'working';
		} catch {
			return false;
		}
	}

	$effect(() => {
		let stop = false;

		(async () => {
			// It starts a few seconds after the app does, so keep looking for a
			// while before concluding there's nothing to watch.
			const until = Date.now() + 30_000;

			while (!stop && Date.now() < until) {
				if (await read()) break;
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}

			while (!stop && fill.status === 'working') {
				await new Promise((resolve) => setTimeout(resolve, 1200));
				await read();
			}
		})();

		return () => {
			stop = true;
		};
	});
</script>

{#if fill.status === 'working'}
	<div class="filling" role="status" aria-live="polite">
		<div class="bar"><div class="fill" style="width: {Math.max(3, percent)}%"></div></div>
		<p>
			<span class="faint">Filling in runtimes and scores</span>
			<span class="faint tabular">{fill.done} of {fill.total}</span>
		</p>
	</div>
{:else if finishedJustNow}
	<p class="done faint" role="status">Runtimes and scores are up to date.</p>
{/if}

<style>
	.filling {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 16px;
	}

	.bar {
		width: 100%;
		height: 3px;
		background: var(--sunk);
		border-radius: 100px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 100px;
		transition: width 0.6s ease;
	}

	.filling p {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin: 0;
		font-size: 0.78rem;
	}

	.done {
		font-size: 0.78rem;
		margin: 0 0 16px;
	}
</style>
