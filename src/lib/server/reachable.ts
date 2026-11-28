/**
 * Whether a source's site answers at all, for when it gave nothing: "nothing for this" and "can't
 * be reached" (an internet provider blocking it, the site down) need different words on screen.
 * Any answer counts as reachable, even an error page; only no answer at all doesn't. Kept two minutes.
 */
export const SITES: Record<string, string> = {
	'7Movies': 'https://embed.vidrift.net/api/server',
	Movy: 'https://www.movy.sx/',
	Vidfast: 'https://vidfast.vc/',
	'Xumo Play': 'https://valencia-app-mds.xumo.com/v2/proxy/channels/list/10006.json',
	Plex: 'https://plex.tv/api/v2/ping',
	'Pluto TV': 'https://boot.pluto.tv/v4/start?appName=web&appVersion=9',
	Tubi: 'https://tubitv.com/',
	HiAnime: 'https://zokoanime.video/',
	Aniwave: 'https://aniwaves.ru/',
	Showbox: 'https://showbox.media/',
	Febbox: 'https://www.febbox.com/',
	Torrentio: 'https://torrentio.strem.fun/manifest.json',
	'Real-Debrid': 'https://api.real-debrid.com/rest/1.0/time',
	TorBox: 'https://api.torbox.app/',
	AllDebrid: 'https://api.alldebrid.com/',
	Premiumize: 'https://www.premiumize.me/',
	KickAssAnime: 'https://kaa.lt/',
	AllAnime: 'https://allmanga.to/',
	'Anime Nexus': 'https://anime.nexus/',
	Nyaa: 'https://nyaa.si/',
	DaddyLive: 'https://thedaddy.li/',
	YouTube: 'https://www.youtube.com/',
	'Football replays': 'https://nfl-video.com/',
	'Basketball replays': 'https://basketball-video.com/',
	'Soccer replays': 'https://soccerfull.net/'
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
