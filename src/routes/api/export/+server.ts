import {
	toCsv,
	toText,
	fullExport,
	shareExport,
	shareFilename,
	exportFilename,
	rowsFor
} from '$lib/server/export';
import { renderPdf, desktopAvailable } from '$lib/server/pdf';
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

	// A copy to hand to a friend: the list and the public scores, plus your own
	// ratings and reviews only when you ask for them.
	if (format === 'share') {
		const share = shareExport({
			ratings: url.searchParams.get('ratings') === '1',
			notes: url.searchParams.get('notes') === '1',
			from: url.searchParams.get('from') ?? undefined
		});

		// A distinct name, so a share file is never mistaken for a backup.
		return new Response(JSON.stringify(share, null, 2) + '\n', {
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="${shareFilename(share.from)}"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	// Rendered by the desktop app from the printable page, so the PDF matches
	// what you'd get by printing it — without the print dialog in the way.
	if (format === 'pdf') {
		if (!desktopAvailable()) {
			error(400, 'Saving a PDF needs the desktop app. In a browser, use Print.');
		}

		const filters = new URLSearchParams(url.searchParams);
		filters.delete('format');

		try {
			const pdf = await renderPdf(`/export?${filters.toString()}`);

			return new Response(new Uint8Array(pdf), {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${exportFilename('pdf')}"`,
					'Cache-Control': 'no-store'
				}
			});
		} catch (problem) {
			error(500, problem instanceof Error ? problem.message : 'Could not make the PDF.');
		}
	}

	const { rows } = rowsFor(url);

	if (format === 'csv') return send(toCsv(rows), 'text/csv', 'csv');
	if (format === 'txt') return send(toText(rows), 'text/plain', 'txt');

	error(400, 'Unknown export format.');
};
