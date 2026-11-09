import { isAdvert, isCredit } from '$lib/subtitleAds';
import { delayAt, fitDelays, spoken, type DelayPlan, type TimedCue } from '$lib/subtitleAlign';
import { readSpeech, speechIsPartial, type SpeechKey } from './heardSpeech';

/**
 * Captions for the Roku, drawn by the Roku app itself (as the computer and the Fire TV draw their
 * own): the Roku's own caption drawing showed them in capitals and its own style. Here they are
 * read (SRT, WebVTT or ASS), cleaned of the sites' adverts and credit lines, and timed with what
 * the computer heard of the copy (heardSpeech.ts, /speech-maker), the way the Fire TV's
 * auto-timing does it: the Roku can't hear the sound itself.
 */

export type Cue = { s: number; e: number; t: string };

/** SRT, WebVTT or ASS subtitles as WebVTT, without the sites' adverts; empty when it's none of those. */
export function toVtt(text: string): string {
	text = text.replace(/^﻿/, '').replace(/\r/g, '');
	if (/^WEBVTT/.test(text)) return withoutAdverts(text);
	if (/^\s*Dialogue:/m.test(text)) return withoutAdverts(assToVtt(text));
	if (!/-->/.test(text)) return '';
	return withoutAdverts(`WEBVTT\n\n${text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')}`);
}

/** Drops advert lines and credit cues (the same ones the computer's and Fire TV's player drop). */
function withoutAdverts(vtt: string): string {
	return vtt
		.split(/\n{2,}/)
		.map((block) => {
			const lines = block.split('\n');
			const at = lines.findIndex((l) => l.includes('-->'));
			if (at < 0) return block;
			const said = lines.slice(at + 1).filter((l) => l.replace(/<[^>]*>/g, '').trim() && !isAdvert(l.replace(/<[^>]*>/g, '')));
			if (!said.length || isCredit(said.map((l) => l.replace(/<[^>]*>/g, '')).join(' '))) return '';
			return [...lines.slice(0, at + 1), ...said].join('\n');
		})
		.filter(Boolean)
		.join('\n\n');
}

/** "0:01:02.34" (ASS) → "00:01:02.340". */
const assTime = (time: string) => {
	const [h, m, s] = time.trim().split(':');
	const [whole, part = '0'] = s.split('.');
	return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${whole.padStart(2, '0')}.${part.padEnd(3, '0').slice(0, 3)}`;
};

/** ASS lines (anime's styled subtitles), as plain cues: styling and drawings left out. */
function assToVtt(text: string): string {
	const format = /^Format:\s*(.+)$/m.exec(text.slice(text.indexOf('[Events]')))?.[1].split(',').map((f) => f.trim().toLowerCase()) ?? [
		'layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'
	];
	const at = (name: string) => format.indexOf(name);
	const cues: { start: string; end: string; text: string }[] = [];
	for (const line of text.split('\n')) {
		if (!line.startsWith('Dialogue:')) continue;
		const parts = line.slice(9).split(',');
		const fields = [...parts.slice(0, format.length - 1), parts.slice(format.length - 1).join(',')];
		const raw = fields[at('text')] ?? '';
		if (/\\p[1-9]/.test(raw)) continue;
		const words = raw.replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').replace(/\\h/g, ' ').trim();
		if (!words) continue;
		cues.push({ start: assTime(fields[at('start')]), end: assTime(fields[at('end')]), text: words });
	}
	cues.sort((a, b) => a.start.localeCompare(b.start));
	return cues.length ? `WEBVTT\n\n${cues.map((c) => `${c.start} --> ${c.end}\n${c.text}`).join('\n\n')}\n` : '';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** WebVTT as cues: times in seconds, plain words (no tags), in order. */
export function cuesOf(vtt: string): Cue[] {
	const seconds = (t: string) => {
		const parts = t.trim().split(':').map(Number);
		return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
	};
	const cues: Cue[] = [];
	for (const block of vtt.split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0) continue;
		const m = /([\d:.]+)\s*-->\s*([\d:.]+)/.exec(lines[at]);
		if (!m) continue;
		const t = lines
			.slice(at + 1)
			.join('\n')
			.replace(/<[^>]*>|\{\\[^}]*\}/g, '')
			.replace(/&(#39|[a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all)
			.trim();
		const s = seconds(m[1].replace(',', '.'));
		const e = seconds(m[2].replace(',', '.'));
		if (t && Number.isFinite(s) && Number.isFinite(e) && e > s) cues.push({ s, e, t });
	}
	return cues.sort((a, b) => a.s - b.s);
}

/** How the captions sent are timed, as the Fire TV's player says it. */
export type Timing =
	| { state: 'timed'; delay: number }
	| { state: 'waiting' } // the computer is still hearing the sound track
	| { state: 'nomatch' } // heard, and these captions don't fit this copy
	| { state: 'unavailable' } // nothing to time from (a copy the computer can't hear)
	| { state: 'off' };

/** Fits cost about a second each over a film: the last answers are kept (copy + captions + how much heard). */
const fits = new Map<string, DelayPlan | null>();

/**
 * The plan for `cues` against what the computer heard in copy `key` (null: not enough heard yet,
 * or nothing heard). `partial` when the computer is still hearing it.
 */
export function planFor(key: SpeechKey, language: string, captions: string, cues: Cue[]): { plan: DelayPlan | null; heard: boolean; partial: boolean } {
	const bytes = readSpeech(key, language);
	if (!bytes) return { plan: null, heard: false, partial: false };
	let heard = 0;
	for (const b of bytes) if (b !== 255) heard++;
	const id = `${key}|${language}|${captions}|${heard}`;
	if (!fits.has(id)) {
		const speech = new Float32Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) speech[i] = bytes[i] === 255 ? NaN : bytes[i] / 254;
		const timed: TimedCue[] = cues.map((c) => ({ start: c.s, end: c.e, text: c.t }));
		fits.set(id, fitDelays(speech, spoken(timed)));
		if (fits.size > 40) fits.delete(fits.keys().next().value!);
	}
	return { plan: fits.get(id) ?? null, heard: true, partial: speechIsPartial(key, language) };
}

/** The cues moved by a plan: each shown at its time × the plan's speed + that part's delay (as the player does). */
export function timedBy(cues: Cue[], plan: DelayPlan & { fits: true }): Cue[] {
	return cues.map((c) => {
		const s = c.s * plan.rate;
		const delay = delayAt(plan.steps, s);
		return { s: round(s + delay), e: round(c.e * plan.rate + delay), t: c.t };
	});
}

const round = (n: number) => Math.round(n * 1000) / 1000;
