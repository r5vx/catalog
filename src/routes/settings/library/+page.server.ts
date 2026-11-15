import { fail } from '@sveltejs/kit';
import { listCategories } from '$lib/server/db/queries';
import { missingCount } from '$lib/server/backfill';
import { desktopAvailable } from '$lib/server/pdf';
import { dbPath, dataDir } from '$lib/server/db';
import { updateSettings } from '$lib/server/settings';
import { LIMITS, SHARES, storageReport, keepWithinLimit, tellAppItsShare, clearKept } from '$lib/server/storage';
import { DOWNLOAD_LIMITS_GB, downloadsAheadLimitGb } from '$lib/server/episodeDownloads';
import type { PageServerLoad, Actions } from './$types';

/** Settings → Library: the library itself (export, sharing, its files) and the space kept beside it (Storage.svelte). */
export const load: PageServerLoad = async () => ({
	// The export picker offers the same categories the library has.
	categories: listCategories(),
	// Only the desktop app can render a PDF; a browser gets the print page.
	canMakePdf: desktopAvailable(),
	// How many titles are still missing a runtime, synopsis or scores.
	missing: missingCount(),
	dbPath,
	dataDir,

	// Storage: what's kept to load faster, and the episodes downloaded ahead.
	report: storageReport(),
	limits: LIMITS.map((l) => ({ ...l })),
	shares: { ...SHARES },
	downloadLimits: [...DOWNLOAD_LIMITS_GB],
	downloadLimitGb: downloadsAheadLimitGb()
});

/** Storage's forms. */
export const actions: Actions = {
	limit: async ({ request }) => {
		const mb = Number((await request.formData()).get('mb'));
		if (!LIMITS.some((l) => l.mb === mb)) return fail(400, { error: 'Pick one of the sizes.' });
		updateSettings({ storageLimitMb: String(mb) });
		tellAppItsShare();
		keepWithinLimit();
		return { saved: true };
	},

	downloads: async ({ request }) => {
		const gb = Number((await request.formData()).get('gb'));
		if (!(DOWNLOAD_LIMITS_GB as readonly number[]).includes(gb)) return fail(400, { error: 'Pick one of the sizes.' });
		updateSettings({ downloadsAheadGb: String(gb) });
		return { saved: true };
	},

	clear: async () => {
		clearKept();
		return { cleared: true };
	}
};
