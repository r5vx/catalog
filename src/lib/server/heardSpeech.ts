import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

/**
 * When someone is talking in an episode, as auto-timing heard it (src/lib/subtitleSync.ts):
 * one byte per 32 ms (0–254 how sure, 255 not heard), about 45 KB an episode. Kept so a TV or
 * a phone can time subtitles without hearing the whole sound track itself — the computer does
 * that once (/speech-maker) — and so a second watch doesn't fetch the sound again.
 *
 * Kept with the preview pictures (`previews/`), so Settings → Storage's limit and Clear, and
 * the 60-day clear-out, cover them too. Per Showbox file and audio language.
 *
 * While /speech-maker is still hearing, what it has so far is kept too, marked unfinished (a
 * `.partial` file beside it): a TV times from it straight away and picks up more as it comes.
 * The computer's own player never uses an unfinished one (it hears the rest itself).
 */

const dir = join(dataDir, 'previews');
const fileFor = (fid: number, language: string) => join(dir, `speech-${fid}-${language.replace(/[^a-z]/gi, '') || 'x'}.bin`);
const partialMark = (fid: number, language: string) => `${fileFor(fid, language)}.partial`;

export function readSpeech(fid: number, language: string): Buffer | null {
	const file = fileFor(fid, language);
	if (!existsSync(file)) return null;
	try {
		const now = new Date();
		utimesSync(file, now, now);
		return readFileSync(file);
	} catch {
		return null;
	}
}

/** Still being heard: what's kept is only part of it. */
export function speechIsPartial(fid: number, language: string): boolean {
	return existsSync(partialMark(fid, language));
}

/**
 * The last TV asks for hearing and how each went (/api/diagnostics → speechJobs), newest first:
 * when it was asked, how many parts were kept along the way, and when it finished or why not.
 */
type SpeechJob = { fid: number; language: string; asked: string; parts: number; finished?: string; outcome?: string };
const jobs: SpeechJob[] = [];
const jobFor = (fid: number, language: string) => jobs.find((j) => j.fid === fid && j.language === language && !j.finished);

export function noteSpeechAsked(fid: number, language: string): void {
	jobs.unshift({ fid, language, asked: new Date().toISOString(), parts: 0 });
	jobs.splice(20);
}

/** How /speech-maker ended when it kept nothing ("No video.", "Could not read its sound.", …). */
export function noteSpeechOutcome(fid: number, language: string, outcome: string): void {
	const job = jobFor(fid, language);
	if (job) Object.assign(job, { finished: new Date().toISOString(), outcome: outcome.slice(0, 80) });
}

export const speechJobs = () => jobs.map((j) => ({ ...j }));

export function keepSpeech(fid: number, language: string, bytes: Uint8Array, partial = false): void {
	const job = jobFor(fid, language);
	if (job && partial) job.parts++;
	else if (job) Object.assign(job, { finished: new Date().toISOString(), outcome: 'heard it all' });
	// An episode is a few thousand bytes a minute; anything far bigger isn't one of these.
	if (!bytes.length || bytes.length > 2_000_000) return;
	// A finished one is never replaced by part of one.
	if (partial && existsSync(fileFor(fid, language)) && !speechIsPartial(fid, language)) return;
	mkdirSync(dir, { recursive: true });
	writeFileSync(fileFor(fid, language), bytes);
	if (partial) writeFileSync(partialMark(fid, language), '');
	else rmSync(partialMark(fid, language), { force: true });
}
