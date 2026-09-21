import { readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { db, dataDir } from './db';

/**
 * Settings live in the database, in their own table.
 *
 * They used to be a settings.json file next to it, and that file kept losing
 * writes — the app would report a key as saved while the file on disk said
 * otherwise. The database has never lost anything, so settings now live where
 * the data does.
 *
 * The key still stays out of your backups: backup.mjs exports the library
 * tables and deliberately skips this one.
 */
db.exec(`
	CREATE TABLE IF NOT EXISTS settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
`);

export type Settings = {
	/** Free key from themoviedb.org. Without it, only anime search works. */
	tmdbApiKey?: string;
	/** Free key from omdbapi.com. Optional — adds IMDb and Rotten Tomatoes. */
	omdbApiKey?: string;
	/** Optional. When set, the app asks for it before showing anything. */
	pinHash?: string;
	/** Random per-install value, so a PIN cookie can't be guessed. */
	salt?: string;
	/** Hex colour used for buttons, links and highlights. */
	accentColor?: string;
	/** Set once the welcome screen has been answered, so it stops appearing. */
	setupDone?: string;
	/** Set when you ask not to be told about updates any more. */
	updatePromptOff?: string;
	/** Sort options you've turned off, comma separated. */
	hiddenSorts?: string;
	/** Two-letter country for "where to watch". Blank means use this PC's. */
	watchRegion?: string;
	/** Theme override: light, dark, black. Empty means follow the OS. */
	theme?: string;
	/** Serialised febbox cookies — stored after login, or pasted by a friend. */
	febboxToken?: string;
	/** When '1', the layout stretches edge-to-edge instead of centering. */
	wideLayout?: string;
};

export function readSettings(): Settings {
	const rows = db.prepare('SELECT key, value FROM settings').all() as {
		key: string;
		value: string;
	}[];

	return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
	const set = db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	);
	const clear = db.prepare('DELETE FROM settings WHERE key = ?');

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null || value === '') clear.run(key);
		else set.run(key, String(value));
	}

	return readSettings();
}

/** One-time move of an old settings.json into the database. */
function importLegacyFile() {
	const legacy = join(dataDir, 'settings.json');
	if (!existsSync(legacy)) return;

	try {
		const old = JSON.parse(readFileSync(legacy, 'utf8')) as Settings;
		const current = readSettings();

		// Only fill in what the database doesn't already have.
		const patch: Partial<Settings> = {};
		if (old.salt && !current.salt) patch.salt = old.salt;
		if (old.pinHash && !current.pinHash) patch.pinHash = old.pinHash;
		if (old.tmdbApiKey && !current.tmdbApiKey) patch.tmdbApiKey = old.tmdbApiKey;

		if (Object.keys(patch).length > 0) updateSettings(patch);

		// Move it aside so it can't be read again — and so the key isn't left
		// sitting in a loose file.
		renameSync(legacy, `${legacy}.migrated`);
	} catch {
		// A corrupt or unreadable legacy file shouldn't stop the app booting.
	}
}

importLegacyFile();

/* ------------------------------------------------------------------ the PIN */

function getSalt(): string {
	const current = readSettings();
	if (current.salt) return current.salt;

	const salt = randomBytes(16).toString('hex');
	updateSettings({ salt });
	return salt;
}

export const hashPin = (pin: string, salt: string) =>
	createHash('sha256').update(`${salt}:${pin}`).digest('hex');

export function setPin(pin: string | null): void {
	if (!pin) {
		updateSettings({ pinHash: '' });
		return;
	}
	updateSettings({ pinHash: hashPin(pin, getSalt()) });
}

export function pinIsSet(): boolean {
	return Boolean(readSettings().pinHash);
}

export function checkPin(pin: string): boolean {
	const { pinHash, salt } = readSettings();
	if (!pinHash || !salt) return false;
	return hashPin(pin, salt) === pinHash;
}

/**
 * The value in the note-unlock cookie.
 *
 * Separate from the login token so signing in on a device doesn't also open
 * your locked pages — you enter the PIN again for those.
 */
export function notesToken(): string {
	const { pinHash } = readSettings();
	return pinHash ? createHash('sha256').update(`notes:${pinHash}`).digest('hex') : '';
}

/** The value stored in the login cookie — never the PIN itself. */
export function sessionToken(): string {
	const { pinHash } = readSettings();
	return pinHash ? createHash('sha256').update(`session:${pinHash}`).digest('hex') : '';
}

/** Kept for the diagnostics page, which reports where things live. */
export const settingsPath = `${dataDir} (settings table in library.db)`;

/* ----------------------------------------------------------------- first run */

/**
 * Whether to show the welcome screen.
 *
 * A library that already has things in it, or a key already saved, was plainly
 * set up before this screen existed — so it's marked done rather than asking
 * someone to introduce themselves to an app they've used for months.
 */
export function setupNeeded(): boolean {
	const current = readSettings();
	if (current.setupDone) return false;

	const existing = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };

	if (current.tmdbApiKey || existing.n > 0) {
		updateSettings({ setupDone: '1' });
		return false;
	}

	return true;
}

export const markSetupDone = () => updateSettings({ setupDone: '1' });
