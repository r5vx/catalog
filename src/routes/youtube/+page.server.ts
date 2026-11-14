import { redirect } from '@sveltejs/kit';
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
	const agent = request.headers.get('user-agent') ?? '';
	// Not on an iPhone yet: through the computer, YouTube stops a video about a minute in with
	// "Something went wrong", so the page says it isn't available there instead of opening it.
	const iphone = !canOpen && /iPhone|iPod|iPad/i.test(agent);
	const phone = !iphone && /Android|Mobile/i.test(agent);
	// A phone goes straight to YouTube (this page's moving wall was a stop on the way, 2026-11-09).
	const phoneLink = !canOpen && phone ? youtubePhoneLink(request, url) : null;
	if (phoneLink) redirect(303, phoneLink);
	return {
		canOpen,
		inside: readSettings().youtubeInside === '1',
		phoneLink,
		iphone
	};
};
