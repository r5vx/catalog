/**
 * Catalog on a TV, driven by a remote.
 *
 * The Fire TV app (android/) opens Catalog with "CatalogTV" in its user agent. Then:
 *  - the page gets the class "tv" on <html> (bigger focus outlines, see app.css),
 *  - the arrow keys move the highlight to the nearest thing in that direction,
 *  - the remote's menu button opens the "⋯" options of whatever is highlighted,
 *  - play/pause and fast-forward/rewind reach the player through `window.__catalogTv`.
 *
 * The player itself (routes/watch) handles the arrows while a video is showing and
 * nothing in its controls is highlighted: left and right skip, up and down bring the
 * controls up.
 */
import { browser } from '$app/environment';
import { tvBack } from './tvNav';

/** On the TV app. (Or, to try it on a computer: localStorage "catalog:tv" set to "1".) */
export function isTv(): boolean {
	if (!browser) return false;
	if (/CatalogTV\//.test(navigator.userAgent)) return true;
	try {
		return localStorage.getItem('catalog:tv') === '1';
	} catch {
		return false;
	}
}

/** What the player registers while it's on screen. */
export const tvPlayer: {
	playPause?: () => void;
	seek?: (seconds: number) => void;
	/** Fast-forward (1) or rewind (-1): scans until stopped. */
	scan?: (direction: number) => void;
	/** Stops a scan where it got to. False if there wasn't one. */
	stopScan?: () => boolean;
	/** Closes a menu open in the player (settings, subtitles, sources…). False if none was. */
	closeMenu?: () => boolean;
} = {};

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
	const box = el.getBoundingClientRect();
	if (box.width < 2 || box.height < 2) return false;
	const style = getComputedStyle(el);
	return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * Everything the highlight can land on. Not the "⋯" buttons, nor small buttons tucked inside
 * a card (its × or +): the remote's menu button opens those options instead.
 */
function candidates(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) =>
			!el.classList.contains('more') &&
			!el.parentElement?.closest('a[href]') &&
			!el.closest('[inert], [aria-hidden="true"]') &&
			visible(el)
	);
}

type Direction = 'up' | 'down' | 'left' | 'right';

/** The nearest candidate in that direction; things in line count for more than things off to the side. */
function nearest(from: HTMLElement, direction: Direction): HTMLElement | null {
	// A row can say where up goes from it (`data-tv-up="<selector>"`): the player's buttons go
	// straight to the progress bar, past the Skip Intro button sitting above it. Choices split by
	// " || " are tried in order: from the progress bar, Skip Intro / Next Episode if showing, else
	// the top bar.
	const upTo = direction === 'up' ? from.closest<HTMLElement>('[data-tv-up]')?.dataset.tvUp : undefined;
	if (!upTo) return nearestOf(from, direction);
	for (const choice of upTo.split('||')) {
		const found = nearestOf(from, direction, choice.trim());
		if (found) return found;
	}
	return null;
}

function nearestOf(from: HTMLElement, direction: Direction, upTo?: string): HTMLElement | null {
	const a = from.getBoundingClientRect();
	const ax = a.left + a.width / 2;
	const ay = a.top + a.height / 2;
	let best: HTMLElement | null = null;
	let bestScore = Infinity;

	for (const el of candidates()) {
		if (el === from || el.contains(from) || from.contains(el)) continue;
		if (upTo && !el.matches(upTo)) continue;
		const b = el.getBoundingClientRect();
		const bx = b.left + b.width / 2;
		const by = b.top + b.height / 2;

		let along: number;
		let across: number;
		let inLine: boolean;
		if (direction === 'right' || direction === 'left') {
			along = direction === 'right' ? b.left - a.right : a.left - b.right;
			if ((direction === 'right' ? bx - ax : ax - bx) <= 2) continue;
			across = Math.abs(by - ay);
			inLine = b.bottom > a.top + 4 && b.top < a.bottom - 4;
			// Left and right stay on the same row: at the end of one, they stop.
			if (!inLine) continue;
		} else {
			along = direction === 'down' ? b.top - a.bottom : a.top - b.bottom;
			if ((direction === 'down' ? by - ay : ay - by) <= 2) continue;
			across = Math.abs(bx - ax);
			inLine = b.right > a.left + 4 && b.left < a.right - 4;
		}
		const score = Math.max(0, along) + across * (inLine ? 0.3 : 2.5);
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	return best;
}

function focusOn(el: HTMLElement) {
	el.focus({ preventScroll: true });
	el.scrollIntoView({ block: 'center', inline: 'nearest' });
}

/** The first thing on screen, top-left first. */
function first(): HTMLElement | null {
	const onScreen = candidates().filter((el) => {
		const box = el.getBoundingClientRect();
		return box.bottom > 0 && box.top < window.innerHeight;
	});
	onScreen.sort((x, y) => {
		const a = x.getBoundingClientRect();
		const b = y.getBoundingClientRect();
		return a.top - b.top || a.left - b.left;
	});
	return onScreen[0] ?? candidates()[0] ?? null;
}

const DIRECTIONS: Record<string, Direction> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right'
};

function onKey(event: KeyboardEvent) {
	// The remote's OK is Enter, which doesn't tick a checkbox the way it presses a button.
	const focused = document.activeElement;
	if (event.key === 'Enter' && focused instanceof HTMLInputElement && (focused.type === 'checkbox' || focused.type === 'radio')) {
		event.preventDefault();
		focused.click();
		return;
	}
	const direction = DIRECTIONS[event.key];
	if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
	// The TV screens (src/routes/tv) move the highlight their own way (src/lib/tvNav.ts).
	if (document.querySelector('[data-tv-app]')) return;

	const current = document.activeElement as HTMLElement | null;
	const nothingFocused = !current || current === document.body || current.tagName === 'VIDEO';

	// The player handles the arrows itself while nothing in it is highlighted.
	if (nothingFocused && document.querySelector('[data-tv-player]')) return;

	// Typing: left and right move the cursor in the text.
	if (current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement) {
		if (direction === 'left' || direction === 'right') {
			const caret = current.selectionStart ?? 0;
			const atEdge = direction === 'left' ? caret === 0 : caret === current.value.length;
			if (!atEdge) return;
		}
	}

	const target = nothingFocused ? first() : nearest(current!, direction);
	if (target) {
		event.preventDefault();
		focusOn(target);
	}
}

/** The menu button: the "⋯" of the highlighted card or row, or a right-click on it. */
function openMenu() {
	// The TV layout has its own (src/lib/tv/TvMenu.svelte).
	if (document.querySelector('[data-tv-app]')) {
		window.dispatchEvent(new Event('catalog:tv-menu'));
		return;
	}
	const current = document.activeElement as HTMLElement | null;
	if (!current || current === document.body) return;
	const holder = current.closest('.has-more');
	const more = holder?.querySelector<HTMLButtonElement>('button.more');
	if (more) {
		more.click();
	} else {
		const box = current.getBoundingClientRect();
		current.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.top + 20 })
		);
	}
	// Highlight the menu's first option once it's open.
	setTimeout(() => {
		const option = document.querySelector<HTMLElement>('.ctx-menu button, .ctx-menu a, .ep-ctx-menu button');
		option?.focus();
	}, 50);
}

export function startTv(): void {
	if (!isTv()) return;
	document.documentElement.classList.add('tv');
	window.addEventListener('keydown', onKey);
	(window as unknown as { __catalogTv: unknown }).__catalogTv = {
		playPause: () => tvPlayer.playPause?.(),
		seek: (seconds: number) => tvPlayer.seek?.(seconds),
		scan: (direction: number) => tvPlayer.scan?.(direction),
		menu: openMenu,
		// The remote's Back (TV app 1.2 and later asks first): "handled", "exit", or "default"
		// for going back a page as usual.
		// (In the player, an open menu closes first: Back used to leave the episode.)
		back: (): string => (tvPlayer.stopScan?.() || tvPlayer.closeMenu?.() ? 'handled' : tvBack())
	};
}
