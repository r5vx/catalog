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
import { keptLines, srtBlocks } from './subtitleAds';

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
	for (const block of srtBlocks(text)) {
		const lines = block.split('\n');
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0) continue;
		const [a, b] = lines[at].split('-->');
		const said = keptLines(lines.slice(at + 1)).map((l) => l.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, ''));
		if (!said.length) continue;
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
	const counts = cues.map((c) => words(c.text).length);
	const size = duration / parts;
	for (let p = 0; p < parts; p++) {
		let best = -1;
		let bestAt = p * size;
		for (let at = p * size; at + span <= (p + 1) * size; at += 10) {
			let n = 0;
			for (let i = 0; i < cues.length; i++) if (cues[i].start >= at && cues[i].start < at + span) n += counts[i];
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
	const line = straightPlan(points);
	const stretched = planByStretch(points);
	// The straight line unless following each stretch fits clearly more lines (it bends to fit
	// anything a little, so a near tie stays straight).
	if (stretched && (!line || stretched.agree >= line.agree + Math.max(3, points.length * 0.1))) return stretched;
	return line;
}

/** One delay for the whole video (at a steady speed): planFromMatches says why. */
function straightPlan(points: Point[]): (DelayPlan & { fits: true; matches: number; agree: number }) | null {
	if (points.length < 8) return null;
	const slopes: number[] = [];
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			const dt = points[j].t - points[i].t;
			if (Math.abs(dt) > 120) slopes.push((points[j].off - points[i].off) / dt);
		}
	}
	const measured = slopes.length ? median(slopes) : 0;
	const score = (slope: number) => {
		const offsets = points.map((p) => p.off - slope * p.t);
		const delay = median(offsets);
		const residuals = offsets.map((d) => Math.abs(d - delay));
		return { slope, delay, agree: residuals.filter((d) => d <= 0.5).length, residual: median(residuals) };
	};
	// Prefer normal speed when indistinguishable; accept drift only when it fits the actual lines better.
	const models = [0, ...RATES.map((r) => r - 1).filter((s) => Math.abs(s - measured) < 0.003), measured].map(score);
	const most = Math.max(...models.map((m) => m.agree));
	const best = models.filter((m) => m.agree === most);
	const residual = Math.min(...best.map((m) => m.residual));
	const { slope, delay, agree } = best.find((m) => m.residual <= residual + 0.03)!;
	if (agree < 8 || agree <= points.length / 2) return null;
	// Only the ones that agree, for the delay itself.
	const exact = median(points.filter((p) => Math.abs(p.off - (delay + slope * p.t)) <= 0.5).map((p) => p.off - slope * p.t));
	return { steps: [{ from: 0, delay: Math.round(exact * 10) / 10 }], fits: true, clear: agree / points.length, rate: 1 + slope, matches: points.length, agree };
}

/**
 * Subtitles that fall behind unevenly: made for another cut, with a few frames taken out here and
 * there, so no one delay or speed fits them. The Day of the Jackal E8's three English files
 * (owner, 2026-11-26) were 2.5 s out at the start and 10 s by the end, in uneven steps (−3 at 7
 * minutes, −4.4 at 14, −6.8 at 20, −8 at 25, −10 at 37): one delay left every line a second or
 * more out somewhere, or none was believed ("too few words matched") and the listening's guess
 * was used. Here each stretch heard keeps its own delay (what most of its lines agree on), and
 * between two stretches it moves from one to the next a little at a time.
 */
function planByStretch(points: Point[]): (DelayPlan & { fits: true; matches: number; agree: number }) | null {
	if (points.length < 8) return null;
	const sorted = [...points].sort((a, b) => a.t - b.t);
	// The lines of one stretch heard (30 s, matched within 20 s of it) lie close together.
	const groups: Point[][] = [];
	for (const p of sorted) {
		const group = groups.at(-1);
		if (group && p.t - group.at(-1)!.t < 60) group.push(p);
		else groups.push([p]);
	}
	const anchors: { at: number; delay: number }[] = [];
	for (const group of groups) {
		if (group.length < 3) continue;
		const middle = median(group.map((p) => p.off));
		const agreeing = group.filter((p) => Math.abs(p.off - middle) <= 0.5);
		if (agreeing.length < 3 || agreeing.length * 2 <= group.length) continue;
		const delay = median(agreeing.map((p) => p.off));
		anchors.push({ at: median(agreeing.map((p) => p.t)) + delay, delay });
	}
	if (anchors.length < 3) return null;
	const delayAtVideo = (t: number) => {
		if (t <= anchors[0].at) return anchors[0].delay;
		for (let i = 1; i < anchors.length; i++) {
			const a = anchors[i - 1];
			const b = anchors[i];
			if (t <= b.at) return a.delay + ((b.delay - a.delay) * (t - a.at)) / (b.at - a.at);
		}
		return anchors[anchors.length - 1].delay;
	};
	const agree = points.filter((p) => Math.abs(p.off - delayAtVideo(p.t + p.off)) <= 0.5).length;
	if (agree < 8 || agree <= points.length / 2) return null;
	const tenth = (d: number) => Math.round(d * 10) / 10;
	const steps = [{ from: 0, delay: tenth(anchors[0].delay) }];
	for (let i = 1; i < anchors.length; i++) {
		// Every 10 s between two stretches, where it has moved a tenth or more.
		for (let t = anchors[i - 1].at + 10; t < anchors[i].at + 10; t += 10) {
			const delay = tenth(delayAtVideo(Math.min(t, anchors[i].at)));
			if (Math.abs(delay - steps[steps.length - 1].delay) >= 0.1) steps.push({ from: Math.round(t), delay });
		}
	}
	return { steps, fits: true, clear: agree / points.length, rate: 1, matches: points.length, agree };
}
