import { json } from '@sveltejs/kit';
import { listProfiles } from '$lib/server/db/queries';
import type { RequestHandler } from './$types';

/** Who can be watching, for the Roku's "Who's watching?" (as on the TV's profiles screen). */
export const GET: RequestHandler = async () => json({ profiles: listProfiles() });
