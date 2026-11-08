/**
 * The Code box on Settings → Personalization stays hidden until Personalization in Settings' list
 * is pressed 7 times in a row (each press within 1.5 s of the last). Once shown it stays while
 * Catalog is open; it's always shown while a code is on, so it can be turned off.
 */
export const codeBox = $state({ shown: false });

const PRESSES = 7;
const GAP = 1500;
let presses = 0;
let last = 0;

/** A press on a Settings section: Personalization counts toward the 7, anything else starts over. */
export function pressedSection(href: string) {
	const now = Date.now();
	if (href !== '/settings/personalization') {
		presses = 0;
		return;
	}
	presses = now - last <= GAP ? presses + 1 : 1;
	last = now;
	if (presses >= PRESSES) codeBox.shown = true;
}
