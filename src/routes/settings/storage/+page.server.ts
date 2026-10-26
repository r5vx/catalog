import { fail } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { LIMITS, SHARES, storageReport, keepWithinLimit, tellAppItsShare, clearKept } from '$lib/server/storage';
import { DOWNLOAD_LIMITS_GB, downloadsAheadLimitGb } from '$lib/server/episodeDownloads';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => ({
	report: storageReport(),
	limits: LIMITS.map((l) => ({ ...l })),
	shares: { ...SHARES },
	downloadLimits: [...DOWNLOAD_LIMITS_GB],
	downloadLimitGb: downloadsAheadLimitGb()
});

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
