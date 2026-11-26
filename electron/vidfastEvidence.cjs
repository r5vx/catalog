/** An embed page, a playlist-shaped error or a manifest alone is not proof of video. */
module.exports = function vidfastEvidence(pageUrl) {
	const expected = new URL(pageUrl);
	const manifests = new Map();
	return (currentPage, frameId, { url, status, mimeType = '' }) => {
		if (!frameId || (status !== 200 && status !== 206)) return null;
		try {
			const page = new URL(currentPage), media = new URL(url);
			if (page.origin !== expected.origin || page.pathname !== expected.pathname || media.protocol !== 'https:' || media.hostname === expected.hostname) return null;
			const key = `${frameId}|${media.origin}`;
			if (/mpegurl/i.test(mimeType) && !manifests.has(key)) manifests.set(key, url);
			return mimeType.startsWith('video/') ? manifests.get(key) ?? null : null;
		} catch { return null; }
	};
};
