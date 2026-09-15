import { toCsv, toText, fullExport, exportFilename, rowsFor } from '$lib/server/export';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Downloads the library as a file.
 *
 *   /api/export?format=csv&cat=movies&status=completed
 *   /api/export?format=txt
 *   /api/export?format=json      ← the full backup, filters don't apply
 */
export const GET: RequestHandler = async ({ url }) => {
	const format = url.searchParams.get('format') ?? 'csv';

	const send = (body: string, type: string, extension: string) =>
		new Response(body, {
			headers: {
				'Content-Type': `${type}; charset=utf-8`,
				'Content-Disposition': `attachment; filename="${exportFilename(extension)}"`,
				// A file you asked for should never come from a stale cache.
				'Cache-Control': 'no-store'
			}
		});

	// A backup is the whole library by definition — restoring a filtered one
	// would quietly delete everything it left out.
	if (format === 'json') {
		return send(JSON.stringify(fullExport(), null, 2) + '\n', 'application/json', 'json');
	}

	const { rows } = rowsFor(url);

	if (format === 'csv') return send(toCsv(rows), 'text/csv', 'csv');
	if (format === 'txt') return send(toText(rows), 'text/plain', 'txt');

	error(400, 'Unknown export format.');
};
