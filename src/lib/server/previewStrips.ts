import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

/**
 * The progress bar's preview pictures, kept on this computer: one small file per film or
 * episode, next to the library (`previews/`, not in backups), with its pictures as JPEGs keyed
 * by the second they show. Gathered by whoever watched it (the player, or the computer itself
 * for the TVs and the next episode — see /strip-maker), so opening it again shows them from the
 * first second, on any screen. Ones not opened for 60 days are cleared away.
 */

const dir = join(dataDir, 'previews');
const KEEP_DAYS = 60;

export type Strip = { key: string; frames: Record<string, string> };

/**
 * Which video a strip belongs to: the film or episode, and its length to the nearest 10 s. Copies
 * of the same version (a few seconds apart) share one; another cut has its own. They were shared
 * by every copy once, and Chernobyl E5's showed HBO's pictures (from Showbox) over Sky's cut (on
 * 7Movies), minutes apart. (Strips kept without a length, from then, are no longer read.)
 */
export function stripKey(title: string, type: string, season: number, episode: number, length: number): string {
	return `${title.trim().toLowerCase()}|${type}|${type === 'tv' ? season : 0}|${type === 'tv' ? episode : 0}|${Math.round(length / 10)}`;
}

/** The strip kept for a video this long: its own, or one of a copy within about 10 s of it. */
export function stripFor(title: string, type: string, season: number, episode: number, length: number): Strip {
	const key = stripKey(title, type, season, episode, length);
	const own = readStrip(key);
	if (Object.keys(own.frames).length) return own;
	for (const near of [length - 10, length + 10]) {
		const other = readStrip(stripKey(title, type, season, episode, near));
		if (Object.keys(other.frames).length) return { key, frames: other.frames };
	}
	return own;
}

const fileFor = (key: string) => join(dir, `${createHash('sha1').update(key).digest('hex').slice(0, 24)}.json`);

export function readStrip(key: string): Strip {
	try {
		const strip = JSON.parse(readFileSync(fileFor(key), 'utf8')) as Strip;
		// Opened: kept another 60 days.
		const now = new Date();
		utimesSync(fileFor(key), now, now);
		return strip;
	} catch {
		return { key, frames: {} };
	}
}

/** Adds pictures to a strip (base64 JPEGs by second). Returns how many it has now. */
export function addToStrip(key: string, frames: Record<string, string>): number {
	mkdirSync(dir, { recursive: true });
	let strip: Strip = { key, frames: {} };
	try {
		strip = JSON.parse(readFileSync(fileFor(key), 'utf8')) as Strip;
	} catch {}
	for (const [t, jpeg] of Object.entries(frames)) {
		// Small pictures only (a few KB each); anything else isn't one of ours.
		if (/^\d+(\.\d+)?$/.test(t) && typeof jpeg === 'string' && jpeg.length < 60_000) strip.frames[t] = jpeg;
	}
	writeFileSync(fileFor(key), JSON.stringify(strip));
	return Object.keys(strip.frames).length;
}

export function stripSize(key: string): number {
	try {
		return Object.keys((JSON.parse(readFileSync(fileFor(key), 'utf8')) as Strip).frames).length;
	} catch {
		return 0;
	}
}

/** Strips not opened for 60 days go (at startup). */
export function clearOldStrips(): void {
	if (!existsSync(dir)) return;
	const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
	for (const name of readdirSync(dir)) {
		try {
			const file = join(dir, name);
			if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
		} catch {}
	}
}
