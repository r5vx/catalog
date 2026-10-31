import { json } from '@sveltejs/kit';
import { existsSync, statSync } from 'node:fs';
import { dbPath, dataDir } from '$lib/server/db';
import { settingsPath, readSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';
import { slowRequests } from '$lib/server/slowRequests';
import { liveListingState } from '$lib/server/sources/daddylive';
import { playbackStops } from '$lib/server/playbackLog';
import { speechJobs } from '$lib/server/heardSpeech';
import { storageReports } from '$lib/server/storageHealth';
import { caughtUpSummary } from '$lib/server/db/queries';

const describe = (path: string) => {
	if (!existsSync(path)) return { path, exists: false };
	const stat = statSync(path);
	return { path, exists: true, bytes: stat.size, modified: stat.mtime.toISOString() };
};

/**
 * Says where the app is actually reading and writing. Deliberately reports only
 * paths and yes/no answers — never the API key, never the PIN.
 *
 * Reachable without the PIN, because you need it most when the PIN is the thing
 * misbehaving.
 */
export const GET: RequestHandler = async () => {
	const settings = readSettings();

	return json({
		// Outside requests that took over two seconds or were refused, newest first (site and path only).
		slowRequests: slowRequests(),
		// Live TV's listings: where the site is, how many, and why the last ask failed.
		liveTv: liveListingState(),
		// Times a video stopped to load, with what was going on (playbackLog.ts), newest first.
		playbackStops: playbackStops().slice(0, 20),
		// TVs' asks for the computer to hear a sound track for subtitle timing, and how each went (heardSpeech.ts).
		speechJobs: speechJobs(),
		// Whether each screen's browser kept what pages remember since its last start (storage-health).
		storage: storageReports(),
		// Shows watched to their last episode, and new episodes found for them (newEpisodes.ts).
		caughtUp: caughtUpSummary(),
		settingsStoredIn: 'settings table inside library.db',
		cwd: process.cwd(),
		appdata: process.env.APPDATA ?? null,
		catalogDbEnv: process.env.CATALOG_DB ?? null,
		dataDir,
		library: describe(dbPath),
		hasTmdbKey: Boolean(settings.tmdbApiKey),
		hasPin: Boolean(settings.pinHash),
		hasSalt: Boolean(settings.salt)
	});
};
