import { json } from '@sveltejs/kit';
import { cuesOf, planFor, timedBy, toVtt, type Cue, type Timing } from '$lib/server/rokuCaptions';
import type { RequestHandler } from './$types';

/**
 * The Roku player's captions (roku/components/PlayerScreen.brs draws them itself), as the Fire TV
 * player has them: every subtitle there is for what's playing to choose from, the one it starts on
 * picked the same way (anime's official English, else English CC, else English), and auto-timing
 * from what the computer heard of this copy.
 *
 * ?title=&type=&year=&season=&episode=&share= (another source's copy) &fid= (Showbox file)
 *  &copy= (the copy heard: a Showbox file's number or another copy's share key) &lang= (its sound)
 *  &pick= (the option chosen; none: the usual one) &auto=0|1 &from= (where it is, heard first)
 * Answers { options: [{ label }], picked, cues: [{ s, e, t }], timing }. While the computer is still
 * hearing it (timing "waiting"), the Roku asks again now and then.
 */
type Option = { url: string; language: string; fileName: string; default?: boolean; check?: boolean; source?: string };

export const GET: RequestHandler = async ({ url, request }) => {
	const forward: Record<string, string> = {};
	for (const name of ['cookie', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) forward[name] = value;
	}
	const ask = <T>(path: string, init: RequestInit = {}): Promise<T | null> =>
		fetch(new URL(path, url.origin), { ...init, headers: { ...forward, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(60_000) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);
	const get = (name: string) => url.searchParams.get(name) ?? '';

	const params = new URLSearchParams();
	for (const name of ['title', 'type', 'season', 'episode', 'year', 'share']) {
		const value = get(name);
		if (value && value !== '0') params.set(name, value);
	}
	const options = ((await ask<Option[]>(`/api/watch/subtitles?${params}`)) ?? []).filter((s) => !s.check);
	const english = options.filter((s) => s.language === 'English');
	const usual = options.indexOf(options.find((s) => s.default) ?? english.find((s) => /\bCC\b|SDH/i.test(s.fileName)) ?? english[0] ?? options[0]);
	const asked = url.searchParams.has('pick') ? Number(get('pick')) : -1;
	const chosenByHand = asked >= 0 && asked < options.length;

	const labels = options.map((s) => ({ label: `${s.language}${s.source && s.source !== 'OpenSubtitles' ? ` (${s.source})` : ''} · ${s.fileName.replace(/\.(srt|vtt|ass|ssa|sub|txt)$/i, '').slice(0, 60)}` }));
	const answer = (picked: number, cues: Cue[], timing: Timing) => json({ options: labels, picked, cues, timing });
	if (!options.length) return answer(-1, [], { state: 'off' });

	const read = async (index: number): Promise<Cue[]> => {
		const sub = options[index];
		const content = new URLSearchParams({ url: sub.url, show: get('title') });
		if (params.get('season')) content.set('season', params.get('season')!);
		if (params.get('episode')) content.set('episode', params.get('episode')!);
		const text = (await ask<{ content: string }>(`/api/watch/subtitle-content?${content}`))?.content;
		return text ? cuesOf(toVtt(text)) : [];
	};

	// The ones to try, in order: the one asked for (only that), else the usual one, then the next
	// English ones when auto-timing hears they don't fit (as the Fire TV tries them).
	const order = chosenByHand ? [asked] : [usual, ...english.map((s) => options.indexOf(s)).filter((i) => i !== usual)].slice(0, 4);
	const auto = get('auto') !== '0';
	const copy = get('copy');
	const fid = Number(get('fid'));
	const key = /^\d+$/.test(copy) ? Number(copy) : copy;
	const language = get('lang');

	let first: { index: number; cues: Cue[] } | null = null;
	let waiting = false;
	for (const index of order) {
		const cues = await read(index);
		if (cues.length < 5) continue;
		first ??= { index, cues };
		if (!auto || !key) break;
		const { plan, heard, partial } = planFor(key, language, options[index].url, cues);
		if (plan?.fits) return answer(index, timedBy(cues, plan), { state: 'timed', delay: plan.steps[0]?.delay ?? 0 });
		// Nothing heard of a copy the computer can't hear by itself (only Showbox files: other
		// sources' are heard from the computer's own player's downloads): as they are.
		if (!heard && !(fid > 0)) break;
		// Not heard enough yet to say: these, as they are, until it has.
		if (!heard || partial || plan === null) {
			waiting = true;
			if (!heard && fid > 0) {
				await ask('/api/watch/speech/prepare', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: get('title'), type: get('type'), year: get('year'), season: get('season'), episode: get('episode'), fid, lang: language, from: Number(get('from')) || 0 })
				});
			}
			break;
		}
		// Heard, and they don't fit: the next.
	}
	if (!first) return answer(-1, [], { state: 'off' });
	const heardAny = Boolean(key) && planFor(key, language, options[first.index].url, first.cues).heard;
	const timing: Timing = !auto ? { state: 'off' } : waiting ? { state: 'waiting' } : !heardAny ? { state: 'unavailable' } : { state: 'nomatch' };
	return answer(first.index, first.cues, timing);
};
