import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
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
 */

const dir = join(dataDir, 'previews');
const fileFor = (fid: number, language: string) => join(dir, `speech-${fid}-${language.replace(/[^a-z]/gi, '') || 'x'}.bin`);

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

export function keepSpeech(fid: number, language: string, bytes: Uint8Array): void {
	// An episode is a few thousand bytes a minute; anything far bigger isn't one of these.
	if (!bytes.length || bytes.length > 2_000_000) return;
	mkdirSync(dir, { recursive: true });
	writeFileSync(fileFor(fid, language), bytes);
}
