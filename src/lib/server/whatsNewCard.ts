/**
 * The small "What's new" card after an update (src/lib/WhatsNewCard.svelte): the version's name
 * and a few of its New lines, straight from the release notes, once.
 *
 * Up to five lines, remembered per version on this device; the rest in Settings → Updates.
 */
import { appVersion } from './updater';
import { whatsNew } from './whatsnew';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';

export type WhatsNewCard = { version: string; title: string | null; lines: string[]; more: number };

const MOST_LINES = 5;
export const WHATS_NEW_SEEN = 'catalog_whats_new_seen';

export function whatsNewCard(seen = ''): WhatsNewCard | null {
	const version = appVersion();
	if (!/^\d+\.\d+\.\d+/.test(version)) return null;
	if (!seen) {
		// Never seen one: a new install has nothing to be told (an empty library); a Catalog that
		// was already in use is being updated to the first version with the card.
		const used = (db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number } | undefined)?.n ?? 0;
		if (!used) {
			return null;
		}
	} else if (seen === version) {
		return null;
	}
	const release = whatsNew().find((note) => note.version === version);
	const items = (kind: string) => release?.changes.filter((c) => c.kind === kind).flatMap((c) => c.items) ?? [];
	// New first; a version with no New lines shows its Improved ones, and a fix-only one its Fixed.
	const lines = [items('new'), items('improved'), items('fixed')].find((list) => list.length) ?? [];
	if (!release || !lines.length) {
		return null;
	}
	return { version, title: release.title, lines: lines.slice(0, MOST_LINES), more: Math.max(0, lines.length - MOST_LINES) };
}

/** Closed (or See everything pressed): not shown again for this version. */
export function whatsNewSeen(cookies: Cookies): void {
	const version = appVersion();
	if (version) cookies.set(WHATS_NEW_SEEN, version, { path: '/', maxAge: 60 * 60 * 24 * 365 * 5, httpOnly: true, sameSite: 'lax', secure: false });
}
