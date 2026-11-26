import { error, json } from '@sveltejs/kit';
import { guess, guessNames, isKinds, isLevel, newRound, noteStreak, postersFor, warm } from '$lib/server/catasong/anime';

const fresh = { headers: { 'Cache-Control': 'no-store' } };

/**
 * ?do=round&level=easy&kinds=both → a new round's token; ?do=names → the guess box's list;
 * ?do=warm&level= → start making that level's list; ?do=posters&level= → background posters.
 */
export function GET({ url }) {
	const what = url.searchParams.get('do');
	if (what === 'names') return json(guessNames(), fresh);
	const level = url.searchParams.get('level');
	if (what === 'warm' || what === 'posters') {
		if (!isLevel(level)) error(400, 'Unknown level.');
		if (what === 'warm') {
			warm(level);
			return json({ ok: true }, fresh);
		}
		return json(postersFor(level), fresh);
	}
	if (what === 'round') {
		const kinds = url.searchParams.get('kinds') ?? 'both';
		if (!isLevel(level) || !isKinds(kinds)) error(400, 'Unknown level.');
		return json(newRound(level, kinds), fresh);
	}
	error(400, 'Unknown ask.');
}

/** { token, id } guesses (id null gives up); { level, streak } notes a streak. */
export async function POST({ request }) {
	const body = (await request.json().catch(() => ({}))) as { token?: unknown; id?: unknown; level?: unknown; streak?: unknown };
	if (typeof body.token === 'string') {
		const id = typeof body.id === 'number' ? body.id : null;
		const answer = await guess(body.token, id);
		if (!answer) error(404, 'That round is over.');
		return json(answer);
	}
	if (isLevel(body.level) && typeof body.streak === 'number') return json(noteStreak(body.level, Math.floor(body.streak)));
	error(400, 'Unknown ask.');
}
