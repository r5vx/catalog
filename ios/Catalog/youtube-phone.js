/*
 * Catalog's iPhone app, on YouTube's mobile website (ios/Catalog/WebViews.swift puts this at the top
 * of each page, after android/assets/youtube-tv.js, which is what takes the ads out).
 *
 * One job: the pink circle beside YouTube's logo goes back to Catalog, as on the computer.
 * YouTube stays as it was left, so opening it again is instant.
 */
(function () {
	if (window.__catalogPhoneApp) return;
	window.__catalogPhoneApp = true;
	if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

	var close = function () {
		try {
			window.webkit.messageHandlers.catalog.postMessage('close');
		} catch (e) {}
	};

	var style = document.createElement('style');
	style.textContent =
		'#catalog-back{flex:none;width:28px;height:28px;margin:0 4px 0 10px;padding:0;border:0;border-radius:50%;' +
		'background:#e994c2;color:#141414;display:grid;place-items:center;-webkit-tap-highlight-color:transparent}' +
		'#catalog-back svg{width:15px;height:15px;display:block}';
	var addStyle = function () {
		if (!style.isConnected && (document.head || document.documentElement)) (document.head || document.documentElement).appendChild(style);
	};
	addStyle();
	document.addEventListener('DOMContentLoaded', addStyle);

	var NS = 'http://www.w3.org/2000/svg';
	var make = function () {
		var button = document.createElement('button');
		button.id = 'catalog-back';
		button.type = 'button';
		button.setAttribute('aria-label', 'Back to Catalog');
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
		button.appendChild(svg);
		// YouTube's page takes taps for itself: this one leaves for Catalog.
		button.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}, true);
		return button;
	};
	var place = function () {
		var logo = document.querySelector('ytm-home-logo') || document.querySelector('.mobile-topbar-logo');
		if (!logo) return;
		var button = document.getElementById('catalog-back') || make();
		if (logo.nextElementSibling !== button) logo.after(button);
	};
	setInterval(place, 500);
})();
