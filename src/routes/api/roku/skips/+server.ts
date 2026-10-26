import { json } from '@sveltejs/kit';
import { getOrderCache } from '$lib/server/db/queries';
import { withFound, type SkipSegment } from '$lib/skipMerge';
import type { RequestHandler } from './$types';

/**
 * An episode's intro, recap and credits for the Roku, as Catalog's player on a TV has them
 * (src/lib/skipMerge.ts): the databases' and what the computer found by comparing episodes'
 * sound. Not looked for yet: the computer is asked to (as for a Fire TV), for next time.
 * ?title=&year=&season=&episode=&overall=<counted from the show's first>&duration=&fid=&copy=
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const forward: Record<string, string> = {};
	for (const name of ['cookie', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) forward[name] = value;
	}
	const get = (name: string) => url.searchParams.get(name) ?? '';
	const copy = get('copy');
	const params = new URLSearchParams({ title: get('title'), episode: get('overall'), duration: get('duration'), season: get('season'), number: get('episode') });
	const fromDatabases = await fetch(new URL(`/api/watch/skip-times?${params}`, url.origin), { headers: forward, signal: AbortSignal.timeout(30_000) })
		.then((r) => (r.ok ? (r.json() as Promise<SkipSegment[]>) : []))
		.catch(() => [] as SkipSegment[]);
	const found = copy ? ((getOrderCache(`skip-found|${copy}`)?.value as SkipSegment[] | undefined) ?? null) : null;
	if (found === null && copy) {
		fetch(new URL('/api/watch/skip-found/prepare', url.origin), {
			method: 'POST',
			headers: { ...forward, 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: get('title'), year: get('year'), season: Number(get('season')), episode: Number(get('episode')), fid: Number(get('fid')), key: copy })
		}).catch(() => {});
	}
	return json({ segments: withFound(fromDatabases, found ?? []) });
};
