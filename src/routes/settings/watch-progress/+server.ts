import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Moved to Settings → Playback (2026-11-14): old links and bookmarks still land there. */
export const GET: RequestHandler = () => redirect(308, '/settings/playback');
