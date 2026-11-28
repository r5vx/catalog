import { error, json } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/settings';
import {
	coversFor,
	guessEndless,
	guessToday,
	isGenre,
	keyForTyped,
	newEndless,
	searchSongs,
	setVolume,
	todayOf,
	type Guess
} from '$lib/server/catasong/daily';

const fresh = { headers: { 'Cache-Control': 'no-store' } };

/**
 * ?do=today&genre=rap → where today's game stands; ?do=endless&genre=rap → a new Endless round;
 * ?do=search&q=… → songs for the guess box; ?do=genre&q=… → the key for a typed-in genre;
 * ?do=covers&genre= → album covers for the background.
 */
export async function GET({ url }) {
	const what = url.searchParams.get('do');
	if (what === 'search') return json(await searchSongs(url.searchParams.get('q') ?? ''), fresh);
	if (what === 'genre') return json({ key: keyForTyped(url.searchParams.get('q') ?? '') }, fresh);
	const genre = url.searchParams.get('genre');
	if (!isGenre(genre)) error(400, 'Unknown genre.');
	if (what === 'covers') return json(await coversFor(genre), fresh);
	if (what === 'today') return json((await todayOf(genre)) ?? { empty: true }, fresh);
	if (what === 'endless') return json((await newEndless(genre)) ?? { empty: true }, fresh);
	error(400, 'Unknown ask.');
}

function readGuess(g: Record<string, unknown> | null | undefined): Guess {
	if (!g) return null;
	if (typeof g.id !== 'number' || typeof g.title !== 'string' || typeof g.artist !== 'string' || typeof g.artistId !== 'number') {
		error(400, 'Unknown guess.');
	}
	return { id: g.id, title: g.title, artist: g.artist, artistId: g.artistId };
}

/**
 * { genre, guess } guesses today's song; { token, guess } an Endless round's (guess is
 * { id, title, artist, artistId }, or null to skip). { volume } keeps the volume; { pinned }
 * puts Catasong in the sidebar or takes it out.
 */
export async function POST({ request }) {
	const body = (await request.json().catch(() => ({}))) as { genre?: unknown; token?: unknown; guess?: unknown; volume?: unknown; pinned?: unknown };
	if (typeof body.volume === 'number' && Number.isFinite(body.volume)) {
		setVolume(body.volume);
		return json({ ok: true });
	}
	if (typeof body.pinned === 'boolean') {
		updateSettings({ catasongPinned: body.pinned ? '1' : '0' });
		return json({ ok: true });
	}
	const guess = readGuess(body.guess as Record<string, unknown> | null | undefined);
	if (typeof body.token === 'string') {
		const answer = guessEndless(body.token, guess);
		if (!answer) error(404, 'That round is over.');
		return json(answer);
	}
	if (!isGenre(body.genre)) error(400, 'Unknown genre.');
	return json((await guessToday(body.genre, guess)) ?? { empty: true });
}
