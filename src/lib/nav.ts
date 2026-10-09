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

const SETTINGS_KEY = 'catalog:beforeSettings';

/** Notes the page (and how far down it) you were on when you opened Settings. */
export function rememberBeforeSettings(url: string, scrollY: number): void {
	if (!browser) return;
	try {
		sessionStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, scrollY }));
	} catch {}
}

/** Where Settings' back link goes: the page you came from, scrolled to where you were. */
export function beforeSettings(): { url: string; scrollY: number } {
	if (!browser) return { url: '/', scrollY: 0 };
	try {
		const saved = JSON.parse(sessionStorage.getItem(SETTINGS_KEY) ?? 'null');
		if (saved && typeof saved.url === 'string' && saved.url.startsWith('/')) return saved;
	} catch {}
	return { url: '/', scrollY: 0 };
}
