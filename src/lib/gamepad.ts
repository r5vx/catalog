/**
 * An Xbox, PlayStation or other game controller on the computer: it drives Catalog the way the
 * Fire TV's remote does (src/lib/tv.ts and src/lib/tvNav.ts), with one thing highlighted at a
 * time.
 *
 *  - D-pad or left stick: move the highlight (in the player with nothing highlighted: left and
 *    right skip 10 s, up and down bring up the controls)
 *  - A / Cross: press what's highlighted (in the player: play or pause)
 *  - B / Circle: back (closes an open menu first)
 *  - X / Square: the highlighted card's options (its "⋯" menu)
 *  - Y / Triangle: full screen in the player
 *  - LB / RB (L1 / R1): back or ahead 10 s; LT / RT (L2 / R2): 30 s
 *  - Start / Options: play or pause
 *
 * The browser only tells a page about a controller once a button on it has been pressed. The
 * mouse or keyboard takes over again as soon as it's used (the highlight's outline goes).
 */
import { browser } from '$app/environment';
import { startRemoteKeys, tvPlayer } from './tv';

/** Standard button numbers (Chromium maps Xbox, PlayStation and most others to these). */
const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const STICK = 0.5;
/** Holding a direction: the first repeat after this long, then one every REPEAT_EVERY. */
const REPEAT_AFTER = 400;
const REPEAT_EVERY = 130;

let active = false;
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;
const held = new Map<string, number>(); // what's held → when it next repeats (0: no repeat)

/** True while the controller is what's being used (the player then acts as on a TV). */
export function padActive(): boolean {
	return active;
}

function key(name: string) {
	const target = (document.activeElement as HTMLElement | null) ?? document.body;
	target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
	target.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
}

const inPlayer = () => Boolean(document.querySelector('[data-tv-player]'));
const remote = () =>
	(window as unknown as { __catalogTv?: { back: () => string; menu: () => void } }).__catalogTv;

function press(name: string) {
	switch (name) {
		case 'up':
		case 'down':
		case 'left':
		case 'right':
			key(`Arrow${name[0].toUpperCase()}${name.slice(1)}`);
			break;
		case 'a': {
			// Enter is what the remote's OK sends: the player and the TV screens act on it, and a
			// highlighted link or button is pressed by it too.
			// (A made-up Enter doesn't press anything by itself, so the highlighted thing is clicked;
			// in the player the Enter first keeps its controls up.)
			const focused = document.activeElement as HTMLElement | null;
			const onSomething = focused && focused !== document.body && focused.tagName !== 'VIDEO' && !focused.classList.contains('click-layer');
			if (onSomething) {
				if (inPlayer()) key('Enter');
				focused.click();
			} else key('Enter');
			break;
		}
		case 'b': {
			const answer = remote()?.back() ?? 'default';
			if (answer !== 'default') break;
			if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
			else history.back();
			break;
		}
		case 'x':
			remote()?.menu();
			break;
		case 'y':
			if (inPlayer()) key('f');
			break;
		case 'lb':
			tvPlayer.seek?.(-10);
			break;
		case 'rb':
			tvPlayer.seek?.(10);
			break;
		case 'lt':
			tvPlayer.seek?.(-30);
			break;
		case 'rt':
			tvPlayer.seek?.(30);
			break;
		case 'start':
			tvPlayer.playPause?.();
			break;
	}
}

function use() {
	if (!active) {
		active = true;
		document.documentElement.classList.add('pad');
	}
}

function poll() {
	const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
	if (!pad) return;
	const down = (i: number) => Boolean(pad.buttons[i]?.pressed);
	const [sx = 0, sy = 0] = pad.axes;
	const now: Record<string, boolean> = {
		up: down(BUTTON.UP) || sy < -STICK,
		down: down(BUTTON.DOWN) || sy > STICK,
		left: down(BUTTON.LEFT) || sx < -STICK,
		right: down(BUTTON.RIGHT) || sx > STICK,
		a: down(BUTTON.A),
		b: down(BUTTON.B),
		x: down(BUTTON.X),
		y: down(BUTTON.Y),
		lb: down(BUTTON.LB),
		rb: down(BUTTON.RB),
		lt: down(BUTTON.LT),
		rt: down(BUTTON.RT),
		start: down(BUTTON.START)
	};
	const t = performance.now();
	for (const [name, isDown] of Object.entries(now)) {
		if (!isDown) {
			held.delete(name);
			continue;
		}
		const repeats = name === 'up' || name === 'down' || name === 'left' || name === 'right';
		const next = held.get(name);
		if (next === undefined) {
			use();
			press(name);
			held.set(name, repeats ? t + REPEAT_AFTER : 0);
		} else if (repeats && next && t >= next) {
			press(name);
			held.set(name, t + REPEAT_EVERY);
		}
	}
}

/** The mouse or keyboard is back: the controller's highlight outline goes. */
function handBack(event: Event) {
	if (!event.isTrusted || !active) return;
	active = false;
	document.documentElement.classList.remove('pad');
}

export function startGamepad(): void {
	if (!browser || started || !('getGamepads' in navigator)) return;
	started = true;
	window.addEventListener('gamepadconnected', () => {
		startRemoteKeys();
		// Checked 60 times a second while a controller is connected (a browser only reports one
		// to the window in front, so nothing happens in the background).
		if (!timer) timer = setInterval(poll, 16);
	});
	window.addEventListener('gamepaddisconnected', () => {
		if ([...navigator.getGamepads()].some((p) => p && p.connected)) return;
		clearInterval(timer);
		timer = undefined;
		held.clear();
	});
	window.addEventListener('mousedown', handBack, true);
	window.addEventListener('keydown', handBack, true);
}
