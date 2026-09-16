import { rowsFor } from '$lib/server/export';
import { desktopAvailable } from '$lib/server/pdf';
import { statusLabel } from '$lib/constants';
import type { ExportRow } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const { rows, category, status, sort } = rowsFor(url);

	// Rows come back ordered by category, so a heading starts wherever the
	// category changes — no second pass and no sorting done twice.
	const groups: { name: string; rows: ExportRow[] }[] = [];

	for (const row of rows) {
		const last = groups.at(-1);
		if (last && last.name === row.category) last.rows.push(row);
		else groups.push({ name: row.category, rows: [row] });
	}

	// Printed out, the page has to say what it's a list *of*.
	const scope = [category?.name ?? 'Everything', status ? statusLabel(status) : '', sort.label]
		.filter(Boolean)
		.join(' · ');

	return {
		groups,
		total: rows.length,
		scope,
		query: url.search,
		canMakePdf: desktopAvailable()
	};
};
