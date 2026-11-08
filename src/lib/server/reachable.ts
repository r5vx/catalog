/**
 * Whether a source's site answers at all, for when it gave nothing: "nothing for this" and "can't
 * be reached" (an internet provider blocking it, the site down) need different words on screen.
 * Any answer counts as reachable, even an error page; only no answer at all doesn't. Kept two minutes.
 */
const SITES: Record<string, string> = {
	'7Movies': 'https://embed.vidrift.net/',
	Movy: 'https://www.movy.sx/',
	Vidfast: 'https://vidfast.vc/',
	HiAnime: 'https://zokoanime.video/',
	Aniwave: 'https://aniwaves.ru/',
	Showbox: 'https://www.febbox.com/'
};
const known = new Map<string, { at: number; ok: boolean }>();

export async function sourceReachable(source: string): Promise<boolean> {
	const site = SITES[source];
	if (!site) return true;
	const hit = known.get(source);
	if (hit && Date.now() - hit.at < 120_000) return hit.ok;
	const ok = await fetch(site, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) })
		.then(() => true)
		.catch(() => false);
	known.set(source, { at: Date.now(), ok });
	return ok;
}

/** What to say when a source gave nothing: "unreachable" when its site doesn't answer at all. */
export async function nothingFrom(source: string, otherwise: string): Promise<string> {
	return (await sourceReachable(source)) ? otherwise : 'unreachable';
}
