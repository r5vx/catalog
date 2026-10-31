/*
 * The phone app's helper (registered by src/routes/+layout.svelte, only on the secure Tailscale
 * address: Settings → Phones). It does one thing: when a page can't be had (no connection, the
 * computer off), the offline page answers instead, which plays what's kept on the phone
 * (offline.html). Online, everything comes from Catalog as usual; nothing else is kept.
 */
const CACHE = 'catalog-offline-2';
const OFFLINE = ['/offline.html', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(OFFLINE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// The offline page itself: fresh when the computer answers, kept copy otherwise.
	if (OFFLINE.includes(url.pathname)) {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok) caches.open(CACHE).then((cache) => cache.put(url.pathname, response.clone()));
					return response;
				})
				.catch(() => caches.match(url.pathname))
		);
		return;
	}
	// A page: from Catalog, or the offline page when Catalog can't be reached. (Not after 8 s of
	// nothing either: a weak signal shouldn't keep the downloads out of reach.)
	if (request.mode === 'navigate') {
		event.respondWith(
			Promise.race([
				fetch(request),
				new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 8000))
			]).catch(() => caches.match('/offline.html'))
		);
	}
});
