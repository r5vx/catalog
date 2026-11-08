// YouTube's TV app asks about formats the way TVs answer ("...; width=3840; framerate=60"), and
// checks the answers with nonsense values a real TV refuses. A browser ignores the extra details,
// so it said yes to everything and YouTube refused to play. Here the details are judged like a TV
// does (up to 1080p, 60 fps, SDR) and the rest asked of the browser as usual.
(function () {
	if (window.__catalogFormats || !window.MediaSource) return;
	window.__catalogFormats = { asked: [] };
	const ask = MediaSource.isTypeSupported.bind(MediaSource);
	const RULES = {
		width: (v) => +v > 0 && +v <= 1920,
		height: (v) => +v > 0 && +v <= 1080,
		framerate: (v) => +v > 0 && +v <= 60,
		bitrate: (v) => +v > 0 && +v <= 100_000_000,
		channels: (v) => +v > 0 && +v <= 8,
		samplerate: (v) => +v > 0 && +v <= 96_000,
		eotf: (v) => /^bt709$/i.test(v),
		cryptoblockformat: (v) => /^subsample$/i.test(v),
		'decode-to-texture': (v) => /^(true|false)$/i.test(v),
		experimental: (v) => /^allowed$/i.test(v),
		tunnelmode: (v) => /^false$/i.test(v),
		features: () => true
	};
	MediaSource.isTypeSupported = function (type) {
		const parts = String(type).split(';').map((p) => p.trim()).filter(Boolean);
		const plain = [];
		let ok = true;
		for (const p of parts) {
			const m = p.match(/^([a-z-]+)=(.*)$/i);
			const rule = m && RULES[m[1].toLowerCase()];
			if (!rule) { plain.push(p); continue; }
			if (!rule(m[2].replace(/^"|"$/g, ''))) ok = false;
		}
		const answer = ok && ask(plain.join('; '));
		if (window.__catalogFormats.asked.length < 80) window.__catalogFormats.asked.push(type + ' -> ' + answer);
		return answer;
	};
})();
