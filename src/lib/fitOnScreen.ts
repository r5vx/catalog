/**
 * Keeps a menu inside the window: `<div class="ctx-menu" use:fitOnScreen ...>`. A menu opens where
 * it was clicked, and on a phone a ⋯ near the right edge put most of it off the screen, out of
 * reach (owner, 2026-11-15). It's moved back in after it's drawn (and again when it's moved to
 * another spot while open); one taller than the window scrolls.
 */
export function fitOnScreen(node: HTMLElement) {
	const EDGE = 8;
	const place = () => {
		node.style.translate = '';
		node.style.maxHeight = `${window.innerHeight - EDGE * 2}px`;
		node.style.overflowY = 'auto';
		const box = node.getBoundingClientRect();
		let dx = 0;
		let dy = 0;
		if (box.right > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - box.right;
		if (box.left + dx < EDGE) dx = EDGE - box.left;
		if (box.bottom > window.innerHeight - EDGE) dy = window.innerHeight - EDGE - box.bottom;
		if (box.top + dy < EDGE) dy = EDGE - box.top;
		if (dx || dy) node.style.translate = `${dx}px ${dy}px`;
	};
	place();
	// (Moved to another spot while open: its left/top change. Its own changes above leave them be.)
	let last = `${node.style.left}|${node.style.top}`;
	const moved = new MutationObserver(() => {
		const now = `${node.style.left}|${node.style.top}`;
		if (now !== last) {
			last = now;
			place();
		}
	});
	moved.observe(node, { attributes: true, attributeFilter: ['style'] });
	return {
		destroy() {
			moved.disconnect();
		}
	};
}
