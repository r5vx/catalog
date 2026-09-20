import { json } from '@sveltejs/kit';
import { electronFetch, electronSyncCookies, electronDebugCookies } from '$lib/server/electron-fetch';
import { readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const { febboxToken } = readSettings();
	const info: Record<string, unknown> = {
		hasToken: Boolean(febboxToken),
		tokenLength: febboxToken?.length ?? 0,
		tokenPreview: febboxToken ? febboxToken.slice(0, 120) + '...' : '(none)',
		inElectron: typeof process.send === 'function'
	};

	// Detailed cookie info from Electron's session
	const debugCookies = await electronDebugCookies();
	info.cookies = {
		error: debugCookies.error || null,
		count: debugCookies.cookies.length,
		list: debugCookies.cookies
	};

	// Saved cookie string from sync
	const cookieSync = await electronSyncCookies();
	info.syncToken = {
		error: cookieSync.error || null,
		length: cookieSync.token?.length ?? 0,
		preview: cookieSync.token ? cookieSync.token.slice(0, 120) + '...' : '(none)'
	};

	// Test: net.fetch to player with credentials:include
	const testFetch = await electronFetch('https://www.febbox.com/file/player', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'fid=2605967&share_key=ST1Be39T'
	});
	info.playerFetch = {
		status: testFetch.status,
		error: testFetch.error || null,
		bodyPreview: testFetch.body?.slice(0, 300) || '(empty)'
	};

	// Test: check if we're actually logged in
	const whoami = await electronFetch('https://www.febbox.com/console/user_info');
	info.userInfo = {
		status: whoami.status,
		error: whoami.error || null,
		bodyPreview: whoami.body?.slice(0, 300) || '(empty)'
	};

	return json(info, { headers: { 'Content-Type': 'application/json' } });
};
