/**
 * Svelte action that calls `onMore` when a sentinel element approaches the viewport.
 * Replaces manual "Show more" buttons with automatic scroll-to-load.
 */
export function onReachBottom(node: HTMLElement, onMore: () => void) {
	let callback = onMore;
	if (typeof IntersectionObserver === 'undefined') return {};
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((e) => e.isIntersecting)) callback();
		},
		{ rootMargin: '1600px 0px' }
	);
	observer.observe(node);
	return {
		update(next: () => void) {
			callback = next;
		},
		destroy() {
			observer.disconnect();
		}
	};
}
