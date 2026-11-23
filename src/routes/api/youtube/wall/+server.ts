import { json } from '@sveltejs/kit';
import { youtubeWall } from '$lib/server/youtubeWall';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ thumbs: await youtubeWall() });
