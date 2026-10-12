import { fail } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import { LIMITS, SHARES, storageReport, keepWithinLimit, tellAppItsShare, clearKept } from '$lib/server/storage';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => ({
	report: storageReport(),
	limits: LIMITS.map((l) => ({ ...l })),
	shares: { ...SHARES }
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

	clear: async () => {
		clearKept();
		return { cleared: true };
	}
};
