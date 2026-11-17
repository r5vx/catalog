/*
 * Holding Ctrl while the code's wording is on shows the usual words until it's let go (owner,
 * 2026-11-16: "if the user is struggling to understand what some piece of text says").
 *
 * `peek.held` is read by p()/wording()/pHint() in altText.ts, so every line a page words itself
 * redraws, and altSwap.ts puts back the lines it swapped on screen. Ctrl has to be held on its own
 * for a moment, so Ctrl+C, Ctrl+F and the like don't flash the page.
 */
export const peek = $state({ held: false });

const WAIT = 250;

/** Listens for Ctrl on the window. Returns the undo (for onMount). */
export function listenForPeek(): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const let_go = () => {
		cancel();
		if (peek.held) peek.held = false;
	};
	const down = (e: KeyboardEvent) => {
		if (e.key === 'Control') {
			if (!e.repeat && !peek.held && !timer) timer = setTimeout(() => ((timer = null), (peek.held = true)), WAIT);
			return;
		}
		// Another key with it: a shortcut, not a look.
		let_go();
	};
	const up = (e: KeyboardEvent) => {
		if (e.key === 'Control' || !e.ctrlKey) let_go();
	};
	window.addEventListener('keydown', down, true);
	window.addEventListener('keyup', up, true);
	window.addEventListener('blur', let_go);
	window.addEventListener('pointerdown', let_go, true);
	return () => {
		let_go();
		window.removeEventListener('keydown', down, true);
		window.removeEventListener('keyup', up, true);
		window.removeEventListener('blur', let_go);
		window.removeEventListener('pointerdown', let_go, true);
	};
}
