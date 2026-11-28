import { readSettings } from '$lib/server/settings';
import { listCategories, countsByCategory, sharedCatalogCount, continueWatchingList, listProfiles } from '$lib/server/db/queries';
import { currentProfile, onThisComputer } from '$lib/server/profile';
import { countNotes } from '$lib/server/db/notes';
import { DEFAULT_ACCENT, isHexColour } from '$lib/accent';
import { backgroundFrom } from '$lib/background';
import { logoFrom } from '$lib/logo';
import { readCustomTheme } from '$lib/customTheme';
import { warmBrowseCache, hasTmdbKey } from '$lib/server/metadata';
import { warmTubi } from '$lib/server/sources/tubi';
import { showboxSignin } from '$lib/server/showboxSignin';
import { onlineConnected, keptMe, warmMe, statusOf, friendCountOf } from '$lib/server/online';
import { whatsNewCard, whatsNewSeen, WHATS_NEW_SEEN } from '$lib/server/whatsNewCard';
import type { LayoutServerLoad } from './$types';

let browseWarmed = false;

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
export const load: LayoutServerLoad = async ({ request, getClientAddress, cookies }) => {
	const settings = readSettings();
	const seen = cookies.get(WHATS_NEW_SEEN);
	const updateCard = whatsNewCard(seen);
	if (!seen && !updateCard) whatsNewSeen(cookies);
	const saved = settings.accentColor ?? '';

	if (!browseWarmed) {
		browseWarmed = true;
		warmBrowseCache();
		warmTubi();
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
			// Shared catalogs and online friends together: the people on the Friends tab.
			friendCount: sharedCatalogCount() + (onlineConnected() ? (friendCountOf(currentProfile()) ?? 0) : 0),
			watchingCount: watching.size
		};
	}

	// Online: who you are there, for the My profile button (id '' until the server has said).
	const online = onlineConnected();
	if (online) warmMe(currentProfile());
	const onlineMe = online ? (keptMe(currentProfile()) ?? { id: '', name: '', avatar: 0 }) : null;

	return {
		onlineMe,
		// The status beside My profile (online, away, dnd, invisible).
		onlineStatus: online ? statusOf(currentProfile()) : 'online',
		sideTabs,
		// No TMDB key: a banner says so (src/lib/TmdbBanner.svelte), as most pages need one.
		tmdbMissing: !hasTmdbKey(),
		accent: isHexColour(saved) ? saved : DEFAULT_ACCENT,
		hiddenSorts: (settings.hiddenSorts ?? '').split(',').filter(Boolean),
		hiddenTabs: (settings.hiddenTabs ?? '').split(',').filter(Boolean),
		tabOrder: (settings.tabOrder ?? '').split(',').filter(Boolean),
		theme: settings.theme ?? '',
		customTheme: settings.theme === 'custom' ? readCustomTheme(settings.customTheme) : null,
		// Wide with the sidebar unless turned off (Settings → Personalization → Layout).
		wideLayout: settings.wideLayout !== '0',
		// Rating stars: 5, or 10 for halves like 8.5 (Settings → Personalization → Ratings).
		ratingStars: settings.ratingStars === '10' ? 10 : 5,
		sideNav,
		// Catasong in the sidebar, once pinned from the game itself.
		catasongPinned: settings.catasongPinned === '1',
		altMode: settings.altMode === '1',
		background: backgroundFrom(settings),
		// Your own logo, or Catalog's (Settings → Personalization → Logo).
		logo: logoFrom(settings),
		showboxSignin: showboxSignin(),
		whoIsWatching: whoIsWatching(request, getClientAddress),
		// After an update: a few lines once per device (WhatsNewCard.svelte).
		whatsNew: updateCard
	};
};
