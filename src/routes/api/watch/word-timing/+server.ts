import { json } from '@sveltejs/kit';
import { askWordTiming, keepWordAnswer, nextWordJob, wordAnswer } from '$lib/server/wordTiming';
import type { RequestHandler } from './$types';

/**
 * Subtitle timing by words (src/lib/server/wordTiming.ts).
 *   GET ?copy=&sub=          → { answer }   what's known for this copy and subtitle file
 *   POST { copy, sub, master, language, duration } → { state: 'known' | 'asked' | 'none', answer }
 *   GET ?work=1              → { job }      for /word-timer
 *   PUT { key, plan, matches, heard, finished, why } from /word-timer
 */
export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.has('work')) return json({ job: nextWordJob() });
	return json({ answer: wordAnswer(url.searchParams.get('copy') ?? '', url.searchParams.get('sub') ?? '') });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const copy = String(body?.copy ?? '');
	const sub = String(body?.sub ?? '');
	const master = String(body?.master ?? '');
	if (!copy || !sub || !master) return json({ state: 'none', answer: null });
	const state = askWordTiming(copy, sub, master, String(body?.language ?? ''), Number(body?.duration) || 0);
	return json({ state, answer: wordAnswer(copy, sub) });
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body?.key) return json({ ok: false });
	keepWordAnswer(String(body.key), {
		plan: (body.plan as never) ?? null,
		matches: Number(body.matches) || 0,
		heard: Number(body.heard) || 0,
		finished: Boolean(body.finished),
		why: body.why ? String(body.why).slice(0, 200) : undefined,
		points: Array.isArray(body.points) ? (body.points as { t: number; off: number }[]).slice(0, 300).map((p) => ({ t: Math.round(Number(p.t) * 100) / 100, off: Math.round(Number(p.off) * 100) / 100 })) : undefined
	});
	return json({ ok: true });
};
