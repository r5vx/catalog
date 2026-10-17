import { json, type RequestEvent } from '@sveltejs/kit';
import { availabilityNow, isAvailable } from '$lib/server/availability';

/**
 * { available, unsure? } — `unsure`: no answer within 12 seconds yet; ask again shortly.
 * With ?now=1: { available (null while checking), sources } at once, for a page that asks every
 * second and shows each source's progress.
 */
export async function GET({ url }: RequestEvent) {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return json({ available: false });
	if (url.searchParams.has('now')) return json(availabilityNow(title, type, year));
	return json(await isAvailable(title, type, year));
}
