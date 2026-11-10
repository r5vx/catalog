/*
 * Catalog's part of YouTube on the TV. YouTube's own TV app (https://www.youtube.com/tv) runs as
 * it is, with everything it has (accounts, subscriptions, search, Shorts, live); the TV app puts
 * this at the top of its page, before any of YouTube's own scripts. Two jobs:
 *
 * 1. Formats. YouTube's TV app asks which videos the TV can play the way TVs answer
 *    ("video/webm; codecs=vp9; width=3840; framerate=60"), and checks the answers with nonsense
 *    values a real TV refuses. A web view ignores the extra details and says yes to everything,
 *    so YouTube refused to play ("This video format is not supported"). Here the details are
 *    judged like a TV does (up to 1080p, 60 fps, no HDR) and the rest asked of the web view.
 *
 * 2. Ads. YouTube sends the ads inside its own data (adPlacements, playerAds, adSlots). They are
 *    taken out before YouTube's page reads that data, so it never knows there were any.
 *    Proven 2026-11-03 (scripts/dev/youtube-tv): without this a 15 s ad came before the video;
 *    with it, the video started at once.
 *
 * The computer's YouTube window (electron/youtubeWindow.cjs) runs this too, on YouTube's normal
 * website, where nothing of YouTube's data is changed (see "ads on the website" below for why): ad
 * tiles are hidden, and a video ad is covered, muted and hurried past.
 *
 * If YouTube changes how it sends ads, this is the file to change. The TV app has to be rebuilt
 * (npm run tv) for a change here to reach the TVs.
 */
(function () {
	if (window.__catalogYouTube) return;
	window.__catalogYouTube = { adsRemoved: 0 };

	// YouTube's own "exit" closes the page: back to Catalog instead.
	if (window.CatalogYouTube) {
		window.close = function () { window.CatalogYouTube.close(); };
	}

	/* ---------------------------------------------------------------- passkeys */
	// Google's sign-in page asks for a passkey "as you type" the moment it opens (conditional
	// mediation). Chrome shows that as a quiet suggestion under the email box; Catalog's window has
	// no such suggestion, so Windows popped up its full passkey dialog while the email was being
	// typed, for accounts with no passkey at all. Here that kind of ask is said to be unavailable and
	// is left waiting; a passkey asked for on purpose ("Use your passkey") still works.
	try {
		if (window.PublicKeyCredential) {
			PublicKeyCredential.isConditionalMediationAvailable = function () { return Promise.resolve(false); };
		}
		var creds = navigator.credentials;
		if (creds && creds.get) {
			var getCredential = creds.get.bind(creds);
			creds.get = function (options) {
				if (!options || options.mediation !== 'conditional') return getCredential(options);
				return new Promise(function (_resolve, reject) {
					var signal = options.signal;
					if (signal) signal.addEventListener('abort', function () {
						reject(new DOMException('The operation was aborted.', 'AbortError'));
					});
				});
			};
		}
	} catch (e) {}

	/* ---------------------------------------------------------------- formats */
	// Only when YouTube is told this is a TV (the Fire TV, the Roku's hidden player). The
	// computer's YouTube window is YouTube's normal website, which asks like any browser.
	var asTv = /SMART-TV|Tizen|Web0S/i.test(navigator.userAgent);
	if (asTv && window.MediaSource && MediaSource.isTypeSupported) {
		var ask = MediaSource.isTypeSupported.bind(MediaSource);
		var RULES = {
			width: function (v) { return +v > 0 && +v <= 1920; },
			height: function (v) { return +v > 0 && +v <= 1080; },
			framerate: function (v) { return +v > 0 && +v <= 60; },
			bitrate: function (v) { return +v > 0 && +v <= 100000000; },
			channels: function (v) { return +v > 0 && +v <= 8; },
			samplerate: function (v) { return +v > 0 && +v <= 96000; },
			eotf: function (v) { return /^bt709$/i.test(v); },
			cryptoblockformat: function (v) { return /^subsample$/i.test(v); },
			'decode-to-texture': function (v) { return /^(true|false)$/i.test(v); },
			experimental: function (v) { return /^allowed$/i.test(v); },
			tunnelmode: function (v) { return /^false$/i.test(v); },
			features: function () { return true; }
		};
		MediaSource.isTypeSupported = function (type) {
			var parts = String(type).split(';');
			var plain = [];
			var ok = true;
			for (var i = 0; i < parts.length; i++) {
				var p = parts[i].trim();
				if (!p) continue;
				var m = p.match(/^([a-z-]+)=(.*)$/i);
				var rule = m && RULES[m[1].toLowerCase()];
				if (!rule) { plain.push(p); continue; }
				if (!rule(m[2].replace(/^"|"$/g, ''))) ok = false;
			}
			return ok && ask(plain.join('; '));
		};
	}

	/* ---------------------------------------------------------------- ads on the website */
	// The computer's YouTube window is YouTube's normal website. Its videos are asked for with
	// `params: "eAFgAQ"` (from AdGuard's YouTube rules, 2026-11-05), and YouTube then answers with no ads
	// at all: 8 of 8 videos in 0.8-1.0 s, Despacito included (it had an ad on every fresh visit
	// before). Asked that way YouTube also starts the video muted and adds an "Are you still watching?"
	// prompt; both are taken off the answer. A video YouTube refuses when asked that way is asked
	// again the normal way, once. Nothing else of YouTube's data is touched: taking the ads OUT of an
	// answer makes YouTube's video server hold every video back ~5.5 s (proven 2026-11-05: it answers
	// "come back in 4000 ms" and counts down if asked sooner).
	// Safety net when an ad comes anyway (Shorts, a refusal): it's covered in black, muted and run at
	// 16x, and the window presses Skip with a real click (youtubeWindow.cjs); YouTube's server still
	// sends the video ~5 s after the ad starts. Ad tiles are hidden from view, not removed.
	// Phones get YouTube's mobile website through Catalog's own address (src/lib/server/youtubePhone.ts),
	// which marks the page before this runs.
	var onYouTube = /(^|\.)youtube\.com$/.test(location.hostname) || window.__catalogProxied === 1;

	if (!asTv && onYouTube) {
		var HIDE = [
			'#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
			'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)', 'ytd-banner-promo-renderer',
			'ytd-statement-banner-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer',
			'ytd-promoted-video-renderer', 'ytd-compact-promoted-video-renderer', 'ytd-display-ad-renderer',
			'ytd-search-pyv-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', '#player-ads',
			'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]', 'ytd-companion-slot-renderer',
			'ytd-action-companion-ad-renderer', 'ytd-merch-shelf-renderer', 'ytd-brand-video-shelf-renderer',
			'ytd-brand-video-singleton-renderer', '.ytp-ad-overlay-container', '.ytp-suggested-action',
			// YouTube's own promotions ("Want music made for your desktop?", Premium offers).
			'ytd-mealbar-promo-renderer', 'yt-mealbar-promo-renderer', 'tp-yt-paper-dialog:has(ytd-mealbar-promo-renderer)',
			// The mobile website (phones): ad tiles, sponsored cards, and "Open App" / app promotions.
			'ad-slot-renderer', 'ytm-promoted-sparkles-web-renderer', 'ytm-promoted-video-renderer', 'ytm-companion-slot',
			'ytm-companion-ad-renderer', 'ytm-rich-item-renderer:has(ad-slot-renderer)', 'ytm-mealbar-promo-renderer',
			'ytm-statement-banner-renderer', 'ytm-brand-video-shelf-renderer', 'a[href^="vnd.youtube"]',
			'ytm-item-section-renderer:has(> lazy-list > ad-slot-renderer:only-child)'
		];
		var css = document.createElement('style');
		css.textContent =
			HIDE.join(',') + '{display:none!important}' +
			// While an ad plays it's covered in black. (Not hidden: an ad nobody can see pauses itself.)
			'#movie_player.ad-showing::after{content:"";position:absolute;inset:0;background:#000;z-index:1000;pointer-events:none}';
		var addCss = function () {
			if (!css.isConnected) (document.head || document.documentElement).appendChild(css);
		};
		if (document.documentElement) addCss();
		document.addEventListener('DOMContentLoaded', addCss);

		var hurried = null; // the video sped up for an ad, and how it was before
		var hurry = function () {
			var player = document.getElementById('movie_player');
			var video = player && player.querySelector('video');
			var ad = !!(player && player.classList.contains('ad-showing'));
			if (ad && video) {
				if (!hurried || hurried.video !== video) {
					hurried = { video: video, muted: video.muted, rate: video.playbackRate === 16 ? 1 : video.playbackRate };
					window.__catalogYouTube.adsHurried = (window.__catalogYouTube.adsHurried || 0) + 1;
				}
				video.muted = true;
				if (video.playbackRate !== 16) video.playbackRate = 16;
				if (video.paused) video.play().catch(function () {});
			} else if (hurried) {
				// The ad is over: the video as it was.
				hurried.video.playbackRate = hurried.rate;
				hurried.video.muted = hurried.muted;
				hurried = null;
			}
		};
		setInterval(hurry, 50);

		var NO_ADS = 'eAFgAQ';
		var plain = {}; // videos YouTube refused when asked without ads: asked the normal way
		var asked = {}; // videos asked without ads, by id
		var lastAsked = null;
		var notShorts = function () { return !/^\/shorts\//.test(location.pathname); };
		// The video request inside what the page is about to send (the request itself, or the
		// player part of a page-and-player request).
		var playerRequest = function (o, depth) {
			if (!o || typeof o !== 'object' || depth > 3) return null;
			if (o.playbackContext && typeof o.playbackContext === 'object') return o;
			for (var k in o) {
				var found = playerRequest(o[k], depth + 1);
				if (found) return found;
			}
			return null;
		};
		var stringify = JSON.stringify;
		JSON.stringify = function (value) {
			try {
				var req = notShorts() && value && typeof value === 'object' && !Array.isArray(value) && playerRequest(value, 0);
				var id = req && req.videoId;
				if (id && !plain[id] && !/^YAHI/.test(req.params || '')) {
					req.params = NO_ADS;
					req.playbackContext.params = NO_ADS;
					var content = req.playbackContext.contentPlaybackContext;
					if (content) content.lactMilliseconds = String(Date.now());
					var client = (value.context || req.context || {}).client;
					if (client && client.configInfo) delete client.configInfo.appInstallData;
					asked[id] = true;
					lastAsked = id;
				}
			} catch (e) {}
			return stringify.apply(this, arguments);
		};

		var askAgain = function (id) {
			var tries = 0;
			var go = function () {
				var p = document.getElementById('movie_player');
				if (p && p.loadVideoById) {
					var t = new URLSearchParams(location.search).get('t');
					try { p.loadVideoById({ videoId: id, startSeconds: parseInt(t || '0', 10) || 0 }); } catch (e) {}
				} else if (++tries < 50) setTimeout(go, 100);
			};
			setTimeout(go, 0);
		};
		// YouTube's answers about a video: the muted start and the prompt off; a refusal asked again.
		var answered = function (o) {
			if (!o || typeof o !== 'object') return;
			var list = [o, o.playerResponse];
			if (Array.isArray(o)) for (var i = 0; i < o.length; i++) if (o[i] && o[i].playerResponse) list.push(o[i].playerResponse);
			for (var n = 0; n < list.length; n++) {
				var r = list[n];
				if (!r || typeof r !== 'object' || !r.playabilityStatus) continue;
				var status = r.playabilityStatus.status;
				var refused = status === 'UNPLAYABLE' || status === 'ERROR';
				// A refusal may not say which video: the last one asked.
				var id = (r.videoDetails && r.videoDetails.videoId) || (refused ? lastAsked : null);
				if (!id || !asked[id] || plain[id]) continue;
				if (refused) {
					plain[id] = true;
					window.__catalogYouTube.askedAgain = (window.__catalogYouTube.askedAgain || 0) + 1;
					askAgain(id);
					continue;
				}
				var audio = r.playerConfig && r.playerConfig.audioConfig;
				if (audio && audio.muteOnStart && (location.pathname === '/watch' || (r.cards && !r.playabilityStatus.miniplayer))) delete audio.muteOnStart;
				if (r.messages && r.messages[0] && r.messages[0].youThereRenderer) delete r.messages[0].youThereRenderer;
				window.__catalogYouTube.askedWithoutAds = (window.__catalogYouTube.askedWithoutAds || 0) + 1;
			}
		};
		var parse = JSON.parse;
		JSON.parse = function () {
			var out = parse.apply(this, arguments);
			try { answered(out); } catch (e) {}
			return out;
		};
		if (window.Response && Response.prototype.json) {
			var readJson = Response.prototype.json;
			Response.prototype.json = function () {
				return readJson.call(this).then(function (out) {
					try { answered(out); } catch (e) {}
					return out;
				});
			};
		}
		// A video's page loaded whole (F5, a link from outside) comes with its answer written into the
		// page, ads and all: that video is asked for again, without ads, as soon as the player is there.
		try {
			var first;
			Object.defineProperty(window, 'ytInitialPlayerResponse', {
				configurable: true,
				get: function () { return first; },
				set: function (v) {
					first = v;
					try {
						var id = v && v.videoDetails && v.videoDetails.videoId;
						if (id && location.pathname === '/watch' && (v.adPlacements || v.playerAds || v.adSlots) && !asked[id]) {
							asked[id] = true;
							askAgain(id);
						}
					} catch (e) {}
				}
			});
		} catch (e) {}
		// Asked that way, YouTube's player checks the page is in view (AdGuard's rule makes it so too).
		try {
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
		} catch (e) {}
	}


	/* ---------------------------------------------------------------- ads (TV app) */
	// YouTube's TV app (the Fire TV, the Roku's hidden player): the ads are taken out of its data
	// before its page reads it (the TV app doesn't hold videos back for it).
	if (!asTv) return;
	var AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
	var AD_ITEMS = ['adSlotRenderer', 'tvMastheadRenderer', 'promotedSparklesWebRenderer', 'adBreakServiceRenderer',
		'bannerPromoRenderer', 'statementBannerRenderer', 'brandVideoShelfRenderer', 'brandVideoSingletonRenderer',
		'promotedVideoRenderer', 'compactPromotedVideoRenderer', 'searchPyvRenderer', 'movingThumbnailAdRenderer'];
	function hasAd(it) {
		if (!it || typeof it !== 'object') return false;
		for (var i = 0; i < AD_ITEMS.length; i++) if (it[AD_ITEMS[i]]) return true;
		return false;
	}
	function isAdItem(it) {
		if (hasAd(it)) return true;
		// The website wraps them: a home-page tile (richItemRenderer.content), a side panel.
		if (it && it.richItemRenderer && hasAd(it.richItemRenderer.content)) return true;
		if (it && it.richSectionRenderer && hasAd(it.richSectionRenderer.content)) return true;
		var panel = it && it.engagementPanelSectionListRenderer;
		if (panel && panel.content && panel.content.adsEngagementPanelContentRenderer) return true;
		return false;
	}
	function prune(o, depth) {
		if (!o || typeof o !== 'object' || depth > 40) return;
		if (Array.isArray(o)) {
			for (var i = o.length - 1; i >= 0; i--) {
				if (isAdItem(o[i])) {
					o.splice(i, 1);
					window.__catalogYouTube.adsRemoved++;
				} else prune(o[i], depth + 1);
			}
			return;
		}
		for (var k = 0; k < AD_KEYS.length; k++) {
			if (AD_KEYS[k] in o) {
				delete o[AD_KEYS[k]];
				window.__catalogYouTube.adsRemoved++;
			}
		}
		for (var key in o) prune(o[key], depth + 1);
	}
	var parse = JSON.parse;
	JSON.parse = function () {
		var out = parse.apply(this, arguments);
		try { prune(out, 0); } catch (e) {}
		return out;
	};
	// The website's first page comes with its data written into the page itself
	// (ytInitialPlayerResponse, ytInitialData), not through JSON.parse: catch it as it is set.
	['ytInitialPlayerResponse', 'ytInitialData'].forEach(function (name) {
		var value;
		try {
			Object.defineProperty(window, name, {
				configurable: true,
				get: function () { return value; },
				set: function (v) {
					try { prune(v, 0); } catch (e) {}
					value = v;
				}
			});
		} catch (e) {}
	});
	if (window.Response && Response.prototype.json) {
		var json = Response.prototype.json;
		Response.prototype.json = function () {
			return json.call(this).then(function (out) {
				try { prune(out, 0); } catch (e) {}
				return out;
			});
		};
	}
})();
