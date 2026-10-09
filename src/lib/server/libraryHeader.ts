import {
	listCategories,
	countsByCategory,
	completedCount,
	completedByCategory,
	continueWatchingList,
	sharedCatalogCount
} from './db/queries';
import { countNotes } from './db/notes';

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
		friendCount: sharedCatalogCount()
	};
}
