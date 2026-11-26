import { requireOwner } from '$lib/server/ownerSession';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => { requireOwner(cookies); };
