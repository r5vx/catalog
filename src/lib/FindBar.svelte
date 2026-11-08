<script lang="ts">
	/**
	 * Find in a note (Ctrl+F, or the toolbar's magnifier): every match is highlighted, the
	 * current one stronger, with "3 of 12" and up/down. Enter goes to the next match, Shift+Enter
	 * the one before, Esc closes it.
	 *
	 * The highlights are drawn with the browser's CSS Highlight API, so nothing is added to the
	 * note's own text and nothing extra can ever be saved into it. Matches are found across bold,
	 * italic and other formatting inside a word. The colors are --find and --find-current in
	 * src/app.css.
	 */
	import { onDestroy } from 'svelte';

	type Props = {
		/** The element whose text is searched (the note's page). */
		root: HTMLElement | null;
		/** For the editor: called on close with the match that was current, to put the caret there. */
		onclose?: (current: Range | null) => void;
	};

	let { root, onclose }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let matches = $state<Range[]>([]);
	let current = $state(0);
	let input = $state<HTMLInputElement | null>(null);

	const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS;

	/** Opens the bar (or, if it's open, selects what's typed in it), like a browser's. */
	export function show() {
		open = true;
		// Text selected in the note becomes the search, as in Chrome.
		const picked = getSelection()?.toString() ?? '';
		if (picked && !picked.includes('\n') && picked.length <= 100 && root?.contains(getSelection()?.anchorNode ?? null)) {
			query = picked;
		}
		queueMicrotask(() => {
			input?.focus();
			input?.select();
			search(false);
		});
	}

	function close() {
		const last = matches[current] ?? null;
		open = false;
		clearHighlights();
		matches = [];
		onclose?.(last);
	}

	/** Every place the text appears, as ranges over the note's text nodes. */
	function findAll(text: string): Range[] {
		if (!root || !text) return [];
		const nodes: Text[] = [];
		const starts: number[] = [];
		let joined = '';
		let lastBlock: Element | null = null;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			// A line break between paragraphs, so the end of one line and the start of the next
			// never make a match together.
			const block = node.parentElement?.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th') ?? null;
			if (nodes.length && block !== lastBlock) joined += '\n';
			lastBlock = block;
			nodes.push(node as Text);
			starts.push(joined.length);
			joined += (node as Text).data;
		}
		const haystack = joined.toLocaleLowerCase();
		const needle = text.toLocaleLowerCase();
		const found: Range[] = [];

		// Which text node a position in the joined text falls in, and where in it.
		let n = 0;
		const locate = (at: number, isEnd: boolean) => {
			while (n < nodes.length - 1 && (isEnd ? starts[n + 1] < at : starts[n + 1] <= at)) n++;
			return { node: nodes[n], offset: at - starts[n] };
		};

		for (let at = haystack.indexOf(needle); at !== -1 && found.length < 1000; at = haystack.indexOf(needle, at + needle.length)) {
			const start = locate(at, false);
			const end = locate(at + needle.length, true);
			const range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			found.push(range);
		}
		return found;
	}

	function clearHighlights() {
		if (!canHighlight) return;
		CSS.highlights.delete('find');
		CSS.highlights.delete('find-current');
	}

	function draw() {
		clearHighlights();
		if (!canHighlight || matches.length === 0) return;
		CSS.highlights.set('find', new Highlight(...matches));
		CSS.highlights.set('find-current', new Highlight(matches[current]));
	}

	/** Brings the current match into the middle of the screen. */
	function reveal() {
		const range = matches[current];
		if (!range) return;
		const box = range.getBoundingClientRect();
		const top = 70;
		const bottom = window.innerHeight - 40;
		if (box.top < top || box.bottom > bottom) {
			window.scrollBy({ top: box.top - window.innerHeight / 2 });
		}
		// Without highlights (old browsers), the match is selected instead.
		if (!canHighlight) {
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range.cloneRange());
		}
	}

	/** Finds the text again; keepPlace stays near the match that was current (the note changed). */
	function search(keepPlace: boolean) {
		const was = keepPlace ? matches[current] : null;
		matches = findAll(query);
		if (was && matches.length) {
			const i = matches.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, was) >= 0);
			current = i === -1 ? matches.length - 1 : i;
		} else {
			current = 0;
		}
		draw();
		if (!keepPlace) reveal();
	}

	function step(by: number) {
		if (matches.length === 0) return;
		current = (current + by + matches.length) % matches.length;
		draw();
		reveal();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			show();
		} else if (open && event.key === 'Escape' && document.activeElement !== input) {
			close();
		}
	}

	// The note being typed in while the bar is open: the matches follow it.
	let watcher: MutationObserver | null = null;
	let pending: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (!open || !root) return;
		watcher = new MutationObserver(() => {
			clearTimeout(pending);
			pending = setTimeout(() => search(true), 150);
		});
		watcher.observe(root, { childList: true, subtree: true, characterData: true });
		return () => {
			watcher?.disconnect();
			clearTimeout(pending);
		};
	});

	onDestroy(clearHighlights);
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
	<div class="find" role="search">
		<input
			bind:this={input}
			bind:value={query}
			oninput={() => search(false)}
			onkeydown={onKey}
			placeholder="Find in note"
			aria-label="Find in note"
			spellcheck="false"
		/>
		<span class="count tabular" aria-live="polite">
			{#if query}{matches.length ? `${current + 1} of ${matches.length}` : 'None'}{/if}
		</span>
		<button type="button" title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!matches.length} onclick={() => step(-1)}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 10 8 5.5 12.5 10" /></svg>
		</button>
		<button type="button" title="Next (Enter)" aria-label="Next match" disabled={!matches.length} onclick={() => step(1)}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" /></svg>
		</button>
		<button type="button" title="Close (Esc)" aria-label="Close" onclick={close}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
		</button>
	</div>
{/if}

<style>
	/* Top right of the window, like a browser's find bar. */
	.find {
		position: fixed;
		top: 14px;
		right: 18px;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 5px 6px 5px 10px;
		background: var(--surface);
		border: 1px solid var(--rule-firm);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	input {
		width: 210px;
		border: none;
		background: none;
		padding: 4px 2px;
		color: var(--ink);
		font-size: 0.88rem;
	}

	input:focus {
		outline: none;
		box-shadow: none;
	}

	.count {
		min-width: 58px;
		font-size: 0.76rem;
		color: var(--ink-faint);
		text-align: right;
		padding-right: 6px;
	}

	button {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: 3px;
		color: var(--ink-soft);
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--ink);
	}

	button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	svg path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (max-width: 600px) {
		.find {
			left: 12px;
			right: 12px;
			top: 10px;
		}

		input {
			flex: 1;
			width: auto;
			min-width: 0;
		}
	}
</style>
