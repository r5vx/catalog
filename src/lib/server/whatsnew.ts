import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What changed, read from the RELEASE_NOTES.md that ships inside the app.
 *
 * Inside the app rather than fetched from GitHub, for two reasons: it works
 * with no connection, and it always describes the version actually installed
 * rather than the newest one published.
 *
 * A release's notes are sorted under "### New", "### Improved" and "### Fixed",
 * one short line per change; changes to one part of the app sit together under
 * its name:
 *
 *     ### Fixed
 *     - **Player**
 *       - Paused videos stay paused
 *       - The progress bar shows your place in intros
 *     - Black Clover's episodes are numbered properly
 *
 * Older releases were written as paragraphs: each shows just its bold opening
 * words, sorted by a guess from them.
 *
 * Plain text only goes to the browser — no markup to sanitise, nothing that
 * can inject anything.
 */

export type Kind = 'new' | 'improved' | 'fixed';

/** One line in the log, or a part of the app (`area`) with its changes under it. */
export type Change = { kind: Kind; area: string | null; items: string[] };

export type ReleaseNote = {
	/** "1.1.0", or "Unreleased" for changes built but not yet published. */
	version: string;
	date: string | null;
	title: string | null;
	changes: Change[];
};

const KINDS: [RegExp, Kind][] = [
	[/^(new|added)/i, 'new'],
	[/^(improved|improvements?|changed)/i, 'improved'],
	[/^(fixed|fixes|bug ?fix)/i, 'fixed']
];

const plain = (text: string) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** The sorted kind: "### New / Improved / Fixed" and its bullets. */
function sorted(body: string): Change[] {
	const changes: Change[] = [];
	let kind: Kind = 'new';
	let current: Change | null = null;
	for (const line of body.split('\n')) {
		const heading = line.match(/^###\s+(.+)/);
		if (heading) {
			kind = KINDS.find(([test]) => test.test(heading[1].trim()))?.[1] ?? 'new';
			current = null;
			continue;
		}
		const top = line.match(/^- (.*)/);
		const under = line.match(/^\s+- (.*)/);
		if (top) {
			// "- **Player**" alone names a part of the app; its changes are indented under it.
			const area = top[1].match(/^\*\*([^*]+)\*\*:?\s*$/);
			current = area ? { kind, area: area[1].trim(), items: [] } : { kind, area: null, items: [plain(top[1])] };
			changes.push(current);
		} else if (under && current?.area) {
			current.items.push(plain(under[1]));
		} else if (line.trim() && current) {
			// A line running on from the one before.
			const items = current.items;
			if (items.length) items[items.length - 1] = plain(`${items[items.length - 1]} ${line}`);
		}
	}
	return changes.filter((c) => c.items.length);
}

/** Written as paragraphs (older releases): each bullet's bold opening words, kind guessed from them. */
function paragraphs(body: string): Change[] {
	return body
		.split(/^- /m)
		.slice(1)
		.map((one) => one.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.map((bullet) => {
			const lead = bullet.match(/^\*\*(.+?)\*\*/)?.[1] ?? bullet.split(/(?<=[.!?])\s/)[0];
			const text = plain(lead).replace(/[.:]$/, '');
			const kind: Kind = /\bfix|no longer|no more|not any more|again\b|stuck|broke|wrong|instead of|doesn't|don't|won't|bug|properly|keeps its/i.test(text)
				? 'fixed'
				: /faster|quicker|sooner|better|improv|less wait|straight away|in seconds|clearer|cleaner|smoother|tidier|lighter|bigger|ahead|first\b|more .+ from/i.test(text)
					? 'improved'
					: 'new';
			return { kind, area: null, items: [text] };
		});
}

function notesFile(): string | null {
	// The desktop app passes the path; `npm run dev` looks in the project.
	const candidates = [
		process.env.CATALOG_NOTES,
		join(process.cwd(), 'RELEASE_NOTES.md')
	].filter(Boolean) as string[];

	return candidates.find((path) => existsSync(path)) ?? null;
}

/** Cached in production; re-reads on every call in dev so edits show up. */
let cached: ReleaseNote[] | null = null;

export function whatsNew(): ReleaseNote[] {
	if (cached && !import.meta.env.DEV) return cached;

	const path = notesFile();
	if (!path) return (cached = []);

	let text: string;
	try {
		text = readFileSync(path, 'utf8').replace(/\r/g, '');
	} catch {
		return (cached = []);
	}

	const notes: ReleaseNote[] = [];

	// Each "## 1.1.0 — 2026-09-16 — Its name" starts a section ("## Unreleased — Its name" for
	// one not out yet); its changes follow.
	for (const chunk of text.split(/^## /m).slice(1)) {
		const [heading, ...rest] = chunk.split('\n');

		const parts = heading.split('—').map((part) => part.trim());
		const version = parts[0];
		if (!version) continue;
		const unreleased = version === 'Unreleased';
		const date = unreleased ? null : parts[1] || null;
		const title = (unreleased ? parts[1] : parts[2]) || null;

		const body = rest.join('\n');
		const changes = /^###\s/m.test(body) ? sorted(body) : paragraphs(body);

		if (changes.length > 0) notes.push({ version, date, title, changes });
	}

	return (cached = notes);
}
