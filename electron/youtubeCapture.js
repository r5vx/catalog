/*
 * In the computer's hidden YouTube window (youtubeHelper.cjs), after android/assets/youtube-tv.js:
 * copies every piece YouTube's own player puts into its video (MediaSource) to the computer, which
 * hands them to a Roku as a stream. YouTube's player does everything else itself (its sign-in,
 * its checks, its streaming), so nothing here depends on how YouTube delivers video.
 *
 * Asks for formats a Roku plays: H.264 picture and AAC sound (no VP9, AV1, HEVC or Opus).
 * `window.__catalogCapture` is set up by the computer (a DevTools binding) and takes text only,
 * so the bytes go as base64.
 */
(function () {
	if (window.__catalogCap) return;
	window.__catalogCap = { tracks: 0 };

	var ask = MediaSource.isTypeSupported;
	MediaSource.isTypeSupported = function (type) {
		if (/vp0?9|av01|opus|ec-3|ac-3|hev1|hvc1/i.test(String(type))) return false;
		return ask.call(MediaSource, type);
	};

	function send(o) {
		if (window.__catalogCapture) window.__catalogCapture(JSON.stringify(o));
	}
	function base64(u8) {
		var s = '';
		for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
		return btoa(s);
	}

	var add = MediaSource.prototype.addSourceBuffer;
	MediaSource.prototype.addSourceBuffer = function (mime) {
		var buffer = add.call(this, mime);
		var id = ++window.__catalogCap.tracks;
		send({ k: 'track', id: id, mime: mime });
		var append = buffer.appendBuffer;
		buffer.appendBuffer = function (data) {
			try {
				var u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
				send({ k: 'data', id: id, b64: base64(u8) });
			} catch (e) {}
			return append.call(this, data);
		};
		var abort = buffer.abort;
		buffer.abort = function () {
			send({ k: 'abort', id: id });
			return abort.call(this);
		};
		return buffer;
	};
})();
