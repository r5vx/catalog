import { json } from '@sveltejs/kit';
import { appVersion } from '$lib/server/updater';

/** The version of Catalog running on this computer: a TV asks, to notice it was updated. */
export function GET() {
	return json({ version: appVersion() }, { headers: { 'Cache-Control': 'no-store' } });
}
