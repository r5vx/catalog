import { json } from '@sveltejs/kit';
import { pairingCode } from '$lib/server/online';
import type { RequestHandler } from './$types';

/** A six-digit code a TV can type to find this computer (Settings → Watch on TV). Null when this Catalog isn't online. */
export const GET: RequestHandler = async ({ url }) => json(await pairingCode(url.port || process.env.PORT || '4173'));
