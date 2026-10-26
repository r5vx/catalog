import type { RequestHandler } from './$types';

/**
 * English subtitles for what the Roku plays, as WebVTT (a format the Roku reads itself):
 * ?title=&type=&season=&episode=&year=&share=. Picked as Catalog's player picks them on a TV:
 * the one marked to start on (anime's official English), else English CC, else English. The
 * Roku only asks when subtitles are on.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const forward: Record<string, string> = {};
	for (const name of ['cookie', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) forward[name] = value;
	}
	const ask = <T>(path: string): Promise<T | null> =>
		fetch(new URL(path, url.origin), { headers: forward, signal: AbortSignal.timeout(60_000) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);

	const params = new URLSearchParams();
	for (const name of ['title', 'type', 'season', 'episode', 'year', 'share']) {
		const value = url.searchParams.get(name);
		if (value && value !== '0') params.set(name, value);
	}
	type Option = { url: string; language: string; fileName: string; default?: boolean; check?: boolean };
	const list = ((await ask<Option[]>(`/api/watch/subtitles?${params}`)) ?? []).filter((s) => !s.check);
	const english = list.filter((s) => s.language === 'English');
	const tries = [list.find((s) => s.default), english.find((s) => /\bCC\b|SDH/i.test(s.fileName)), ...english].filter(
		(s, i, all): s is Option => !!s && all.indexOf(s) === i
	);
	for (const sub of tries.slice(0, 3)) {
		const content = new URLSearchParams({ url: sub.url, show: params.get('title') ?? '' });
		if (params.get('season')) content.set('season', params.get('season')!);
		if (params.get('episode')) content.set('episode', params.get('episode')!);
		const text = (await ask<{ content: string }>(`/api/watch/subtitle-content?${content}`))?.content;
		const vtt = text ? toVtt(text) : '';
		if (vtt) return new Response(vtt, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' } });
	}
	return new Response('WEBVTT\n\n', { status: 404, headers: { 'Content-Type': 'text/vtt; charset=utf-8' } });
};

/** SRT, WebVTT or ASS subtitles as WebVTT; empty when it's none of those. */
function toVtt(text: string): string {
	text = text.replace(/^﻿/, '').replace(/\r/g, '');
	if (/^WEBVTT/.test(text)) return text;
	if (/^\s*Dialogue:/m.test(text)) return assToVtt(text);
	if (!/-->/.test(text)) return '';
	return `WEBVTT\n\n${text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')}`;
}

/** "0:01:02.34" (ASS) → "00:01:02.340". */
const assTime = (time: string) => {
	const [h, m, s] = time.trim().split(':');
	const [whole, part = '0'] = s.split('.');
	return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${whole.padStart(2, '0')}.${part.padEnd(3, '0').slice(0, 3)}`;
};

/** ASS lines (anime's styled subtitles), as plain cues: styling and drawings left out. */
function assToVtt(text: string): string {
	const format = /^Format:\s*(.+)$/m.exec(text.slice(text.indexOf('[Events]')))?.[1].split(',').map((f) => f.trim().toLowerCase()) ?? [
		'layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'
	];
	const at = (name: string) => format.indexOf(name);
	const cues: { start: string; end: string; text: string }[] = [];
	for (const line of text.split('\n')) {
		if (!line.startsWith('Dialogue:')) continue;
		const parts = line.slice(9).split(',');
		const fields = [...parts.slice(0, format.length - 1), parts.slice(format.length - 1).join(',')];
		const raw = fields[at('text')] ?? '';
		if (/\\p[1-9]/.test(raw)) continue;
		const words = raw.replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').replace(/\\h/g, ' ').trim();
		if (!words) continue;
		cues.push({ start: assTime(fields[at('start')]), end: assTime(fields[at('end')]), text: words });
	}
	cues.sort((a, b) => a.start.localeCompare(b.start));
	return cues.length ? `WEBVTT\n\n${cues.map((c) => `${c.start} --> ${c.end}\n${c.text}`).join('\n\n')}\n` : '';
}
