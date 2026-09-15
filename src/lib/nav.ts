import { browser } from '$app/environment';

const KEY = 'catalog:libraryQuery';

/**
 * Remembers how you had the library set up — sort, filters, search — so
 * "← Library" puts you back where you were rather than resetting to
 * "Recently added" every time you open something.
 */
export function rememberLibrary(search: string): void {
	if (!browser) return;
	try {
		sessionStorage.setItem(KEY, search);
	} catch {
		// Private browsing, or storage disabled. Not worth failing over.
	}
}

export function libraryHref(): string {
	if (!browser) return '/';
	try {
		const search = sessionStorage.getItem(KEY) ?? '';
		return search ? `/${search}` : '/';
	} catch {
		return '/';
	}
}
