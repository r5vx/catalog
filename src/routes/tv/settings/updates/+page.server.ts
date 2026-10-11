import { hostname } from 'node:os';
import { appVersion, updateMode } from '$lib/server/updater';
import { whatsNew } from '$lib/server/whatsnew';
import type { PageServerLoad } from './$types';

/** The TV's Updates screen: which Catalog the computer runs, and what changed lately. */
export const load: PageServerLoad = async () => ({
	version: appVersion(),
	mode: updateMode(),
	computer: hostname(),
	releases: whatsNew()
		.filter((release) => release.version !== 'Unreleased')
		.slice(0, 4)
});
