import { json } from '@sveltejs/kit';
import { withArt } from '$lib/server/teamArt';
import { withScores } from '$lib/server/liveScores';
import { withBestChannels } from '$lib/server/liveChannelPicks';
import { withLocal } from '$lib/server/liveLocal';
import { countryForRegion, liveChannels, liveSchedule } from '$lib/server/sources/daddylive';
import { watchRegion } from '$lib/server/metadata/providers';
import { liveSavedList, liveSports, recentReplays, unsaveLive } from '$lib/server/db/queries';
import { gameEnds, type LiveGame, type TeamArt } from '$lib/live';
import type { RequestHandler } from './$types';

/** A saved game stays this long after it ends, then goes. */
const SAVED_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Everything Live TV shows (sources/daddylive.ts): the games on the schedule, the channels,
 * what this profile saved and watched lately, and whether this computer can play them (only
 * the desktop app can). A saved game still on the schedule is shown as the schedule has it now.
 */
export const GET: RequestHandler = async () => {
	const listed = await withArt(await liveSchedule().catch(() => [] as LiveGame[]));
	const channels = await liveChannels(listed).catch(() => []);
	const now = Date.now();
	const home = countryForRegion(watchRegion());
	// Scores while they're on, and the channel each plays on with one click.
	const games = withLocal(withBestChannels(await withScores(listed), channels, home), channels, home);
	const saved = liveSavedList();
	const savedGames: LiveGame[] = [];
	for (const row of saved.filter((r) => r.kind === 'game')) {
		let game: LiveGame | null = games.find((g) => g.id === row.key) ?? null;
		if (!game) {
			try {
				game = JSON.parse(row.data ?? 'null');
			} catch {}
		}
		if (!game || gameEnds(game) + SAVED_AFTER_MS < now) unsaveLive('game', row.key);
		else savedGames.push(game);
	}
	return json({
		games,
		channels,
		savedGames: savedGames.sort((a, b) => a.start - b.start),
		savedChannels: saved.filter((r) => r.kind === 'channel').map((r) => Number(r.key)),
		recent: saved.filter((r) => r.kind === 'recent').map((r) => ({ id: Number(r.key), name: r.name })),
		// Replays watched lately, with how far each got (Recently watched).
		recentReplays: recentReplays().slice(0, 8),
		playable: typeof process.send === 'function',
		// The sports this profile picked (null: asked the first time Live TV opens).
		sports: liveSports(),
		// Favorite teams (their games come first, under "Your teams").
		teams: saved
			.filter((r) => r.kind === 'team')
			.flatMap((r) => {
				try {
					return [JSON.parse(r.data ?? '') as TeamArt];
				} catch {
					return [];
				}
			}),
		// Where to watch's country, if it has channels: the Channels list starts filtered to it.
		homeCountry: channels.some((c) => c.country === home) ? home : ''
	});
};
