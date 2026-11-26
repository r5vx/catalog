// Read the auto-caption response delivered to the current YouTube player when it selects an offered track.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BYTES = 4 * 1024 * 1024;
const language = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(value);

function captionLanguage(address, id) {
	try {
		const u = new URL(address), q = u.searchParams;
		if (u.origin === 'https://www.youtube.com' && u.pathname === '/api/timedtext' && q.get('v') === id && q.get('kind') === 'asr' && q.get('fmt') === 'json3' && !q.has('tlang') && language(q.get('lang'))) return q.get('lang');
	} catch {}
	return null;
}

function readCues(body) {
	if (!body || body.length > MAX_BYTES) return [];
	let events;
	try { events = JSON.parse(body).events; } catch { return []; }
	if (!Array.isArray(events) || events.length > 100000) return [];
	const cues = [];
	for (const e of events) {
		if (!e || !Number.isSafeInteger(e.tStartMs) || e.tStartMs < 0 || !Number.isSafeInteger(e.dDurationMs) || e.dDurationMs <= 0 || !Array.isArray(e.segs)) continue;
		const text = e.segs.map(s => typeof s?.utf8 === 'string' ? s.utf8 : '').join('').trim();
		if (text) cues.push({start:e.tStartMs / 1000, end:(e.tStartMs + e.dDurationMs) / 1000, text});
	}
	cues.sort((a,b) => a.start - b.start);
	// ASR window durations overlap to roll old words up; Catalog shows one line group at a time.
	for (let i = 1; i < cues.length; i++) cues[i-1].end = Math.min(cues[i-1].end, cues[i].start);
	return cues.filter(c => c.end > c.start);
}

// Runs inside the sandboxed YouTube page. Only track language codes leave it, never signed URLs.
function playerOption(id, lang, reload) {
	if (location.origin !== 'https://www.youtube.com') return null;
	const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
	const r = p?.getPlayerResponse?.();
	if (p?.matches('.ad-showing, .ad-interrupting') || !(document.querySelector('video')?.currentTime > 0) || !p?.setOption || p.getVideoData?.()?.video_id !== id || r?.videoDetails?.videoId !== id || r?.playabilityStatus?.status !== 'OK') return null;
	const offered = (r.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).filter(t => t.kind === 'asr');
	if (!lang && offered.length) p.loadModule?.('captions');
	if (lang && offered.some(t => t.languageCode === lang)) {
		const tracks = p.getOption?.('captions', 'tracklist', {includeAsr:true}) || [];
		if (reload && p.getOption?.('captions', 'track')?.languageCode === lang) p.setOption('captions', 'reload', true);
		else p.setOption('captions', 'track', tracks.find(t => t.languageCode === lang && (t.kind === 'asr' || t.vss_id?.startsWith('a.'))) || {languageCode:lang, kind:'asr'});
	}
	return offered.map(t => t.languageCode);
}

async function collectCaptions(page, id, current, budget = 30_000) {
	const wc = page.webContents, dbg = wc.debugger, pending = new Map(), found = new Map();
	const alive = () => current() && !page.isDestroyed();
	const option = (lang, reload = false) => wc.executeJavaScript(`(${playerOption.toString()})(${JSON.stringify(id)},${JSON.stringify(lang)},${reload})`);
	const receive = async (_event, method, params) => {
		if (!alive()) return;
		if (method === 'Network.responseReceived' && params.response.status === 200) {
			const lang = captionLanguage(params.response.url, id);
			if (lang) pending.set(params.requestId, lang);
		}
		if (method === 'Network.loadingFailed') pending.delete(params.requestId);
		if (method !== 'Network.loadingFinished' || !pending.has(params.requestId)) return;
		const lang = pending.get(params.requestId); pending.delete(params.requestId);
		if (params.encodedDataLength > MAX_BYTES) return;
		try {
			const r = await dbg.sendCommand('Network.getResponseBody', {requestId:params.requestId});
			const cues = readCues(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body);
			if (cues.length && alive()) found.set(lang, {lang, cues});
		} catch {}
	};
	const end = Date.now() + budget;
	if (!dbg.isAttached()) dbg.attach('1.3');
	dbg.on('message', receive);
	try {
		await dbg.sendCommand('Network.enable', {maxTotalBufferSize:2 * MAX_BYTES, maxResourceBufferSize:MAX_BYTES});
		let langs;
		while (alive() && Date.now() < end && !Array.isArray(langs)) {
			langs = await option(null).catch(() => null);
			if (!Array.isArray(langs)) await wait(200);
		}
		const offered = [...new Set((langs || []).filter(language))];
		for (const lang of offered) {
			if (!alive() || Date.now() >= end) break;
			const started = Date.now();
			await option(lang);
			let reloaded = false;
			while (alive() && !found.has(lang) && Date.now() < Math.min(end, started + 12000)) {
				if (!reloaded && Date.now() - started > 1200) { reloaded = true; await option(lang, true); }
				await wait(150);
			}
		}
		return offered.filter(lang => found.has(lang)).map(lang => found.get(lang));
	} finally {
		dbg.removeListener('message', receive);
		if (!page.isDestroyed()) await dbg.sendCommand('Network.disable').catch(() => {});
	}
}
module.exports = {collectCaptions, captionLanguage, readCues};
