/*
 * The code's other wording (Settings → Personalization), on every line of every page.
 *
 * Most lines only had it where a page asked for it (`t()` / `p()` from altText.ts), so the
 * library's tabs, menus and most buttons kept their usual words (owner, 2026-11-16: "it should
 * change more and more text... It should change 'movies' and the other tabs"). While the code is
 * on, this looks at every line on screen, and at every line drawn or changed after: a line that is
 * exactly one with another wording (the table in altText.ts) shows that instead. Only whole lines,
 * so a film's title or a note is left as it is unless it's word for word one of the app's lines.
 *
 * Turned on and off by the root layout. The scramble (WordScramble.svelte) pauses it while it
 * plays, so the two don't fight over the same lines.
 */
import { swapFor } from '$lib/altText';

/**
 * Never touched: typing, the notes editor, code, and anything marked `data-plain`; and what people
 * wrote or said (subtitles, chat, notes), where a "No" is somebody's line, not a button.
 */
const LEAVE_ALONE = 'script, style, textarea, input, [contenteditable], [data-plain], code, pre, .subtitle-display';
/** Longer than this is somebody's writing, not a button. */
const LONGEST = 160;

/** What each line was before it was swapped, and what it was swapped to. */
const written = new WeakMap<Text, { from: string; to: string }>();
/** The lines swapped while it's on, to put back when it's turned off. */
const swapped = new Set<Text>();

let observer: MutationObserver | null = null;
let paused = false;

function swapLine(node: Text): void {
	const raw = node.nodeValue ?? '';
	// Its own doing: already swapped.
	if (written.get(node)?.to === raw) return;
	const text = raw.trim();
	if (!text || text.length > LONGEST) return;
	const other = swapFor(true, text);
	if (!other || other === text) return;
	const el = node.parentElement;
	if (!el || el.closest(LEAVE_ALONE)) return;
	const at = raw.indexOf(text);
	const to = raw.slice(0, at) + other + raw.slice(at + text.length);
	written.set(node, { from: raw, to });
	// (Lines of pages left long ago aren't kept hold of.)
	if (swapped.size > 4000) for (const old of swapped) if (!old.isConnected) swapped.delete(old);
	swapped.add(node);
	node.nodeValue = to;
}

function swapAll(root: Node): void {
	if (root.nodeType === Node.TEXT_NODE) return swapLine(root as Text);
	if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) swapLine(node as Text);
}

/** The code was turned on (or a page opened with it on). */
export function startSwaps(): void {
	if (observer || typeof document === 'undefined') return;
	observer = new MutationObserver((records) => {
		if (paused) return;
		for (const record of records) {
			if (record.type === 'characterData') swapLine(record.target as Text);
			else record.addedNodes.forEach(swapAll);
		}
	});
	observer.observe(document.body, { childList: true, characterData: true, subtree: true });
	if (!paused) swapAll(document.body);
}

/** The code was turned off: every line it swapped, and nobody has changed since, gets its words back. */
export function stopSwaps(): void {
	observer?.disconnect();
	observer = null;
	for (const node of swapped) {
		const was = written.get(node);
		if (was && node.isConnected && node.nodeValue === was.to) node.nodeValue = was.from;
	}
	swapped.clear();
}

/** The scramble is playing (true) or has finished (false). */
export function pauseSwaps(on: boolean): void {
	paused = on;
	if (!on && observer) swapAll(document.body);
}

/** Ctrl held (altPeek.svelte.ts): the swapped lines show their usual words until it's let go. */
export function peekSwaps(on: boolean): void {
	if (!observer) return;
	if (on) {
		paused = true;
		for (const node of swapped) {
			const was = written.get(node);
			if (was && node.isConnected && node.nodeValue === was.to) node.nodeValue = was.from;
		}
	} else pauseSwaps(false);
}

/** Whether this line was ever swapped here (the scramble leaves those to this). */
export const swappedHere = (node: Text): boolean => written.has(node);
