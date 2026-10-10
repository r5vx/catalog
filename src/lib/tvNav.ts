/**
 * The remote on Catalog's TV screens (src/routes/tv), the way Netflix and Hulu work on a TV:
 * one thing is highlighted at a time, and the arrows move the highlight.
 *
 *  - The menu down the left ([data-tv-nav]): up and down move through it, right goes back to
 *    the screen.
 *  - The screen is made of rows ([data-tv-row]): left and right move along a row, up and down go
 *    to the row above or below — back to where you were in it, if you've been there. Left from
 *    the start of a row opens the menu.
 *  - A grid ([data-tv-row][data-tv-grid]): the arrows move by position inside it (the keyboard,
 *    a page of posters); leaving its edge goes to the next thing over in that direction.
 *  - Things you can pick are [data-tv-item] links and buttons; OK presses them.
 *  - Rows inside a sliding track ([data-tv-track]) slide up so the highlighted row sits at the
 *    top of the track (the banner above stays put); anything else scrolls into view.
 *
 * The rest of the app keeps its own simpler remote handling (src/lib/tv.ts), which stands
 * aside while a TV screen ([data-tv-app]) is showing.
 */

type Direction = 'up' | 'down' | 'left' | 'right';
const DIRECTIONS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Where you were in each row, so coming back to it lands there. */
const remembered = new WeakMap<Element, number>();
/** The last thing highlighted on the screen (not the menu), for coming back from the menu. */
let lastInMain: HTMLElement | null = null;

const items = (scope: Element) =>
	[...scope.querySelectorAll<HTMLElement>('[data-tv-item]')].filter((el) => {
		if (el.closest('[inert]')) return false;
		const box = el.getBoundingClientRect();
		return box.width > 1 && box.height > 1;
	});

const rows = (app: Element) =>
	[...app.querySelectorAll<HTMLElement>('[data-tv-main] [data-tv-row]')].filter((row) => items(row).length > 0);

const center = (el: Element) => {
	const box = el.getBoundingClientRect();
	return { x: box.left + box.width / 2, y: box.top + box.height / 2, box };
};

/** Inside a grid (or between grids side by side): the nearest item that way, by position. */
function byPosition(from: HTMLElement, pool: HTMLElement[], direction: Direction): HTMLElement | null {
	const a = center(from);
	let best: HTMLElement | null = null;
	let bestScore = Infinity;
	for (const el of pool) {
		if (el === from) continue;
		const b = center(el);
		const along =
			direction === 'right' ? b.x - a.x : direction === 'left' ? a.x - b.x : direction === 'down' ? b.y - a.y : a.y - b.y;
		if (along <= 4) continue;
		const across = direction === 'left' || direction === 'right' ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
		// Things in line first: a key on the same row of the keyboard beats a closer one below.
		const inLine =
			direction === 'left' || direction === 'right'
				? b.box.bottom > a.box.top + 2 && b.box.top < a.box.bottom - 2
				: b.box.right > a.box.left + 2 && b.box.left < a.box.right - 2;
		const score = along + across * (inLine ? 0.2 : 4) + (inLine ? 0 : 10000);
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	return best;
}

/** The row above or below this one: the nearest whose top is past it that way. */
function nextRow(app: Element, row: HTMLElement, direction: 'up' | 'down'): HTMLElement | null {
	const all = rows(app);
	const here = all.indexOf(row);
	const step = direction === 'down' ? 1 : -1;
	// Rows stacked in the page's order: the next one that isn't beside this one.
	const box = row.getBoundingClientRect();
	for (let i = here + step; i >= 0 && i < all.length; i += step) {
		const other = all[i].getBoundingClientRect();
		const beside = other.top < box.bottom - 2 && other.bottom > box.top + 2;
		if (!beside) return all[i];
	}
	return null;
}

/** Into a row: where you were in it before, else the item nearest across from `from`. */
function landIn(row: HTMLElement, from: HTMLElement | null): HTMLElement | null {
	const list = items(row);
	if (!list.length) return null;
	const before = remembered.get(row);
	if (before !== undefined && !row.hasAttribute('data-tv-grid')) return list[Math.min(before, list.length - 1)];
	if (!from) return list[0];
	const x = center(from).x;
	// In a grid, only its first line (going down) or last line (going up) is near.
	let best = list[0];
	let bestDistance = Infinity;
	for (const el of list) {
		const distance = Math.abs(center(el).x - x) + Math.abs(center(el).y - center(from).y) * 0.01;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = el;
		}
	}
	return best;
}

function slideTo(el: HTMLElement) {
	const row = el.closest<HTMLElement>('[data-tv-row]');
	const track = el.closest<HTMLElement>('[data-tv-track]');
	if (row && track) {
		// The highlighted row goes to the top of the track; the banner above doesn't move.
		const firstRow = track.querySelector<HTMLElement>('[data-tv-row]');
		const offset = row.offsetTop - (firstRow?.offsetTop ?? 0);
		track.style.transform = `translateY(${-offset}px)`;
	}
	// Along a row: keep the highlighted card in view, with a little of the next one showing.
	const strip = el.closest<HTMLElement>('[data-tv-strip]');
	if (strip) {
		const left = el.offsetLeft - strip.clientWidth * 0.06;
		const right = el.offsetLeft + el.offsetWidth - strip.clientWidth * 0.86;
		if (strip.scrollLeft > left) strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
		else if (strip.scrollLeft < right) strip.scrollTo({ left: right, behavior: 'smooth' });
	} else if (!track) {
		el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	}
}

/** Highlights something on a TV screen. It's also marked with a class, for drawing the highlight. */
export function tvFocus(el: HTMLElement | null) {
	if (!el) return;
	document.querySelectorAll('.tv-focused').forEach((other) => other.classList.remove('tv-focused'));
	el.classList.add('tv-focused');
	el.focus({ preventScroll: true });
	const app = el.closest('[data-tv-app]');
	if (el.closest('[data-tv-nav]')) {
		app?.classList.add('nav-open');
	} else {
		app?.classList.remove('nav-open');
		lastInMain = el;
		const row = el.closest<HTMLElement>('[data-tv-row]');
		if (row) remembered.set(row, items(row).indexOf(el));
		slideTo(el);
	}
}

function openNav(app: Element) {
	const nav = app.querySelector('[data-tv-nav]');
	if (!nav) return;
	const here = nav.querySelector<HTMLElement>('[data-tv-item][aria-current="page"]') ?? items(nav)[0];
	tvFocus(here ?? null);
}

function move(app: HTMLElement, direction: Direction): boolean {
	const current = document.activeElement as HTMLElement | null;
	const inApp = current && app.contains(current) && current.hasAttribute('data-tv-item');
	if (!inApp) {
		tvFocus(lastInMain && app.contains(lastInMain) ? lastInMain : firstItem(app));
		return true;
	}

	// The menu.
	const nav = current.closest('[data-tv-nav]');
	if (nav) {
		if (direction === 'right') {
			tvFocus(lastInMain && app.contains(lastInMain) ? lastInMain : firstItem(app));
		} else if (direction === 'up' || direction === 'down') {
			const list = items(nav);
			const at = list.indexOf(current);
			const next = list[at + (direction === 'down' ? 1 : -1)];
			if (next) tvFocus(next);
		}
		return true;
	}

	const row = current.closest<HTMLElement>('[data-tv-row]');
	if (!row) return false;
	const list = items(row);
	const grid = row.hasAttribute('data-tv-grid');

	// Inside the row (or grid).
	let target: HTMLElement | null = null;
	if (grid) {
		target = byPosition(current, list, direction);
	} else if (direction === 'left' || direction === 'right') {
		target = list[list.indexOf(current) + (direction === 'right' ? 1 : -1)] ?? null;
	}
	if (target) {
		tvFocus(target);
		return true;
	}

	// Out of it.
	if (direction === 'up' || direction === 'down') {
		const other = nextRow(app, row, direction);
		if (other) tvFocus(landIn(other, current));
		return true;
	}
	// Sideways out of a grid: whatever is beside it (the keyboard and its results).
	const beside = byPosition(
		current,
		rows(app)
			.filter((r) => r !== row)
			.flatMap(items),
		direction
	);
	if (beside) {
		const besideRow = beside.closest<HTMLElement>('[data-tv-row]');
		tvFocus(besideRow ? landIn(besideRow, current) : beside);
		return true;
	}
	if (direction === 'left') openNav(app);
	return true;
}

/** Where a screen starts: what it marks [data-tv-autofocus], else the first thing on it. */
function firstItem(app: Element): HTMLElement | null {
	const main = app.querySelector('[data-tv-main]') ?? app;
	return main.querySelector<HTMLElement>('[data-tv-autofocus]') ?? items(main)[0] ?? null;
}

function onKey(event: KeyboardEvent) {
	const app = document.querySelector<HTMLElement>('[data-tv-app]');
	if (!app || event.altKey || event.ctrlKey || event.metaKey) return;
	const direction = DIRECTIONS[event.key];
	if (direction) {
		if (move(app, direction)) event.preventDefault();
		return;
	}
	// Trying the TV screens on a computer: Esc (or Backspace) is the remote's Back.
	if (event.key === 'Escape' || event.key === 'Backspace') {
		event.preventDefault();
		history.back();
		return;
	}
	if (event.key === 'Enter') {
		const current = document.activeElement as HTMLElement | null;
		if (current?.hasAttribute('data-tv-item') && current.tagName !== 'A' && current.tagName !== 'BUTTON') {
			event.preventDefault();
			current.click();
		}
	}
}

let started = false;

/** Turns the TV remote handling on (once), and highlights where a screen starts. */
export function startTvNav(app: HTMLElement | null) {
	if (!started) {
		started = true;
		window.addEventListener('keydown', onKey, true);
	}
	if (app) requestAnimationFrame(() => tvFocus(firstItem(app)));
}
