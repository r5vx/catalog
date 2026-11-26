import {
	listCategories,
	countsByCategory,
	completedCount,
	completedByCategory,
	continueWatchingList,
	sharedCatalogCount
} from './db/queries';
import { countNotes } from './db/notes';
import { friendCountOf, onlineConnected } from './online';
import { currentProfile } from './profile';

/** Everything the header and category tabs show, for the pages that share them. */
export function libraryHeaderData() {
	const countByCategory = countsByCategory();
	return {
		categories: listCategories(),
		countByCategory,
		total: Object.values(countByCategory).reduce((sum, n) => sum + n, 0),
		completed: completedCount(),
		completedByCategory: completedByCategory(),
		noteCount: countNotes(),
		watchingCount: continueWatchingList().length,
		// Shared catalogs and online friends together: the people on the Friends tab.
		friendCount: sharedCatalogCount() + (onlineConnected() ? (friendCountOf(currentProfile()) ?? 0) : 0)
	};
}
