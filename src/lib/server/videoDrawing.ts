import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

/**
 * How this computer's Catalog window draws video (Settings → Playback → Picture), kept in a file
 * the desktop app reads as it starts (electron/main.cjs), since it has to be set before then.
 *
 * `noOverlay`: video drawn by Catalog itself, not handed to the graphics card as a layer of its own.
 * On a friend's computer that layer was put in the wrong place for a frame now and then: the whole
 * picture jumped up, on every source and quality, and only there (2026-11-23).
 */
const file = () => join(dataDir, 'video.json');

export function videoDrawing(): { noOverlay: boolean } {
	try {
		const kept = JSON.parse(readFileSync(file(), 'utf8'));
		return { noOverlay: kept?.noOverlay === true };
	} catch {
		return { noOverlay: false };
	}
}

export function setVideoDrawing(noOverlay: boolean): void {
	writeFileSync(file(), JSON.stringify({ noOverlay }));
}
