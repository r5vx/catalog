import { error, json } from '@sveltejs/kit';
import { captionChannels, captionDelay, noteCaptionLag } from '$lib/server/liveCaptionDelay';
import { onThisComputer } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Live captions' delay (src/lib/server/liveCaptionDelay.ts). `?ch=`: a screen playing that channel
 * asks (every few seconds). `?work=1`: the computer's hidden page asks which channels to hear.
 */
export const GET: RequestHandler = ({ url, request, getClientAddress }) => {
	if (url.searchParams.has('work')) {
		if (!computer(request, getClientAddress)) return error(403, 'Only the computer Catalog runs on');
		return json({ channels: captionChannels() });
	}
	const channel = Number(url.searchParams.get('ch'));
	if (!Number.isInteger(channel) || channel <= 0) return error(400, 'Which channel?');
	return json(captionDelay(channel));
};

/** The hidden page's answer for a channel: { ch, lag, matches }. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!computer(request, getClientAddress)) return error(403, 'Only the computer Catalog runs on');
	const { ch, lag, matches } = (await request.json().catch(() => ({}))) as { ch?: number; lag?: number; matches?: number };
	if (!Number.isInteger(ch) || typeof lag !== 'number') return error(400, 'What was found?');
	noteCaptionLag(ch!, lag, Number(matches) || 0);
	return json({ ok: true });
};

function computer(request: Request, getClientAddress: () => string) {
	let address = '';
	try {
		address = getClientAddress();
	} catch {}
	return onThisComputer(request.headers, address);
}
