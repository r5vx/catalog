import type { PageServerLoad } from './$types';
import { onThisComputer } from '$lib/server/profile';
import { readSettings } from '$lib/server/settings';
import { youtubePhoneLink } from '$lib/server/youtubePhone';

/**
 * Whether YouTube can open here (the desktop app, on its own computer), and which way. A phone gets
 * YouTube's mobile website through the computer instead (src/lib/server/youtubePhone.ts).
 */
export const load: PageServerLoad = async ({ request, getClientAddress, url }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	const desktop = typeof process.send === 'function' && !!process.env.CATALOG_DESKTOP;
	const canOpen = desktop && onThisComputer(request.headers, address);
	const phone = /iPhone|iPod|Android|Mobile/i.test(request.headers.get('user-agent') ?? '');
	return {
		canOpen,
		inside: readSettings().youtubeInside === '1',
		phoneLink: !canOpen && phone ? youtubePhoneLink(request, url) : null
	};
};
