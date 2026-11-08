/**
 * Subtitle timing from the words themselves: Whisper (on the computer, /word-timer) hears short
 * stretches of a film or episode, and each subtitle's first three words are found among the words
 * heard. Where they were said, against when the subtitle starts, is how far off it is.
 *
 * Why (2026-11-04): auto-timing's listening only knows *that* someone is talking (Silero). Under a
 * film's constant score (Ice Age: The Meltdown: talking in 24% of the sound, subtitles up 39% of
 * the time) that moved both of its subtitle files 2 s early, while Whisper heard every line where
 * the files already had it (±0.2 s at 3 and 20 minutes). Matching words doesn't care about music.
 * English talking only (Whisper's English model); anime in Japanese keeps the listening.
 */
import type { DelayPlan } from './subtitleAlign';
import { isAdvert, isCredit } from './subtitleAds';

export type Cue = { start: number; end: number; text: string };
export type HeardWord = { w: string; at: number };
export type Point = { t: number; off: number };

const clock = (s: string) => {
	const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s);
	return m ? +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +`0.${m[4]}` : NaN;
};
const assClock = (s: string) => {
	const [h, m, x] = s.trim().split(':');
	return +h * 3600 + +m * 60 + parseFloat(x);
};

/** SRT, WebVTT or ASS subtitles as cues, without the sites' adverts and credits. */
export function parseCues(text: string): Cue[] {
	text = text.replace(/^﻿/, '').replace(/\r/g, '');
	const cues: Cue[] = [];
	if (/^\s*Dialogue:/m.test(text)) {
		for (const line of text.split('\n')) {
			const m = /^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/.exec(line);
			if (m) cues.push({ start: assClock(m[1]), end: assClock(m[2]), text: m[3].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, ' ') });
		}
		return cues;
	}
	for (const block of text.split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0) continue;
		const [a, b] = lines[at].split('-->');
		const said = lines.slice(at + 1).map((l) => l.replace(/<[^>]*>/g, '')).filter((l) => l.trim() && !isAdvert(l));
		if (!said.length || isCredit(said.join(' '))) continue;
		const start = clock(a);
		const end = clock(b);
		if (Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: said.join(' ') });
	}
	return cues;
}

/** Plain words: lower case, no punctuation, sound effects and song marks left out. */
export function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/\[[^\]]*\]|\([^)]*\)|♪|♫/g, ' ')
		.replace(/[^a-z0-9' ]/g, ' ')
		.split(/\s+/)
		.map((w) => w.replace(/^'+|'+$/g, ''))
		.filter(Boolean);
}

/** Where to listen: in each of `parts` equal parts of the video, the `span` seconds with the most subtitle words. */
export function stretchesToHear(cues: Cue[], duration: number, parts = 8, span = 40): number[] {
	const out: number[] = [];
	const size = duration / parts;
	for (let p = 0; p < parts; p++) {
		let best = -1;
		let bestAt = p * size;
		for (let at = p * size; at + span <= (p + 1) * size; at += 10) {
			const n = cues.filter((c) => c.start >= at && c.start < at + span).reduce((sum, c) => sum + words(c.text).length, 0);
			if (n > best) {
				best = n;
				bestAt = at;
			}
		}
		if (best > 8) out.push(bestAt);
	}
	return out;
}

/**
 * Each subtitle starting near what was heard whose first three words were heard in a row, within
 * 20 s of it: [when the subtitle starts, how far off it is]. `heard` is on the video's clock.
 */
export function matchWords(cues: Cue[], heard: HeardWord[], from: number, to: number): Point[] {
	const said = heard.map((h) => ({ w: words(h.w)[0] ?? '', at: h.at })).filter((h) => h.w);
	const points: Point[] = [];
	for (const cue of cues) {
		if (cue.start < from - 20 || cue.start > to + 20) continue;
		const own = words(cue.text);
		if (own.length < 3) continue;
		// Said close together (no pause after the first word): Whisper puts a first word followed by a
		// pause early ("I'm … trying to make a living": "I'm" a second before the line), so those don't count.
		const found = said.findIndex(
			(h, i) =>
				i + 2 < said.length &&
				h.w === own[0] &&
				said[i + 1].w === own[1] &&
				said[i + 2].w === own[2] &&
				Math.abs(h.at - cue.start) < 20 &&
				said[i + 1].at - h.at < 0.5 &&
				said[i + 2].at - h.at < 0.9
		);
		if (found >= 0) points.push({ t: cue.start, off: said[found].at - cue.start });
	}
	return points;
}

const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/** Speeds subtitles are often made for (25 fps PAL against a 23.976 film, and so on). */
const RATES = [25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25, 24 / 23.976, 23.976 / 24];

/**
 * The timing all the matches agree on: a straight line through (subtitle time, how far off), so
 * subtitles made for another speed are followed too (rate). Whisper's word times are sometimes
 * seconds out (a word put on the wrong side of a pause), so the line is the median of pairs'
 * slopes (Theil–Sen) and needs most matches within half a second of it. Null with too little to go by.
 */
export function planFromMatches(points: Point[]): (DelayPlan & { fits: true; matches: number; agree: number }) | null {
	if (points.length < 8) return null;
	const slopes: number[] = [];
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			const dt = points[j].t - points[i].t;
			if (Math.abs(dt) > 120) slopes.push((points[j].off - points[i].off) / dt);
		}
	}
	let slope = slopes.length ? median(slopes) : 0;
	// Within 0.15 % of the normal speed: the normal speed (a second over an 11-minute stretch).
	if (Math.abs(slope) < 0.0015) slope = 0;
	else {
		const near = RATES.find((r) => Math.abs(r - 1 - slope) < 0.003);
		if (near) slope = near - 1;
	}
	const delay = median(points.map((p) => p.off - slope * p.t));
	const agree = points.filter((p) => Math.abs(p.off - (delay + slope * p.t)) <= 0.5).length;
	if (agree < 8 || agree / points.length < 0.5) return null;
	// Only the ones that agree, for the delay itself.
	const exact = median(points.filter((p) => Math.abs(p.off - (delay + slope * p.t)) <= 0.5).map((p) => p.off - slope * p.t));
	return { steps: [{ from: 0, delay: Math.round(exact * 10) / 10 }], fits: true, clear: agree / points.length, rate: 1 + slope, matches: points.length, agree };
}
