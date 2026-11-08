/**
 * Subtitle timing by words (src/lib/wordTiming.ts says why): jobs for the computer's hidden
 * /word-timer page, and their answers, kept in the library per copy and subtitle file so a second
 * screen or a second watch has it at once. Any screen asks (the computer's player, a TV): the
 * computer does the hearing. Only in the desktop app.
 */
import { getOrderCache, saveOrderCache } from './db/queries';
import type { DelayPlan } from '$lib/subtitleAlign';

export type WordJob = { key: string; master: string; language: string; sub: string; duration: number; asked: number; started?: number };
/** `points`: each matched line [when it starts, how far off] (for checking an answer). */
export type WordAnswer = { plan: (DelayPlan & { fits: true }) | null; matches: number; heard: number; finished: boolean; at: number; why?: string; points?: { t: number; off: number }[] };

const jobs = new Map<string, WordJob>();
const keyOf = (copy: string, sub: string) => `word-timing|${copy}|${sub.replace(/[?#].*$/, '')}`;

export function wordAnswer(copy: string, sub: string): WordAnswer | null {
	const kept = getOrderCache(keyOf(copy, sub))?.value as WordAnswer | undefined;
	return kept ?? null;
}

/** Asks the computer to time these subtitles by their words, unless it has or is doing so. */
export function askWordTiming(copy: string, sub: string, master: string, language: string, duration: number): 'known' | 'asked' | 'none' {
	const key = keyOf(copy, sub);
	const kept = wordAnswer(copy, sub);
	if (kept?.finished) return 'known';
	if (typeof process.send !== 'function') return 'none';
	if (!jobs.has(key)) jobs.set(key, { key, master, language, sub, duration, asked: Date.now() });
	else jobs.get(key)!.master = master; // a fresher link
	process.send({ type: 'word-timer' });
	return 'asked';
}

/** The next job for /word-timer (oldest first); null when there's none. */
export function nextWordJob(): WordJob | null {
	const now = Date.now();
	for (const [key, job] of jobs) if (now - job.asked > 30 * 60_000) jobs.delete(key);
	const job = [...jobs.values()].find((j) => !j.started) ?? null;
	if (job) job.started = now;
	return job;
}

/** What /word-timer found so far (`finished` once every stretch was heard). */
export function keepWordAnswer(key: string, answer: Omit<WordAnswer, 'at'>): void {
	if (!key.startsWith('word-timing|')) return;
	saveOrderCache(key, { ...answer, at: Date.now() }, Date.now());
	if (answer.finished) jobs.delete(key);
}
