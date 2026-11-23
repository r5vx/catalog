import { json } from '@sveltejs/kit';
import { hostname } from 'node:os';
import { pinIsSet } from '$lib/server/settings';
import { ROKU_APP_VERSION } from '$lib/rokuApp';
import type { RequestHandler } from './$types';

/**
 * The Roku app's first question (roku/README.md): is this Catalog, what's the computer called,
 * does it need the PIN, and which version of the Roku app it has (`rokuApp`, src/lib/rokuApp.ts).
 * Open without the PIN, like /api/diagnostics.
 */
/**
 * How a Roku gets the newer app, said by the Roku when this computer's is newer (`rokuAppHow`, from
 * Roku app 1.1.3 on: before, its own words named a Settings section that doesn't exist).
 */
const ROKU_APP_HOW =
	'On the computer Catalog runs on, open Settings, then TV and phones. Under Catalog on a Roku, choose Find Rokus, pick this Roku, type its developer password, then choose Install.';

export const GET: RequestHandler = async () =>
	json({ app: 'catalog', name: hostname(), pin: pinIsSet(), rokuApp: ROKU_APP_VERSION, rokuAppHow: ROKU_APP_HOW });
