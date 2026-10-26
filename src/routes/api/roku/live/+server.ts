import { json } from '@sveltejs/kit';
import { withArt } from '$lib/server/teamArt';
import { withScores } from '$lib/server/liveScores';
import { withBestChannels } from '$lib/server/liveChannelPicks';
import { withLocal } from '$lib/server/liveLocal';
import { replayCondensedOnly, replayNotReady } from '$lib/server/replayAnswer';
import { countryForRegion, liveChannels, liveSchedule } from '$lib/server/sources/daddylive';
import { watchRegion } from '$lib/server/metadata/providers';
import { replayList } from '$lib/server/sources/replays';
import { liveSavedList, liveSports, recentReplays } from '$lib/server/db/queries';
import { SPORTS, SPORT_COLORS, sportPicture, channelsBestFirst, hasFavorite, scoreText, countryRank, gameEnds, isOnNow, replayDay, sportLabel, whenText, type LiveGame, type Sport } from '$lib/live';
import type { RequestHandler } from './$types';

/**
 * Live TV on the Roku (as on Catalog's Live TV): saved games, games on now, then each sport's
 * next games (the next twelve hours), with the channels showing each. Kept small: the Roku
 * reads it all at once. Its playlist is /api/live/playlist?ch=<channel>.
 */
export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin;
	// Only the sports this profile picked on the Fire TV or the computer (all until it has).
	const picked = liveSports();
	const listed = await withArt(await liveSchedule().catch(() => [] as LiveGame[]));
	const allChannels = await liveChannels(listed).catch(() => []);
	const allGames = withBestChannels(await withScores(listed), allChannels, countryForRegion(watchRegion()));
	// (The Roku has no "Other countries": the viewer's own country's games only, as Live TV starts.)
	const games = withLocal(allGames, allChannels, countryForRegion(watchRegion())).filter((g) => (!picked?.length || picked.includes(g.sport)) && g.local !== false);
	const now = Date.now();
	const item = (game: LiveGame) => ({
		id: game.id,
		game: game.id,
		label: game.title,
		sub: [game.score && game.score.state !== 'pre' ? `${scoreText(game.score)} · ${game.score.detail}` : whenText(game, now), game.league].filter(Boolean).join(' · '),
		on: isOnNow(game, now),
		// The one-click channel first (liveChannelPicks.ts).
		channels: channelsBestFirst(game).slice(0, 12),
		// Its picture (as the Fire TV's): both teams' logos and colors, else the sport's color and name.
		logos: game.art?.teams.map((t) => ({ logo: t.logo, color: t.color })) ?? [],
		sport: sportLabel(game.sport),
		sportColor: SPORT_COLORS[game.sport],
		sportPicture: new URL(sportPicture(game.sport), origin).href,
		// A TV show's own picture (showArt.ts), shown like a replay's.
		poster: game.poster ?? ''
	});
	const saved = liveSavedList()
		.filter((row) => row.kind === 'game')
		.map((row) => games.find((g) => g.id === row.key) ?? (JSON.parse(row.data ?? 'null') as LiveGame | null))
		.filter((g): g is LiveGame => !!g && gameEnds(g) > now);
	// The channels, as the Fire TV's Channels: showing a game now first, then Where to watch's
	// country, then American, British and Canadian sports channels.
	const home = countryForRegion(watchRegion());
	const showing = new Map<number, LiveGame>();
	for (const g of games) if (isOnNow(g, now)) for (const c of g.channels) if (!showing.has(c.id)) showing.set(c.id, g);
	const channels = allChannels
		.filter((c) => c.sports.length || showing.has(c.id))
		.sort((a, b) => Number(showing.has(b.id)) - Number(showing.has(a.id)) || countryRank(a.country, home) - countryRank(b.country, home) || a.name.localeCompare(b.name))
		.slice(0, 150)
		.map((c) => ({ id: `channel-${c.id}`, label: c.name, sub: showing.get(c.id)?.title ?? c.country, on: showing.has(c.id), channels: [{ id: c.id, name: c.name }], game: showing.get(c.id)?.id ?? '' }));
	// Favorite teams (picked on the Fire TV or the computer): their games first, and in a row.
	const favorites = new Set(liveSavedList().filter((r) => r.kind === 'team').map((r) => r.key));
	const fav = (g: LiveGame) => Number(hasFavorite(g, favorites));
	// In the Fire TV's order: On now, Your teams, Saved, each sport, Channels.
	const rows = [
		{ label: 'On now', items: games.filter((g) => isOnNow(g, now)).sort((a, b) => fav(b) - fav(a) || sportRank(a) - sportRank(b)).slice(0, 60).map(item) },
		{ label: 'Your teams', items: allGames.filter((g) => fav(g)).sort((a, b) => Number(isOnNow(b, now)) - Number(isOnNow(a, now)) || a.start - b.start).slice(0, 60).map(item) },
		{ label: 'Saved', items: saved.map(item) },
		// Replays (how far each got) and channels watched lately, as the Fire TV's Recently watched.
		{
			label: 'Recently watched',
			items: [
				...recentReplays().map((r) => ({
					id: `recent-${r.id}`,
					replay: r.id,
					label: r.title,
					sub: r.duration > 0 && r.currentTime / r.duration < 0.95 ? `${Math.max(1, Math.round((r.duration - r.currentTime) / 60))} min left · Replay` : 'Watched · Replay',
					on: false,
					channels: [],
					game: '',
					poster: r.poster ?? '',
					logos: [],
					sport: sportLabel(r.sport as Sport),
					sportColor: SPORT_COLORS[r.sport as Sport] ?? SPORT_COLORS.other,
					sportPicture: new URL(sportPicture(r.sport as Sport), origin).href
				})),
				...liveSavedList()
					.filter((row) => row.kind === 'recent')
					.map((row) => ({ id: `recent-channel-${row.key}`, label: row.name, sub: 'Channel', on: false, channels: [{ id: Number(row.key), name: row.name }], game: '', isChannel: true }))
			]
		},
		...SPORTS.map((sport) => ({
			label: sport.label,
			// As the Fire TV's sport chips: on now first, then what's next.
			items: [
				...games.filter((g) => g.sport === sport.key && isOnNow(g, now)),
				...games.filter((g) => g.sport === sport.key && !isOnNow(g, now))
			]
				.slice(0, 60)
				.map(item)
		})),
		{ label: 'Channels', items: channels },
		// Replays of past games (sources/replays.ts): played by `replay`.
		{
			label: 'Replays',
			items: (await replayList().catch(() => []))
				.filter((r) => (!picked?.length || picked.includes(r.sport)) && !replayNotReady(r.id))
				.slice(0, 90)
				.map((r) => ({ id: `replay-${r.id}`, replay: r.id, label: r.title, sub: [replayCondensedOnly(r.id) ? `Condensed, ${replayCondensedOnly(r.id)} min` : '', sportLabel(r.sport), r.league, replayDay(r.date)].filter(Boolean).join(' · '), on: false, channels: [], game: '', poster: r.poster ?? '', logos: [], sport: sportLabel(r.sport), sportColor: SPORT_COLORS[r.sport], sportPicture: new URL(sportPicture(r.sport), origin).href }))
		}
	].filter((row) => row.items.length);
	return json({ rows });
};

const sportRank = (game: LiveGame) => SPORTS.findIndex((s) => s.key === game.sport);
