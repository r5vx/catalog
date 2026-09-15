import { json } from '@sveltejs/kit';
import { existsSync, statSync } from 'node:fs';
import { dbPath, dataDir } from '$lib/server/db';
import { settingsPath, readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const describe = (path: string) => {
	if (!existsSync(path)) return { path, exists: false };
	const stat = statSync(path);
	return { path, exists: true, bytes: stat.size, modified: stat.mtime.toISOString() };
};

/**
 * Says where the app is actually reading and writing. Deliberately reports only
 * paths and yes/no answers — never the API key, never the PIN.
 *
 * Reachable without the PIN, because you need it most when the PIN is the thing
 * misbehaving.
 */
export const GET: RequestHandler = async () => {
	const settings = readSettings();

	return json({
		settingsStoredIn: 'settings table inside library.db',
		cwd: process.cwd(),
		appdata: process.env.APPDATA ?? null,
		catalogDbEnv: process.env.CATALOG_DB ?? null,
		dataDir,
		library: describe(dbPath),
		hasTmdbKey: Boolean(settings.tmdbApiKey),
		hasPin: Boolean(settings.pinHash),
		hasSalt: Boolean(settings.salt)
	});
};
