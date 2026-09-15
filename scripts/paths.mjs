import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Must match `defaultDbPath()` in src/lib/server/db/index.ts. Backup scripts run
 * as plain Node, outside the app, so they can't import the app's own code.
 */
export function dbPath() {
	if (process.env.CATALOG_DB) return process.env.CATALOG_DB;

	const base =
		process.env.APPDATA ??
		(process.platform === 'darwin'
			? join(homedir(), 'Library', 'Application Support')
			: join(homedir(), '.local', 'share'));

	return join(base, 'Catalog', 'library.db');
}

export const dataDir = () => join(dbPath(), '..');
export const backupDir = () => join(dataDir(), 'backups');
