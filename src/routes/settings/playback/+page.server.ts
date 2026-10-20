import { playbackStops } from '$lib/server/playbackLog';
import type { PageServerLoad } from './$types';

/** Every time a video stopped to load here (or on a TV watching through this computer). */
export const load: PageServerLoad = () => ({ stops: playbackStops() });
