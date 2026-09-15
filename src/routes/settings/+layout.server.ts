import { updateMode, appVersion } from '$lib/server/updater';
import type { LayoutServerLoad } from './$types';

/** The nav needs to know whether there's an Updates section to show. */
export const load: LayoutServerLoad = async () => ({
	updateMode: updateMode(),
	appVersion: appVersion()
});
