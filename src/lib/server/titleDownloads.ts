/**
 * Downloads from a title's page, without opening the player: a film, one season, or a whole show
 * (owner, 2026-11-06). The title is looked up as the player would (`/api/watch/resolve`), each
 * episode's copy picked here, and every one goes into the download queue (downloads.ts), which
 * fetches them one at a time.
 *
 * The copy, as the player's download dialog would: never Showbox's (it would use up Febbox's daily
 * allowance); for anime with a Japanese copy, never the English dub (Catalog never puts someone on
 * the dub by itself); then without subtitles burned into the picture, then H.264 before HEVC
 * (which not every phone or TV plays); otherwise the order the sources are listed in.
 *
 * Captions (English) are fetched when each download's turn comes (downloads.ts `fetchCaptions`),
 * never all at once: ~350 subtitle downloads in a row once blocked the owner's address at
 * OpenSubtitles for a day. They aren't timed yet; playing a download times them to its sound.
 */
import { ownFetch } from './ownFetch';
import { startDownload } from './downloads';
import { findDownload } from './db/queries';
import { parseAniwaveShareKey } from './sources/aniwave';
import { parseHianimeShareKey } from './sources/hianime';
import { parseVidriftShareKey } from './sources/vidrift';
import { parseMovyShareKey } from './sources/movy';
import { parseVidfastShareKey } from './sources/vidfast';
import type { FileOption } from './showbox';
import type { EpisodeList } from './combinedEpisodes';

/** A copy Catalog downloads: another source's than Showbox's. */
export function downloadable(file: FileOption): boolean {
	const key = file.shareKey ?? '';
	if (!file.source || !key) return false;
	return Boolean(parseAniwaveShareKey(key) || parseHianimeShareKey(key) || parseVidriftShareKey(key) || parseMovyShareKey(key) || parseVidfastShareKey(key));
}

/** The copy to download of an episode or film, or null when only Showbox has it. */
export function pickCopy(files: FileOption[]): FileOption | null {
	const ok = files.filter(downloadable);
	if (!ok.length) return null;
	const japanese = files.some((f) => f.audio === 'Japanese');
	const cost = (f: FileOption) => (japanese && f.audio === 'English' ? 8 : 0) + (f.burnedIn ? 2 : 0) + (f.hevc ? 1 : 0);
	// (A stable sort: the sources' own order among equals.)
	return [...ok].sort((a, b) => cost(a) - cost(b))[0];
}

type Resolved = { title: string; type: 'tv' | 'movie'; files?: FileOption[]; episodes?: EpisodeList; posterUrl?: string; error?: string };

async function lookUp(title: string, type: 'tv' | 'movie', year: string): Promise<Resolved | null> {
	const params = new URLSearchParams({ title, type, nostream: '1' });
	if (year) params.set('year', year);
	const answer = await ownFetch(`/api/watch/resolve?${params}`)
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);
	return answer && !answer.error ? answer : null;
}

export type TitleEpisode = { season: number; episode: number; name: string | null; can: boolean; already: boolean };
export type TitleDownloads =
	| { found: false }
	| { found: true; type: 'movie'; title: string; can: boolean; already: boolean }
	| { found: true; type: 'tv'; title: string; episodes: TitleEpisode[] };

/** Episode names from TMDB, by season (the player's own lookup). */
async function namesOf(title: string, season: number): Promise<Record<string, string>> {
	const params = new URLSearchParams({ title, season: String(season) });
	return ownFetch(`/api/watch/episode-names?${params}`)
		.then((r) => (r.ok ? r.json() : {}))
		.catch(() => ({}));
}

/** What a title's page can offer to download: the film, or each episode (can it, already in Downloads). */
export async function titleDownloads(title: string, type: 'tv' | 'movie', year: string): Promise<TitleDownloads> {
	const found = await lookUp(title, type, year);
	if (!found) return { found: false };
	if (found.type !== 'tv') {
		return {
			found: true,
			type: 'movie',
			title: found.title,
			can: Boolean(pickCopy(found.files ?? [])),
			already: Boolean(findDownload('film', found.title, 0, 0, null))
		};
	}
	const listed = (found.episodes?.episodes ?? []).filter((ep) => ep.season > 0 && ep.available !== false);
	const seasons = [...new Set(listed.map((ep) => ep.season))];
	const names = new Map<number, Record<string, string>>();
	await Promise.all(seasons.map(async (s) => names.set(s, await namesOf(found.title, s))));
	return {
		found: true,
		type: 'tv',
		title: found.title,
		episodes: listed
			.sort((a, b) => a.season - b.season || a.episode - b.episode)
			.map((ep) => ({
				season: ep.season,
				episode: ep.episode,
				name: ep.name ?? names.get(ep.season)?.[String(ep.episode)] ?? null,
				can: Boolean(pickCopy(ep.files)),
				already: Boolean(findDownload('episode', found.title, ep.season, ep.episode, null))
			}))
	};
}

export type TitleAsk = {
	title: string;
	type: 'tv' | 'movie';
	year: string;
	poster: string | null;
	/** Which episodes ("season:episode"); null for a film. */
	episodes: string[] | null;
	/** The picture's height wanted (0: the best there is). */
	height: number;
	captions: boolean;
};

/** Puts a film or the episodes asked into the download queue. How many went in, and how many couldn't. */
export async function downloadTitle(ask: TitleAsk): Promise<{ added: number; already: number; none: number } | null> {
	const found = await lookUp(ask.title, ask.type, ask.year);
	if (!found) return null;
	const poster = ask.poster || found.posterUrl || null;
	const base = { year: ask.year, poster, replayId: null, replayVersion: null, height: ask.height, audio: '', estimate: 0 };
	let added = 0;
	let already = 0;
	let none = 0;
	const put = (kind: 'film' | 'episode', copy: FileOption | null, season: number, episode: number, episodeName: string | null) => {
		if (!copy) {
			none += 1;
			return;
		}
		const answer = startDownload({
			...base,
			kind,
			title: found.title,
			season,
			episode,
			episodeName,
			source: copy.source ?? '',
			shareKey: copy.shareKey ?? null,
			fid: copy.fid,
			subtitles: null,
			wantsCaptions: ask.captions
		});
		if (answer.already) already += 1;
		else added += 1;
	};

	if (found.type !== 'tv') {
		put('film', pickCopy(found.files ?? []), 0, 0, null);
		return { added, already, none };
	}
	const wanted = new Set(ask.episodes ?? []);
	const episodes = (found.episodes?.episodes ?? [])
		.filter((ep) => wanted.has(`${ep.season}:${ep.episode}`))
		.sort((a, b) => a.season - b.season || a.episode - b.episode);
	const names = new Map<number, Record<string, string>>();
	for (const s of new Set(episodes.map((ep) => ep.season))) names.set(s, await namesOf(found.title, s));
	for (const ep of episodes) put('episode', pickCopy(ep.files), ep.season, ep.episode, ep.name ?? names.get(ep.season)?.[String(ep.episode)] ?? null);
	return { added, already, none };
}
