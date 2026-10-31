/**
 * The black credit roll at the end of an episode or film, seen in the preview pictures (white
 * names on black, picture after picture, to the end). Comparing episodes' sound can't find it
 * when each episode's roll has its own music: She-Hulk's differ, so only its animated credits
 * before the roll were found, and only in some episodes (2026-10-30).
 *
 * Each picture is small (192×108): a roll's picture is mostly black with a little white (the
 * names) and no colour at all; an all-black one between names counts too. A night scene has some
 * colour in it, and the story rarely ends on a minute of black and white.
 */

/** What one picture (RGBA) looks like: names on black, all black, or something else (null). */
export function rollPicture(data: Uint8ClampedArray): 'names' | 'black' | null {
	let dark = 0;
	let white = 0;
	let colour = 0;
	const count = data.length / 4;
	for (let i = 0; i < data.length; i += 4) {
		const most = Math.max(data[i], data[i + 1], data[i + 2]);
		const least = Math.min(data[i], data[i + 1], data[i + 2]);
		if (most < 40) dark++;
		else if (most - least > 40) colour++;
		else if (least > 100) white++;
	}
	// She-Hulk's rolls: no colour at all, 74–99% dark, up to 9% white (names); its animated credits
	// before them had 40–70% colour.
	if (colour / count > 0.003 || dark / count < 0.65) return null;
	return white / count > 0.002 ? 'names' : 'black';
}

/**
 * Where the roll begins (seconds), from pictures in time order with whether each looks like one:
 * the run of them that reaches the end, at least 30 s long, with no gap in the pictures over 25 s
 * (where nothing is known), names in at least three, and at most one picture in a row that
 * doesn't look like one (a logo in colour), and only between two with names or in the last 40 s
 * (a studio logo closing the roll). It starts at its
 * first names (black before them is the fade out of the story). Null when the end isn't a roll,
 * or there aren't pictures enough to say.
 *
 * Hawkeye S1E1 (2026-10-31): a night scene at 42:47–43:56 (white lights, almost no colour) reads
 * as names; one colourful picture at 44:08, then the fade to black from 44:18, then the real
 * names from 44:55. Letting any one picture through joined the scene to the roll (43:35).
 */
export function rollStart(pictures: { at: number; kind: 'names' | 'black' | null }[], duration: number): number | null {
	if (!pictures.length || duration <= 0) return null;
	const last = pictures[pictures.length - 1];
	if (duration - last.at > 30) return null;
	let start: number | null = null;
	let misses = 0;
	let names = 0;
	for (let i = pictures.length - 1; i >= 0; i--) {
		const picture = pictures[i];
		const after = pictures[i + 1];
		if (after && after.at - picture.at > 25) break;
		if (picture.kind) {
			// Past one that doesn't look like a roll: only if it sat between two with names, or in the
			// last 40 s (a studio's logo after the names).
			const miss = pictures[i + 1];
			if (misses && duration - miss.at > 40 && (picture.kind !== 'names' || pictures[i + 2]?.kind !== 'names')) break;
			start = picture.at;
			misses = 0;
			if (picture.kind === 'names') names++;
		} else if (++misses > 1) break;
	}
	// Black before the first names is the story fading out.
	if (start !== null) start = pictures.find((p) => p.at >= start! && p.kind === 'names')?.at ?? start;
	// (Names in a few of them: a run of black alone is a dark scene, or the end of the file.)
	if (start === null || names < 3 || duration - start < 30 || duration - start > 10 * 60) return null;
	return start;
}
