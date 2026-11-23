import { loadThisWeek } from '$lib/server/thisWeekPage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => loadThisWeek();
