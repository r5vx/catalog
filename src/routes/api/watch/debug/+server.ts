import { json } from '@sveltejs/kit';
import { electronFetch, electronSyncCookies, electronDebugCookies } from '$lib/server/electron-fetch';
import { readSettings } from '$lib/server/settings';
import { getStreamUrl, invalidateStreamCache } from '$lib/server/showbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const { febboxToken } = readSettings();
	const fid = Number(url.searchParams.get('fid')) || 0;
	const shareKey = url.searchParams.get('share_key') || '';

	const info: Record<string, unknown> = {
		hasToken: Boolean(febboxToken),
		tokenLength: febboxToken?.length ?? 0,
		tokenPreview: febboxToken ? febboxToken.slice(0, 120) + '...' : '(none)',
		inElectron: typeof process.send === 'function'
	};

	const debugCookies = await electronDebugCookies();
	info.cookies = {
		error: debugCookies.error || null,
		count: debugCookies.cookies.length,
		list: debugCookies.cookies
	};

	const cookieSync = await electronSyncCookies();
	info.syncToken = {
		error: cookieSync.error || null,
		length: cookieSync.token?.length ?? 0,
		preview: cookieSync.token ? cookieSync.token.slice(0, 120) + '...' : '(none)'
	};

	const testFid = fid || 2605967;
	const testKey = shareKey || 'ST1Be39T';

	const testFetch = await electronFetch('https://www.febbox.com/file/player', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `fid=${testFid}&share_key=${testKey}`
	});
	info.playerFetch = {
		fid: testFid,
		shareKey: testKey,
		status: testFetch.status,
		error: testFetch.error || null,
		bodyLength: testFetch.body?.length ?? 0,
		bodyPreview: testFetch.body?.slice(0, 500) || '(empty)',
		hasM3u8: testFetch.body?.includes('.m3u8') ?? false,
		hasMp4: testFetch.body?.includes('.mp4') ?? false
	};

	if (fid && shareKey && febboxToken) {
		invalidateStreamCache(fid);
		const stream = await getStreamUrl(shareKey, fid, febboxToken);
		info.streamExtraction = {
			url: stream.url ? stream.url.substring(0, 200) : null,
			debug: stream.debug
		};

		if (stream.url) {
			try {
				const probe = await fetch(stream.url, {
					headers: {
						Referer: 'https://www.febbox.com/',
						Origin: 'https://www.febbox.com'
					},
					signal: AbortSignal.timeout(8000)
				});
				const body = await probe.text();
				info.streamProbe = {
					status: probe.status,
					contentType: probe.headers.get('content-type'),
					bodyLength: body.length,
					isPlaylist: body.includes('#EXTM3U'),
					hasMaster: body.includes('#EXT-X-STREAM-INF'),
					preview: body.slice(0, 500)
				};
			} catch (e: unknown) {
				info.streamProbe = { error: (e as Error)?.message ?? String(e) };
			}
		}
	}

	const whoami = await electronFetch('https://www.febbox.com/console/user_info');
	info.userInfo = {
		status: whoami.status,
		error: whoami.error || null,
		bodyPreview: whoami.body?.slice(0, 300) || '(empty)'
	};

	return json(info, { headers: { 'Content-Type': 'application/json' } });
};
