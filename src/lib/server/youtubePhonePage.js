// @ts-nocheck: a script for YouTube's page (old-style JS that runs in the phone's browser), not Catalog's.
/*
 * Put at the top of YouTube's mobile website when a phone opens it through Catalog
 * (src/lib/server/youtubePhone.ts), before any of YouTube's scripts:
 *
 * 1. Every request stays on Catalog's address. YouTube's page asks m.youtube.com, www.youtube.com,
 *    googlevideo.com (the video itself) and a few other Google hosts; those addresses are turned
 *    into Catalog's own (/__h/<host>/...) as the page asks, so the computer fetches them. The video
 *    has to come through the computer anyway: YouTube ties each video address to the internet
 *    address that asked for it, which is the computer's.
 * 2. A video request with a streamed body (YouTube's player sends them) is read whole first:
 *    browsers only send streamed bodies over HTTP/2, and Catalog's address is HTTP/1.1.
 * 3. The pink circle beside YouTube's logo goes back to Catalog, as on the computer.
 *
 * window.__catalogPhone = { catalog: "<Catalog's address>" } is set just before this.
 */
(function () {
	if (window.__catalogPhoneReady) return;
	window.__catalogPhoneReady = true;
	window.__catalogProxied = 1;
	var HERE = location.origin;
	var THROUGH = /(^|\.)(googlevideo\.com|youtube\.com|youtube-nocookie\.com|googleapis\.com|google\.com|doubleclick\.net|gstatic\.com)$/;
	var CATALOG = (window.__catalogPhone && window.__catalogPhone.catalog) || '/';

	function map(u) {
		try {
			if (typeof u !== 'string' && !(u instanceof URL)) return u;
			var s = String(u);
			if (!/^(https?:)?\/\//i.test(s)) return u;
			var url = new URL(s, location.href);
			if (url.origin === HERE) return u;
			if (url.host === 'm.youtube.com') return HERE + url.pathname + url.search + url.hash;
			if (THROUGH.test(url.hostname)) return HERE + '/__h/' + url.host + url.pathname + url.search + url.hash;
			return u;
		} catch (e) {
			return u;
		}
	}
	window.__catalogMap = map;

	var realFetch = window.fetch;
	window.fetch = function (input, init) {
		var self = this;
		try {
			if (input instanceof Request) {
				var mapped = map(input.url);
				// A request with a body: read it whole (see 2 above), then ask again by address.
				if (input.body && !(init && init.body)) {
					var req = input;
					return req.arrayBuffer().then(function (buf) {
						return realFetch.call(self, mapped, Object.assign({
							method: req.method, headers: req.headers, credentials: req.credentials, mode: req.mode,
							cache: req.cache, redirect: req.redirect, referrerPolicy: req.referrerPolicy, signal: req.signal
						}, init || {}, { body: buf }));
					});
				}
				if (mapped !== input.url) input = new Request(mapped, input);
			} else {
				input = map(input);
			}
		} catch (e) {}
		if (init && init.body && typeof init.body.getReader === 'function') {
			return new Response(init.body).arrayBuffer().then(function (buf) {
				var copy = Object.assign({}, init, { body: buf });
				delete copy.duplex;
				return realFetch.call(self, input, copy);
			});
		}
		return realFetch.call(this, input, init);
	};

	var open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url) {
		var args = Array.prototype.slice.call(arguments);
		args[1] = map(url);
		return open.apply(this, args);
	};

	if (navigator.sendBeacon) {
		var beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = function (url, data) { return beacon(map(url), data); };
	}

	// Video and its sources set by address (an iPhone may play YouTube's HLS straight in <video>).
	var srcOf = function (proto) {
		var desc = Object.getOwnPropertyDescriptor(proto, 'src');
		if (!desc || !desc.set) return;
		Object.defineProperty(proto, 'src', {
			configurable: true,
			get: function () { return desc.get.call(this); },
			set: function (v) { desc.set.call(this, map(v)); }
		});
	};
	srcOf(HTMLMediaElement.prototype);
	if (window.HTMLSourceElement) srcOf(HTMLSourceElement.prototype);
	var setAttribute = Element.prototype.setAttribute;
	Element.prototype.setAttribute = function (name, value) {
		if ((this instanceof HTMLMediaElement || (window.HTMLSourceElement && this instanceof HTMLSourceElement)) && String(name).toLowerCase() === 'src') {
			value = map(value);
		}
		return setAttribute.call(this, name, value);
	};

	if (window.Worker) {
		var RealWorker = window.Worker;
		window.Worker = function (u, o) { return new RealWorker(map(u), o); };
		window.Worker.prototype = RealWorker.prototype;
	}

	// YouTube's offline helper would answer requests without any of the above.
	try {
		if (navigator.serviceWorker) {
			navigator.serviceWorker.register = function () { return Promise.reject(new Error('Not here')); };
			navigator.serviceWorker.getRegistrations().then(function (list) {
				list.forEach(function (r) { r.unregister(); });
			}).catch(function () {});
		}
	} catch (e) {}

	// Cookies YouTube's page sets for .youtube.com are kept for this address instead.
	try {
		var cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
		Object.defineProperty(document, 'cookie', {
			configurable: true,
			get: function () { return cookie.get.call(document); },
			set: function (v) {
				v = String(v).replace(/;\s*domain=[^;]*/i, '');
				if (location.protocol === 'http:') v = v.replace(/;\s*secure/i, '').replace(/^__(Secure|Host)-/, '');
				cookie.set.call(document, v);
			}
		});
	} catch (e) {}

	// Links to YouTube's other addresses stay here; Google's sign-in comes here too (it can't
	// happen through another address, so Catalog says where to sign in instead).
	document.addEventListener('click', function (event) {
		var a = event.target && event.target.closest && event.target.closest('a[href]');
		if (!a || a.id === 'catalog-back') return;
		try {
			var url = new URL(a.getAttribute('href'), location.href);
			if (url.origin === HERE) return;
			var to = null;
			if (/^(www\.|m\.)?youtube\.com$/.test(url.hostname)) to = HERE + url.pathname + url.search + url.hash;
			else if (url.hostname === 'accounts.google.com') to = map(url.href);
			if (!to) return;
			event.preventDefault();
			event.stopPropagation();
			location.href = to;
		} catch (e) {}
	}, true);

	var realOpen = window.open;
	window.open = function (u) {
		var args = Array.prototype.slice.call(arguments);
		args[0] = map(u);
		return realOpen.apply(window, args);
	};

	/* ---------------------------------------------------------------- back to Catalog */
	var style = document.createElement('style');
	style.textContent =
		'#catalog-back{flex:none;width:28px;height:28px;margin:0 4px 0 10px;padding:0;border:0;border-radius:50%;' +
		'background:#e994c2;color:#141414;display:grid;place-items:center;-webkit-tap-highlight-color:transparent}' +
		'#catalog-back svg{width:15px;height:15px;display:block}';
	var addStyle = function () {
		if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
	};
	addStyle();
	document.addEventListener('DOMContentLoaded', addStyle);

	var NS = 'http://www.w3.org/2000/svg';
	var make = function () {
		var a = document.createElement('a');
		a.id = 'catalog-back';
		a.href = CATALOG;
		a.setAttribute('aria-label', 'Back to Catalog');
		var svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		var arrow = document.createElementNS(NS, 'path');
		arrow.setAttribute('d', 'M15 5l-7 7 7 7');
		arrow.setAttribute('fill', 'none');
		arrow.setAttribute('stroke', 'currentColor');
		arrow.setAttribute('stroke-width', '3');
		arrow.setAttribute('stroke-linecap', 'round');
		arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		a.appendChild(svg);
		// YouTube's page takes taps on links for itself: this one leaves for Catalog.
		a.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			location.href = CATALOG;
		}, true);
		return a;
	};
	var place = function () {
		var logo = document.querySelector('ytm-home-logo') || document.querySelector('.mobile-topbar-logo');
		if (!logo) return;
		var button = document.getElementById('catalog-back') || make();
		if (logo.nextElementSibling !== button) logo.after(button);
	};
	setInterval(place, 500);
})();
