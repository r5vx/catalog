import { playbackStops } from '$lib/server/playbackLog';
import { readSettings } from '$lib/server/settings';
import { videoDrawing } from '$lib/server/videoDrawing';
import type { PageServerLoad } from './$types';

/** Every time a video stopped to load here (or on a TV watching through this computer), and how video is drawn. */
export const load: PageServerLoad = () => ({
	stops: playbackStops(),
	noOverlay: videoDrawing().noOverlay,
	autoSolve: readSettings().autoSolve !== '0'
});
