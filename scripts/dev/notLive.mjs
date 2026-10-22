/**
 * Stops a test script that was pointed at the real library (%APPDATA%\Catalog\library.db).
 * Tests only ever run against a copy — CLAUDE.md, "Never point a test at the live library".
 */
import { resolve } from 'node:path';

export function notLive(dbPath) {
	const live = resolve(process.env.APPDATA ?? '', 'Catalog', 'library.db').toLowerCase();
	if (!dbPath || resolve(dbPath).toLowerCase() === live) {
		console.error('Give a COPY of the library, never the live one at %APPDATA%\\Catalog\\library.db.');
		process.exit(1);
	}
	return dbPath;
}
