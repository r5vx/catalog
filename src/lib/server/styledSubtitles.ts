import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir } from './db';
import { hasStyledLines } from '$lib/styledLines';

export { hasStyledLines };

/**
 * Whole anime subtitle files (.ass with signs and songs), kept as made — fonts, drawings and
 * karaoke included — for drawing them over the video (src/lib/styledSubs.ts). The library keeps
 * only a slimmed copy (subtitleFonts.ts: Re:Zero's were 32 MB each), so these live beside the
 * preview pictures instead (`previews/`): Settings → Storage's limit, Clear and the 60-day
 * clear-out cover them. Only files that have something to draw are kept.
 */

const dir = join(dataDir, 'previews');
const fileFor = (key: string) => join(dir, `styled-${createHash('sha1').update(key).digest('hex').slice(0, 20)}.ass`);

export function readStyled(key: string): string | null {
	const file = fileFor(key);
	if (!existsSync(file)) return null;
	try {
		const now = new Date();
		utimesSync(file, now, now);
		return readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

/** Keeps `text` for `key` if it has something to draw. */
export function keepStyled(key: string, text: string): void {
	if (!hasStyledLines(text)) return;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(fileFor(key), text);
	} catch {}
}
