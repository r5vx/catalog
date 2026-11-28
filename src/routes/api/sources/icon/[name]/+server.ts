import { error } from '@sveltejs/kit';
import { ALL_SOURCES } from '$lib/sourceList';
import type { RequestHandler } from './$types';

const kept = new Map<string, { at: number; type: string; body: ArrayBuffer } | null>();
const DAY = 24 * 60 * 60 * 1000;

const iconFrom = (url: string) =>
	fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) })
		.then(async (r) => {
			const type = r.headers.get('content-type') ?? '';
			return r.ok && type.startsWith('image/') ? { at: Date.now(), type, body: await r.arrayBuffer() } : null;
		})
		.catch(() => null);

/** A source's site icon, fetched once a day and served from here so phones and TVs get it too. */
export const GET: RequestHandler = async ({ params }) => {
	const source = ALL_SOURCES.find((s) => s.name === params.name);
	if (!source) error(404, 'Unknown source.');
	let icon = kept.get(source.domain);
	if (icon === undefined || (icon && Date.now() - icon.at > DAY)) {
		// The icon service first; the site's own favicon for the ones it doesn't know.
		icon = (await iconFrom(`https://icons.duckduckgo.com/ip3/${source.domain}.ico`)) ?? (await iconFrom(`https://${source.domain}/favicon.ico`));
		kept.set(source.domain, icon);
	}
	if (!icon) error(404, 'No icon.');
	return new Response(icon.body, { headers: { 'content-type': icon.type, 'cache-control': 'public, max-age=86400' } });
};
