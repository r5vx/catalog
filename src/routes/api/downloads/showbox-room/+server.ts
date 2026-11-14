import { json } from '@sveltejs/kit';
import { showboxDownloadRoom } from '$lib/server/showboxDownloadRoom';
import type { RequestHandler } from './$types';

/** How much of Showbox's video may be downloaded right now (src/lib/server/showboxDownloadRoom.ts). */
export const GET: RequestHandler = async () => json(await showboxDownloadRoom());
