import { json, type RequestEvent } from '@sveltejs/kit';
import { isAvailable } from '$lib/server/availability';

export async function GET({ url }: RequestEvent) {
	const title = url.searchParams.get('title')?.trim();
	const type = url.searchParams.get('type') ?? '';
	const year = url.searchParams.get('year') ?? '';

	if (!title) return json({ available: false });
	return json({ available: await isAvailable(title, type, year) });
}
