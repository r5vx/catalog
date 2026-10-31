import { readSettings } from '$lib/server/settings';
import { listCategories, countsByCategory, sharedCatalogCount, continueWatchingList, listProfiles } from '$lib/server/db/queries';
import { currentProfile, onThisComputer } from '$lib/server/profile';
import { countNotes } from '$lib/server/db/notes';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { backgroundFrom } from '$lib/background';
import { warmBrowseCache } from '$lib/server/metadata';
import { showboxSignin } from '$lib/server/showboxSignin';
import { publicNetwork } from '$lib/server/networkType';
import type { LayoutServerLoad } from './$types';

let browseWarmed = false;

const clientAddress = (getClientAddress: () => string) => {
	try {
		return getClientAddress();
	} catch {
		return '';
	}
};

/** On a phone, with more than one person in the house: who this device watches as. */
function whoIsWatching(request: Request, getClientAddress: () => string) {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	if (onThisComputer(request.headers, address)) return null;
	const profiles = listProfiles();
	if (profiles.length < 2) return null;
	return profiles.find((one) => one.id === currentProfile()) ?? null;
}

/** The accent colour and the sort list are wanted app-wide, so they load once. */
export const load: LayoutServerLoad = async ({ request, getClientAddress }) => {
	const settings = readSettings();
	const saved = settings.accentColor ?? '';

	if (!browseWarmed) {
		browseWarmed = true;
		warmBrowseCache();
	}

	// The sidebar's tabs and their counts, as the library's own tabs have them.
	const sideNav = settings.sideNav !== '0';
	let sideTabs = null;
	if (sideNav) {
		const countByCategory = countsByCategory();
		const watching = new Set(continueWatchingList().map((item) => `${item.title}:${item.type}`));
		sideTabs = {
			categories: listCategories(),
			countByCategory,
			total: Object.values(countByCategory).reduce((sum, n) => sum + n, 0),
			noteCount: countNotes(),
			friendCount: sharedCatalogCount(),
			watchingCount: watching.size
		};
	}

	return {
		sideTabs,
		accent: isHexColour(saved) ? saved : DEFAULT_ACCENT,
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		hiddenTabs: (settings.hiddenTabs ?? '').split(',').filter(Boolean),
		tabOrder: (settings.tabOrder ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		// Wide with the sidebar unless turned off (Settings → Personalization → Layout).
		wideLayout: settings.wideLayout !== '0',
		sideNav,
		poisonMode: settings.poisonMode === '1',
		background: backgroundFrom(settings),
		showboxSignin: showboxSignin(),
		whoIsWatching: whoIsWatching(request, getClientAddress),
		// The computer's own window only: Windows has set its network to Public (TVs can't connect).
		publicNetwork: onThisComputer(request.headers, clientAddress(getClientAddress)) ? publicNetwork() : null
	};
};
