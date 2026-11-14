/**
 * Catalog's iPhone app (the `ios/` folder): Catalog's pages inside a real app, which can also open
 * YouTube's own website with no ads (a web page in Safari can't).
 *
 * The app marks its user agent with "CatalogPhone/", and takes one-word messages from the page:
 *   "youtube"  open YouTube over Catalog
 *   "setup"    pick another computer
 */

/** The mark the app adds to its user agent (ios/Catalog/WebViews.swift `appMark`). */
export const PHONE_APP_MARK = /CatalogPhone\//;

type AppWindow = Window & {
	webkit?: { messageHandlers?: { catalog?: { postMessage: (message: string) => void } } };
};

/** Whether this page is showing inside the iPhone app. */
export function inPhoneApp(): boolean {
	if (typeof window === 'undefined') return false;
	return PHONE_APP_MARK.test(navigator.userAgent) && Boolean((window as AppWindow).webkit?.messageHandlers?.catalog);
}

/** Says it to the app. False when this isn't the app (nothing happened). */
export function tellPhoneApp(message: 'youtube' | 'setup'): boolean {
	if (!inPhoneApp()) return false;
	try {
		(window as AppWindow).webkit!.messageHandlers!.catalog!.postMessage(message);
		return true;
	} catch {
		return false;
	}
}

/**
 * In the app, a tap on any link to Catalog's YouTube page opens the app's own YouTube instead of
 * going to that page. Returns the function that stops listening.
 */
export function startPhoneApp(): () => void {
	if (!inPhoneApp()) return () => {};
	const onClick = (event: MouseEvent) => {
		const link = (event.target as Element | null)?.closest?.('a[href]');
		if (!link) return;
		const path = new URL(link.getAttribute('href') ?? '', location.href);
		if (path.origin !== location.origin || path.pathname !== '/youtube') return;
		if (!tellPhoneApp('youtube')) return;
		event.preventDefault();
		event.stopPropagation();
	};
	document.addEventListener('click', onClick, true);
	return () => document.removeEventListener('click', onClick, true);
}
