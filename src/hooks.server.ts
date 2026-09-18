import { error, redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { pinIsSet, sessionToken, setupNeeded, readSettings } from '$lib/server/settings';
// Imported for its side effect: it starts listening for update progress from
// the desktop app at boot, not the first time someone opens Settings.
import '$lib/server/updater';
import { consumePdfToken } from '$lib/server/pdf';
import { scheduleBackfill } from '$lib/server/backfill';

// Runtimes, synopses and outside scores that the search results never carried
// get filled in shortly after the app opens, without anyone asking.
scheduleBackfill();

/** Icons and the web manifest stay reachable so "Add to Home Screen" works. */
const PUBLIC_PATHS = ['/manifest.webmanifest', '/favicon.ico', '/api/diagnostics'];
const isPublic = (path: string) => PUBLIC_PATHS.includes(path) || path.startsWith('/icon');

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Our own cross-site check, replacing the built-in one.
 *
 * The built-in check compares the browser's Origin against the full address the
 * server thinks it has — including the protocol, which it has to guess, and
 * guesses wrong for a plain http app. So we compare **hosts** instead.
 *
 * This still does the job that matters: a form posted by some other website
 * carries that site's Origin, which won't match the address your browser
 * actually connected to, and gets rejected. But reaching the app at
 * 127.0.0.1, at your wifi address, or over Tailscale all work, because in each
 * case the Origin host is the host you asked for.
 */
function checkSameOrigin(event: RequestEvent): void {
	const { request, url } = event;

	if (!WRITE_METHODS.has(request.method)) return;

	const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim();
	if (!FORM_TYPES.includes(contentType)) return;

	const origin = request.headers.get('origin');

	// Browsers always send Origin on a cross-origin form post. A request without
	// one didn't come from a page, so there's nothing to forge.
	if (!origin) return;

	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		error(403, 'Blocked a form submission with an unreadable origin.');
	}

	if (originHost !== url.host) {
		error(403, `Blocked a form submission from ${originHost}.`);
	}
}

/**
 * Runs before every request: the cross-site check, then the PIN lock. When no
 * PIN is set the lock does nothing at all — it's opt-in from Settings.
 */
export const handle: Handle = async ({ event, resolve }) => {
	checkSameOrigin(event);

	const theme = readSettings().theme;
	const resolveWith = (e: typeof event) =>
		resolve(e, {
			transformPageChunk: ({ html }) =>
				theme
					? html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`)
					: html
		});

	// A brand-new copy of Catalog says hello before it shows an empty library.
	// Answering the welcome screen is what turns this off, permanently.
	if (
		setupNeeded() &&
		event.url.pathname !== '/welcome' &&
		!isPublic(event.url.pathname) &&
		!event.url.pathname.startsWith('/api/')
	) {
		redirect(303, '/welcome');
	}

	/**
	 * The hidden window that renders a PDF carries no cookies, so with a PIN
	 * set it would be redirected to the login page and we'd produce a PDF of
	 * that. Its one-time token gets it past the lock, once.
	 */
	const pdfToken = event.url.searchParams.get('pdfToken');
	if (pdfToken && consumePdfToken(pdfToken)) return resolveWith(event);

	if (pinIsSet() && !isPublic(event.url.pathname)) {
		const onLoginPage = event.url.pathname === '/login';
		const signedIn = event.cookies.get('catalog_auth') === sessionToken();

		if (!signedIn && !onLoginPage) {
			const next = event.url.pathname + event.url.search;
			redirect(303, `/login?next=${encodeURIComponent(next)}`);
		}

		if (signedIn && onLoginPage) redirect(303, '/');
	}

	return resolveWith(event);
};
