<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { swapFor } from '$lib/altText';
	import { pauseSwaps, swappedHere } from '$lib/altSwap';

	/**
	 * Played when the code in Settings → Personalization is turned on or off (owner, 2026-11-16:
	 * "scramble"). Every line on screen that has another wording jumbles its letters, then settles
	 * into the new wording one letter at a time, left to right. No pictures: just the words.
	 * Then `refresh` fetches the page's data again (so everything off screen follows) and `done` runs.
	 * Skipped for people who've asked their computer for less motion.
	 *
	 * To change how it feels: SCRAMBLE_MS (how long letters stay jumbled), SETTLE_MS (how long the
	 * letters take to fall into place), SPREAD_MS (top lines start this much before the bottom ones),
	 * and GLYPHS (what the jumbled letters are made of).
	 */
	let { turningOn, refresh, done }: { turningOn: boolean; refresh: () => Promise<unknown>; done: () => void } = $props();

	const SCRAMBLE_MS = 260;
	const SETTLE_MS = 420;
	const SPREAD_MS = 240;
	const TICK_MS = 40;
	const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+?!';

	type Line = { node: Text; from: string; to: string; start: number };

	/** Every visible line that has another wording. */
	function findLines(): Line[] {
		const lines: Line[] = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		const height = window.innerHeight;
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			const el = node.parentElement;
			if (!el || el.closest('script, style, textarea, [contenteditable]')) continue;
			const raw = node.nodeValue ?? '';
			const text = raw.trim();
			if (!text) continue;
			const other = swapFor(turningOn, text);
			if (!other) continue;
			range.selectNodeContents(node);
			const box = range.getBoundingClientRect();
			if (!box.width || box.bottom < 0 || box.top > height) continue;
			const at = raw.indexOf(text);
			lines.push({
				node,
				from: raw,
				to: raw.slice(0, at) + other + raw.slice(at + text.length),
				// Top of the screen first, so it reads as a wave down the page.
				start: (Math.max(0, box.top) / height) * SPREAD_MS
			});
		}
		return lines;
	}

	const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

	/** A line `elapsed` ms into its turn: settled letters of the new wording, then jumble. */
	function frame(line: Line, elapsed: number): string {
		const { from, to } = line;
		if (elapsed <= 0) return from;
		if (elapsed >= SCRAMBLE_MS + SETTLE_MS) return to;
		// The length eases from the old wording's to the new one's while it's jumbled.
		const grow = Math.min(1, elapsed / SCRAMBLE_MS);
		const length = Math.round(from.length + (to.length - from.length) * grow);
		const settled = elapsed < SCRAMBLE_MS ? 0 : Math.floor(((elapsed - SCRAMBLE_MS) / SETTLE_MS) * to.length);
		let out = '';
		for (let i = 0; i < length; i++) {
			const want = to[i] ?? '';
			if (i < settled) out += want;
			// Spaces stay spaces, so words keep their shape.
			else if (want === ' ' || (want === '' && from[i] === ' ')) out += ' ';
			else out += glyph();
		}
		return out;
	}

	onMount(() => {
		let stopped = false;
		let timer: ReturnType<typeof setInterval> | undefined;
		// The page-wide swapping (altSwap.ts) waits while the letters move.
		pauseSwaps(true);

		async function finish(lines: Line[]) {
			for (const line of lines) line.node.nodeValue = line.to;
			// The page's own data has the last word. A line it rewrites keeps the new wording; a line it
			// leaves alone never had another wording (the same words can be both), so it gets its old text back.
			const written = new Set<Node>();
			const watcher = new MutationObserver((records) => records.forEach((record) => written.add(record.target)));
			watcher.observe(document.body, { characterData: true, subtree: true });
			await refresh().catch(() => {});
			await tick();
			watcher.takeRecords().forEach((record) => written.add(record.target));
			watcher.disconnect();
			for (const line of lines) {
				// (Lines the page-wide swapping put in, altSwap.ts, are left to it to keep or put back.)
				if (!written.has(line.node) && !swappedHere(line.node) && line.node.nodeValue === line.to) line.node.nodeValue = line.from;
			}
			pauseSwaps(false);
			if (!stopped) done();
		}

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			void finish([]);
			return;
		}

		const lines = findLines();
		const began = Date.now();
		const total = SPREAD_MS + SCRAMBLE_MS + SETTLE_MS;
		// A timer rather than animation frames: a window that's hidden gets none of those.
		timer = setInterval(() => {
			const elapsed = Date.now() - began;
			for (const line of lines) line.node.nodeValue = frame(line, elapsed - line.start);
			if (elapsed >= total) {
				clearInterval(timer);
				void finish(lines);
			}
		}, TICK_MS);

		return () => {
			stopped = true;
			clearInterval(timer);
			pauseSwaps(false);
		};
	});
</script>
