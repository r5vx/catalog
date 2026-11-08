// Catalog's YouTube ad stripping (prototype): YouTube's own data, with the ad parts taken out
// before YouTube's page reads them. Runs in the page before YouTube's scripts.
(function () {
	if (window.__catalogAds) return;
	const stats = (window.__catalogAds = { removed: 0, seenAds: 0, players: 0, log: [] });
	const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adInferredBlockingStatus'];
	function prune(o, depth) {
		if (!o || typeof o !== 'object' || depth > 40) return;
		if (Array.isArray(o)) {
			for (let i = o.length - 1; i >= 0; i--) {
				const it = o[i];
				if (it && typeof it === 'object' && (it.adSlotRenderer || it.tvMastheadRenderer || it.promotedSparklesWebRenderer || it.adBreakServiceRenderer)) {
					o.splice(i, 1);
					stats.removed++;
				} else prune(it, depth + 1);
			}
			return;
		}
		for (const k of AD_KEYS) {
			if (k in o) {
				if (Array.isArray(o[k]) ? o[k].length : o[k]) stats.seenAds++;
				delete o[k];
				stats.removed++;
			}
		}
		if (o.playabilityStatus && o.streamingData) { stats.players++; }
		for (const k in o) prune(o[k], depth + 1);
	}
	const parse = JSON.parse;
	JSON.parse = function () {
		const out = parse.apply(this, arguments);
		try { prune(out, 0); } catch (e) {}
		return out;
	};
	const rj = Response.prototype.json;
	Response.prototype.json = function () {
		return rj.call(this).then((out) => { try { prune(out, 0); } catch (e) {} return out; });
	};
})();
