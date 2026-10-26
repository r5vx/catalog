import { json } from '@sveltejs/kit';
import { hostname } from 'node:os';
import { pinIsSet } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * The Roku app's first question (roku/README.md): is this Catalog, what's the computer called,
 * and does it need the PIN. Open without the PIN, like /api/diagnostics.
 */
export const GET: RequestHandler = async () => json({ app: 'catalog', name: hostname(), pin: pinIsSet() });
