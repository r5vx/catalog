/**
 * anime.nexus, for its subtitles only — its video stays on its own site.
 *
 * Each episode comes with proper subtitle files: "English" for the Japanese audio, "English CC"
 * (closed captions that follow the English dub word for word, which are hard to find anywhere
 * else), "English Signs", and other languages. They're plain .ass files anyone can download.
 *
 * Search and the episode list answer plain requests. The list of an episode's subtitles is only
 * handed to the site's own page, so the desktop app opens that page out of sight, reads the
 * list the page receives, and closes it before any video plays (`readPageAnswer` in
 * `electron/main.cjs`). No human check is involved. Outside the desktop app there are none.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { electronPageAnswer } from '../electron-fetch';

const API = 'https://api.anime.nexus/api/anime';
const SITE = 'https://anime.nexus';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;

export interface NexusShow {
	id: string;
	name: string;
	alt: string;
	type: string;
	/** YYYY-MM-DD */
	start: string | null;
	count: number;
}

export interface NexusEpisode {
	id: string;
	number: number;
	slug: string;
}

export interface NexusSubtitle {
	label: string;
	src: string;
	lang: string;
}

async function ask<T>(path: string): Promise<T | null> {
	try {
		const resp = await fetch(`${API}${path}`, {
			headers: { 'User-Agent': UA, Accept: 'application/json', Origin: SITE, Referer: `${SITE}/` },
			signal: AbortSignal.timeout(12000)
		});
		if (!resp.ok) return null;
		return (await resp.json()) as T;
	} catch {
		return null;
	}
}

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

export async function searchNexus(query: string): Promise<NexusShow[]> {
	const key = `nexus-search|${query.toLowerCase()}`;
	const known = saved<NexusShow[]>(key, 24 * HOUR);
	if (known) return known;

	type Show = { id: string; name: string; name_alt?: string; type?: string; release_date?: string; episode_count?: number };
	const data = await ask<{ data?: Show[] }>(`/shows?search=${encodeURIComponent(query)}&sortBy=name+asc&page=1&hasVideos=1`);
	if (!data) return [];
	const shows = (data.data ?? []).map((s) => ({
		id: s.id,
		name: s.name,
		alt: s.name_alt ?? '',
		type: s.type ?? '',
		start: s.release_date ?? null,
		count: s.episode_count ?? 0
	}));
	saveOrderCache(key, shows, Date.now());
	return shows;
}

export async function nexusEpisodes(showId: string): Promise<NexusEpisode[]> {
	const key = `nexus-episodes|${showId}`;
	const known = saved<NexusEpisode[]>(key, 6 * HOUR);
	if (known) return known;

	type Page = { data?: { id: string; number: number; slug: string }[]; meta?: { last_page?: number } };
	const episodes: NexusEpisode[] = [];
	for (let page = 1; page <= 20; page++) {
		const data = await ask<Page>(`/details/episodes?id=${showId}&page=${page}&perPage=100&order=asc&fillers=true&recaps=true`);
		if (!data) return episodes; // couldn't ask: use what there is, don't remember
		for (const e of data.data ?? []) episodes.push({ id: e.id, number: Number(e.number), slug: e.slug });
		if (page >= (data.meta?.last_page ?? 1)) break;
	}
	saveOrderCache(key, episodes, Date.now());
	return episodes;
}

/** When anime.nexus last wanted its human check, so it isn't asked again for every episode. */
let checkWantedAt = 0;

/**
 * The subtitle files for one episode, read from the episode's own page. Kept for a week.
 * "check" when anime.nexus wants its human check first (passed once in a while, like a
 * sign-in); with `visible`, its page is shown so the owner can pass it.
 */
export async function nexusSubtitles(episode: NexusEpisode, visible = false): Promise<NexusSubtitle[] | 'check'> {
	const key = `nexus-subtitles|${episode.id}`;
	const known = saved<NexusSubtitle[]>(key, 7 * 24 * HOUR);
	if (known) return known;
	if (!visible && Date.now() - checkWantedAt < 10 * 60 * 1000) return 'check';

	const answer = await electronPageAnswer(`${SITE}/watch/${episode.id}/${episode.slug}`, '/details/episode/stream', visible);
	if (answer.status === 403 && !answer.body) {
		checkWantedAt = Date.now();
		return 'check';
	}
	if (!answer.body) return [];
	checkWantedAt = 0;
	try {
		type Sub = { src?: string; label?: string; srcLang?: string };
		const data = JSON.parse(answer.body) as { data?: { subtitles?: Sub[] } };
		const subs = (data.data?.subtitles ?? [])
			.filter((s) => s.src)
			.map((s) => ({ label: s.label ?? '', src: s.src!, lang: s.srcLang ?? '' }));
		saveOrderCache(key, subs, Date.now());
		return subs;
	} catch {
		return [];
	}
}
