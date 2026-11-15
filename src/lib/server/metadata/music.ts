/**
 * The music of a film, show or anime, for the Music tab beside Cast on title and entry pages
 * (owner, 2026-11-15: "a tab to see musical credits of the movie to see music used in it").
 * Three free sources, no keys:
 *   - who did the music: TMDB's crew in its Sound department (composer, music supervisor, songs),
 *     or AniList's staff whose role is music or a theme song;
 *   - the soundtrack albums and every track on them, with who performs it: MusicBrainz;
 *   - an anime's openings and endings, with their artists and episodes: AnimeThemes.moe, else Jikan
 *     (MyAnimeList).
 * MusicBrainz allows one question a second, so its asks wait their turn (a title takes a few
 * seconds the first time). Kept 30 days (a week when nothing was found). When a source couldn't be
 * reached, what was found is shown but not kept, and asked again in a quarter of an hour.
 */
import { getOrderCache, saveOrderCache } from '../db/queries';
import { tmdbGet } from './tmdb';

export type MusicPerson = { name: string; job: string; photo: string | null; sourceId: string | null };
export type Track = { n: string; title: string; artist: string; length: number | null };
export type Album = { title: string; year: string; artist: string; link: string; tracks: Track[] };
export type Theme = { kind: 'Opening' | 'Ending'; title: string; artist: string; episodes: string };
export type Music = { people: MusicPerson[]; albums: Album[]; themes: Theme[] };

export type MusicAsk = { source: string; sourceId: string; title: string; year: string; type: 'movie' | 'tv'; anime: boolean };

const DAY = 24 * 60 * 60 * 1000;
// (A plain name, nothing that says whose Catalog it is.)
const UA = 'Catalog/4 (personal media library)';
const asking = new Map<string, Promise<Music>>();
const MUSIC_JOBS = /music|composer|songs?\b|score|soundtrack|theme/i;
/** Jobs that match those words but aren't who made the music (an orchestra's players). */
const NOT_MUSIC_JOBS = /^musicians?$/i;
/** Answers with a source that couldn't be reached: kept in memory a while, not saved. */
const shortly = new Map<string, { music: Music; at: number }>();
const TRY_AGAIN_AFTER = 15 * 60_000;
/** Set while a lookup runs when one of its sources couldn't be reached. */
type Lookup = { failed: boolean };

export function musicFor(ask: MusicAsk): Promise<Music> {
	const key = `music|${ask.source}:${ask.sourceId}`;
	const kept = getOrderCache(key);
	if (kept && kept.value && Date.now() - kept.at < (isEmpty(kept.value as Music) ? 7 : 30) * DAY) return Promise.resolve(kept.value as Music);
	const recent = shortly.get(key);
	if (recent && Date.now() - recent.at < TRY_AGAIN_AFTER) return Promise.resolve(recent.music);
	const under = asking.get(key);
	if (under) return under;
	const run: Lookup = { failed: false };
	const work = lookUp(ask, run)
		.then((music) => {
			if (run.failed) shortly.set(key, { music, at: Date.now() });
			else {
				shortly.delete(key);
				saveOrderCache(key, music, Date.now());
			}
			return music;
		})
		.catch(() => (kept?.value as Music) ?? { people: [], albums: [], themes: [] })
		.finally(() => asking.delete(key));
	asking.set(key, work);
	return work;
}

const isEmpty = (music: Music) => !music.people?.length && !music.albums?.length && !music.themes?.length;

async function lookUp(ask: MusicAsk, run: Lookup): Promise<Music> {
	const [people, albums, themes] = await Promise.all([musicPeople(ask, run), soundtracks(ask.title, ask.year, ask.type, run), ask.anime ? animeThemes(ask, run) : Promise.resolve([])]);
	return { people, albums, themes };
}

/* ------------------------------------------------------------ who did the music */

async function musicPeople(ask: MusicAsk, run: Lookup): Promise<MusicPerson[]> {
	if (ask.source === 'tmdb') {
		const [kind, id] = ask.sourceId.split(':');
		if (!id) return [];
		type Crew = { id: number; name: string; department?: string; job?: string; jobs?: { job: string }[]; profile_path?: string | null };
		const credits = await tmdbGet<{ crew?: Crew[] }>(kind === 'tv' ? `/tv/${id}/aggregate_credits` : `/movie/${id}/credits`);
		if (!credits) run.failed = true;
		const seen = new Map<number, MusicPerson>();
		for (const person of credits?.crew ?? []) {
			const jobs = person.jobs ? person.jobs.map((j) => j.job) : [person.job ?? ''];
			const musical = jobs.filter((job) => MUSIC_JOBS.test(job) && !NOT_MUSIC_JOBS.test(job.trim()));
			if (person.department !== 'Sound' || !musical.length) continue;
			const before = seen.get(person.id);
			const job = [...new Set([...(before ? before.job.split(', ') : []), ...musical])].join(', ');
			seen.set(person.id, { name: person.name, job, photo: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null, sourceId: `tmdb:${person.id}` });
		}
		// Composers first, then the rest as TMDB lists them.
		return [...seen.values()].sort((a, b) => Number(/composer/i.test(b.job)) - Number(/composer/i.test(a.job))).slice(0, 24);
	}
	if (ask.source === 'anilist') {
		const media = await anilistMusic(Number(ask.sourceId));
		if (!media) run.failed = true;
		return media?.staff ?? [];
	}
	return [];
}

type AniListMusic = { idMal: number | null; staff: MusicPerson[] };
const anilistKept = new Map<number, Promise<AniListMusic | null>>();

/** An AniList anime's MAL id (for Jikan) and its music staff, in one ask. */
function anilistMusic(id: number): Promise<AniListMusic | null> {
	if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
	const kept = anilistKept.get(id);
	if (kept) return kept;
	const work = (async () => {
		try {
			const response = await fetch('https://graphql.anilist.co', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({
					// (Music staff sit past the first fifty on a big show: two pages, most relevant first, in one ask.)
					query:
						'query ($id: Int) { Media(id: $id) { idMal one: staff(page: 1, perPage: 50, sort: [RELEVANCE]) { edges { role node { id name { full } image { medium } } } } two: staff(page: 2, perPage: 50, sort: [RELEVANCE]) { edges { role node { id name { full } image { medium } } } } } }',
					variables: { id }
				}),
				signal: AbortSignal.timeout(10_000)
			});
			if (!response.ok) return null;
			type Edge = { role: string; node: { id: number; name: { full: string }; image?: { medium?: string } } };
			const media = (await response.json())?.data?.Media as { idMal: number | null; one?: { edges?: Edge[] }; two?: { edges?: Edge[] } } | undefined;
			if (!media) return null;
			const staff = [...(media.one?.edges ?? []), ...(media.two?.edges ?? [])]
				.filter((edge) => MUSIC_JOBS.test(edge.role))
				.map((edge) => ({ name: edge.node.name.full, job: edge.role, photo: edge.node.image?.medium ?? null, sourceId: `anilist:${edge.node.id}` }));
			return { idMal: media.idMal ?? null, staff };
		} catch {
			return null;
		}
	})();
	anilistKept.set(id, work);
	setTimeout(() => anilistKept.delete(id), 10 * 60_000).unref?.();
	return work;
}

/* ------------------------------------------------------------ soundtrack albums (MusicBrainz) */

let mbTurn: Promise<unknown> = Promise.resolve();

/** One MusicBrainz ask, a second and a bit after the one before (its own limit); once more when it's busy. */
function musicbrainz<T>(path: string): Promise<T | null> {
	const ask = async (): Promise<T | null> => {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`, {
					headers: { 'User-Agent': UA, Accept: 'application/json' },
					signal: AbortSignal.timeout(12_000)
				});
				if (response.status === 503) {
					await new Promise((r) => setTimeout(r, 2000));
					continue;
				}
				return response.ok ? ((await response.json()) as T) : null;
			} catch {
				return null;
			}
		}
		return null;
	};
	const mine = mbTurn.then(ask);
	mbTurn = mine.then(() => new Promise((r) => setTimeout(r, 1100)));
	return mine;
}

const plain = (text: string) =>
	text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[’']/g, '')
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/**
 * Whether an album's name is this title's soundtrack: it starts with the title, followed by
 * nothing or by words like "Music From…", "(Original Motion Picture Soundtrack)", "Season 2",
 * "Vol. 1". "Starlight Inception" isn't Inception's.
 */
function isTheirs(album: string, title: string): boolean {
	const a = plain(album);
	const t = plain(title).replace(/^the /, '');
	const bare = a.replace(/^the /, '');
	return bare === t || bare.startsWith(`${t} `);
}

async function soundtracks(title: string, year: string, type: 'movie' | 'tv', run: Lookup): Promise<Album[]> {
	if (!title.trim()) return [];
	type Group = { id: string; title: string; 'first-release-date'?: string; 'artist-credit'?: { name: string; joinphrase?: string }[]; releases?: { id: string; status?: string }[] };
	const query = `releasegroup:"${title.replace(/["\\]/g, ' ')}" AND secondarytype:soundtrack`;
	const found = await musicbrainz<{ 'release-groups'?: Group[] }>(`release-group/?query=${encodeURIComponent(query)}&limit=25`);
	if (!found) run.failed = true;
	const first = Number(year) || 0;
	const groups = (found?.['release-groups'] ?? []).filter((group) => {
		if (!isTheirs(group.title, title)) return false;
		const out = Number((group['first-release-date'] ?? '').slice(0, 4)) || 0;
		if (!first || !out) return true;
		// A film's album comes out around the film; a show's over the years it runs.
		return type === 'movie' ? out >= first - 1 && out <= first + 2 : out >= first - 1;
	});
	// The main album first ("Music From the Motion Picture", "Original Soundtrack"), then by date.
	const main = (name: string) => /music from|original (motion picture )?(soundtrack|score)|soundtrack|score/i.test(name);
	groups.sort((a, b) => Number(main(b.title)) - Number(main(a.title)) || (a['first-release-date'] ?? '').localeCompare(b['first-release-date'] ?? ''));
	const albums: Album[] = [];
	for (const group of groups.slice(0, 4)) {
		const release = group.releases?.find((one) => one.status === 'Official') ?? group.releases?.[0];
		if (!release) continue;
		type Credit = { name: string; joinphrase?: string };
		type Release = { media?: { position?: number; tracks?: { number?: string; title: string; length?: number | null; 'artist-credit'?: Credit[] }[] }[] };
		const full = await musicbrainz<Release>(`release/${release.id}?inc=recordings+artist-credits`);
		if (!full) run.failed = true;
		const credit = (list?: Credit[]) => (list ?? []).map((c) => `${c.name}${c.joinphrase ?? ''}`).join('').trim();
		const discs = full?.media ?? [];
		const tracks = discs.flatMap((disc) =>
			(disc.tracks ?? []).map((track) => ({
				n: discs.length > 1 ? `${disc.position ?? 1}.${track.number ?? ''}` : (track.number ?? ''),
				title: track.title,
				artist: credit(track['artist-credit']),
				length: track.length ? Math.round(track.length / 1000) : null
			}))
		);
		// (An album MusicBrainz lists without its tracks has nothing to show.)
		if (!tracks.length) continue;
		albums.push({
			title: group.title,
			year: (group['first-release-date'] ?? '').slice(0, 4),
			artist: credit(group['artist-credit']),
			link: `https://musicbrainz.org/release-group/${group.id}`,
			tracks: tracks.slice(0, 120)
		});
	}
	return albums;
}

/* ------------------------------------------------------------ an anime's openings and endings (Jikan) */

async function jikan<T>(path: string): Promise<T | null> {
	try {
		const response = await fetch(`https://api.jikan.moe/v4/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
		return response.ok ? ((await response.json()) as T) : null;
	} catch {
		return null;
	}
}

/** MyAnimeList's id: AniList knows it; for TMDB's anime, MyAnimeList is searched by name and year. */
async function malIdOf(ask: MusicAsk): Promise<number | null> {
	if (ask.source === 'anilist') return (await anilistMusic(Number(ask.sourceId)))?.idMal ?? null;
	type Found = { data?: { mal_id: number; title: string; title_english?: string | null; year?: number | null; aired?: { prop?: { from?: { year?: number | null } } } }[] };
	const found = await jikan<Found>(`anime?q=${encodeURIComponent(ask.title)}&limit=10`);
	const year = Number(ask.year) || 0;
	const list = found?.data ?? [];
	const named = (one: (typeof list)[number]) => [one.title, one.title_english ?? ''].some((name) => plain(name) === plain(ask.title));
	const yearOf = (one: (typeof list)[number]) => one.year ?? one.aired?.prop?.from?.year ?? 0;
	const pick = list.find((one) => named(one) && (!year || Math.abs(yearOf(one) - year) <= 1)) ?? list.find(named);
	return pick?.mal_id ?? null;
}

/** '1: "Sakura" by Artist (eps 1-12)' → its parts. */
function themeFrom(line: string, kind: Theme['kind']): Theme {
	const text = line.replace(/^\s*\d+:\s*/, '').trim();
	const match = text.match(/^"(.+?)"\s*(?:by\s+(.+?))?\s*(?:\((eps?\s*[^)]*)\))?\s*$/i);
	if (!match) return { kind, title: text, artist: '', episodes: '' };
	return { kind, title: match[1].trim(), artist: (match[2] ?? '').trim(), episodes: (match[3] ?? '').replace(/^eps?\s*/i, '').trim() };
}

/**
 * AnimeThemes.moe's openings and endings for an anime by its AniList or MyAnimeList id: each with
 * its song, artists and episodes. Null when it couldn't be asked; [] when it has none.
 */
async function fromAnimeThemes(site: 'AniList' | 'MyAnimeList', id: number): Promise<Theme[] | null> {
	type Artist = { name: string; artistsong?: { as?: string | null } | null };
	type Entry = { episodes?: string | null };
	type AnimeTheme = { type?: string; sequence?: number | null; song?: { title?: string | null; artists?: Artist[] } | null; animethemeentries?: Entry[] };
	const params = new URLSearchParams({
		'filter[has]': 'resources',
		'filter[site]': site,
		'filter[external_id]': String(id),
		include: 'animethemes.song.artists,animethemes.animethemeentries'
	});
	try {
		const response = await fetch(`https://api.animethemes.moe/anime?${params}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
		if (!response.ok) return null;
		const anime = ((await response.json())?.anime ?? []) as { animethemes?: AnimeTheme[] }[];
		const themes = anime[0]?.animethemes ?? [];
		return themes
			.filter((theme) => theme.type === 'OP' || theme.type === 'ED')
			.sort((a, b) => (a.type === b.type ? (a.sequence ?? 0) - (b.sequence ?? 0) : a.type === 'OP' ? -1 : 1))
			.map((theme): Theme => ({
				kind: theme.type === 'OP' ? 'Opening' : 'Ending',
				title: theme.song?.title ?? '',
				artist: (theme.song?.artists ?? []).map((a) => (a.artistsong?.as ? `${a.artistsong.as} (${a.name})` : a.name)).join(', '),
				episodes: [...new Set((theme.animethemeentries ?? []).map((e) => e.episodes ?? '').filter(Boolean))].join(', ')
			}))
			.filter((theme) => theme.title);
	} catch {
		return null;
	}
}

async function animeThemes(ask: MusicAsk, run: Lookup): Promise<Theme[]> {
	// AniList's own id goes straight to AnimeThemes; MyAnimeList's is needed for the rest.
	if (ask.source === 'anilist') {
		const found = await fromAnimeThemes('AniList', Number(ask.sourceId));
		if (found?.length) return found;
	}
	const mal = await malIdOf(ask);
	if (!mal) {
		run.failed = true;
		return [];
	}
	if (ask.source !== 'anilist') {
		const found = await fromAnimeThemes('MyAnimeList', mal);
		if (found?.length) return found;
	}
	const answer = await jikan<{ data?: { openings?: string[]; endings?: string[] } }>(`anime/${mal}/themes`);
	if (!answer) run.failed = true;
	return [...(answer?.data?.openings ?? []).map((line) => themeFrom(line, 'Opening')), ...(answer?.data?.endings ?? []).map((line) => themeFrom(line, 'Ending'))];
}
