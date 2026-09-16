import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What changed, read from the RELEASE_NOTES.md that ships inside the app.
 *
 * Inside the app rather than fetched from GitHub, for two reasons: it works
 * with no connection, and it always describes the version actually installed
 * rather than the newest one published.
 */

/**
 * A bullet, split into plain and bold runs.
 *
 * The notes are Markdown because GitHub renders them on the release page too.
 * Splitting here rather than sending HTML to the browser means there is no
 * markup to sanitise and nothing that can inject anything.
 */
export type Run = { text: string; bold: boolean };

export type ReleaseNote = {
	/** "1.1.0", or "Unreleased" for changes built but not yet published. */
	version: string;
	date: string | null;
	bullets: Run[][];
};

/** "**Actors:** it works" → a bold run followed by a plain one. */
function runs(line: string): Run[] {
	// Odd-numbered pieces sat between a pair of asterisks.
	return line
		.split(/\*\*/)
		.map((text, index) => ({ text, bold: index % 2 === 1 }))
		.filter((run) => run.text.length > 0);
}

function notesFile(): string | null {
	// The desktop app passes the path; `npm run dev` looks in the project.
	const candidates = [
		process.env.CATALOG_NOTES,
		join(process.cwd(), 'RELEASE_NOTES.md')
	].filter(Boolean) as string[];

	return candidates.find((path) => existsSync(path)) ?? null;
}

/** Cached: the file can't change without the app being replaced. */
let cached: ReleaseNote[] | null = null;

export function whatsNew(): ReleaseNote[] {
	if (cached) return cached;

	const path = notesFile();
	if (!path) return (cached = []);

	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		return (cached = []);
	}

	const notes: ReleaseNote[] = [];

	// Each "## 1.1.0 — 2026-09-16" starts a section; its bullets follow.
	for (const chunk of text.split(/^## /m).slice(1)) {
		const [heading, ...rest] = chunk.split('\n');

		const [version, date] = heading.split('—').map((part) => part.trim());
		if (!version) continue;

		const bullets = rest
			.join('\n')
			.split(/^- /m)
			.slice(1)
			.map((one) => one.replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.map(runs);

		if (bullets.length > 0) notes.push({ version, date: date || null, bullets });
	}

	return (cached = notes);
}
