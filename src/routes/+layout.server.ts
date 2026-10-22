import { readSettings } from '$lib/server/settings';
import { listCategories, countsByCategory, sharedCatalogCount, continueWatchingList } from '$lib/server/db/queries';
import { countNotes } from '$lib/server/db/notes';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { backgroundFrom } from '$lib/background';
import { warmBrowseCache } from '$lib/server/metadata';
import { showboxSignin } from '$lib/server/showboxSignin';
import type { LayoutServerLoad } from './$types';

let browseWarmed = false;

/** The accent colour and the sort list are wanted app-wide, so they load once. */
export const load: LayoutServerLoad = async () => {
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
		showboxSignin: showboxSignin()
	};
};
