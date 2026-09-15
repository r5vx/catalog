import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { plainText } from './types';

/** A tag and what sort of thing it is, so the filter can group them. */
export type DerivedTag = { name: string; kind: 'genre' | 'studio' | 'director' | 'franchise' };

export type DerivedCast = {
	sourceId: string;
	name: string;
	photo: string | null;
	character: string | null;
};

/**
 * Everything a database knows about one title.
 *
 * Tags and cast are the parts that get stored when you add something. The rest
 * is for reading — the synopsis and the numbers shown on a title's page,
 * whether or not it's in your library.
 */
export type TitleDetails = {
	tags: DerivedTag[];
	cast: DerivedCast[];
	title: string | null;
	altTitle: string | null;
	year: number | null;
	overview: string | null;
	tagline: string | null;
	posterUrl: string | null;
	backdropUrl: string | null;
	runtimeMinutes: number | null;
	episodesTotal: number | null;
	seasons: number | null;
	externalRating: number | null;
	externalVotes: number | null;
	/** Needed to ask OMDb for IMDb and Rotten Tomatoes scores. */
	imdbId: string | null;
	status: string | null;
	homepage: string | null;
	kind: string;
	categorySlug: 'anime' | 'movies' | 'tv';
};

const EMPTY: TitleDetails = {
	tags: [],
	cast: [],
	title: null,
	altTitle: null,
	year: null,
	overview: null,
	tagline: null,
	posterUrl: null,
	backdropUrl: null,
	runtimeMinutes: null,
	episodesTotal: null,
	seasons: null,
	externalRating: null,
	externalVotes: null,
	imdbId: null,
	status: null,
	homepage: null,
	kind: 'Movie',
	categorySlug: 'movies'
};

/** Main cast only — billing order, which is who you'd actually recognise. */
const CAST_LIMIT = 15;

const tmdbKey = () => (readSettings().tmdbApiKey || env.TMDB_API_KEY || '').trim();

/**
 * Tags come from facts the databases already record, not from anything we
 * invent: who directed it, who made it, what franchise it belongs to, and its
 * genres. That's what makes "show me everything Tarantino" or "all my Marvel"
 * work without you tagging 300 films by hand.
 */
export async function fetchDetails(source: string, sourceId: string): Promise<TitleDetails> {
	try {
		return source === 'anilist' ? await fromAniList(sourceId) : await fromTmdb(sourceId);
	} catch {
		return EMPTY;
	}
}

/**
 * Everything this person is known for, most-voted first.
 *
 * Deliberately deep rather than a top-20: the caller strips out what you
 * already own, and for someone whose famous work you've mostly seen a short
 * list would come back empty.
 */
const KNOWN_FOR_DEPTH = 200;

/** What this person is best known for, whether or not you've seen it. */
export async function fetchKnownFor(sourceId: string) {
	const [provider, id] = sourceId.split(':');

	try {
		if (provider === 'tmdb') {
			const key = tmdbKey();
			if (!key) return [];

			const url = new URL(`https://api.themoviedb.org/3/person/${id}/combined_credits`);
			const init = key.startsWith('eyJ')
				? { headers: { Authorization: `Bearer ${key}` } }
				: (url.searchParams.set('api_key', key), {});

			const response = await fetch(url, init);
			if (!response.ok) return [];

			const data = await response.json();
			return (data.cast ?? [])
				.filter((c: Record<string, unknown>) => (c.vote_count as number) > 20)
				.sort((a: Record<string, number>, b: Record<string, number>) => b.vote_count - a.vote_count)
				.slice(0, KNOWN_FOR_DEPTH)
				.map((c: Record<string, unknown>) => ({
					title: (c.title as string) ?? (c.name as string) ?? '',
					year: String((c.release_date as string) ?? (c.first_air_date as string) ?? '').slice(0, 4),
					character: (c.character as string) || null,
					poster: c.poster_path ? `https://image.tmdb.org/t/p/w185${c.poster_path}` : null,
					// Enough to add it straight to the library from here.
					source: 'tmdb',
					sourceId: `${c.media_type === 'tv' ? 'tv' : 'movie'}:${c.id}`,
					kind: c.media_type === 'tv' ? 'TV' : 'Movie',
					categorySlug: c.media_type === 'tv' ? 'tv' : 'movies',
					rating: (c.vote_average as number) || null,
					votes: (c.vote_count as number) || null
				}));
		}

		const response = await fetch('https://graphql.anilist.co', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: `query($id:Int){Staff(id:$id){characters(sort:FAVOURITES_DESC,perPage:50){edges{
					node{ name{ full } }
					media{ nodes{ id title{ english romaji } startDate{ year } coverImage{ medium } averageScore popularity } }
				}}}}`,
				variables: { id: Number(id) }
			})
		});
		if (!response.ok) return [];

		const edges = (await response.json())?.data?.Staff?.characters?.edges ?? [];
		return edges
			.map((edge: Record<string, any>) => {
				const media = edge.media?.nodes?.[0];
				if (!media) return null;
				return {
					title: media.title?.english || media.title?.romaji || '',
					year: media.startDate?.year ? String(media.startDate.year) : '',
					character: edge.node?.name?.full ?? null,
					poster: media.coverImage?.medium ?? null,
					source: 'anilist',
					sourceId: String(media.id ?? ''),
					kind: 'Anime',
					categorySlug: 'anime',
					rating: media.averageScore ? media.averageScore / 10 : null,
					votes: media.popularity ?? null
				};
			})
			.filter(Boolean)
			.slice(0, KNOWN_FOR_DEPTH);
	} catch {
		return [];
	}
}

async function fromTmdb(sourceId: string): Promise<TitleDetails> {
	const key = tmdbKey();
	if (!key) return EMPTY;

	const [kind, id] = sourceId.split(':');
	if (!id) return EMPTY;

	const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
	// external_ids is where a TV show's IMDb id lives; a film carries its own.
	url.searchParams.set('append_to_response', 'credits,external_ids');

	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return EMPTY;

	const data = await response.json();
	const tags: DerivedTag[] = [];

	for (const genre of data.genres ?? []) {
		if (genre?.name) tags.push({ name: genre.name, kind: 'genre' });
	}

	for (const company of data.production_companies ?? []) {
		if (company?.name) tags.push({ name: company.name, kind: 'studio' });
	}

	const directors = (data.credits?.crew ?? []).filter(
		(person: { job?: string }) => person.job === 'Director'
	);
	// TV uses created_by rather than a director credit.
	const creators = data.created_by ?? [];

	for (const person of [...directors, ...creators]) {
		if (person?.name) tags.push({ name: person.name, kind: 'director' });
	}

	const collection = data.belongs_to_collection?.name;
	if (collection) {
		tags.push({ name: collection.replace(/\s+Collection$/i, '').trim(), kind: 'franchise' });
	}

	const cast: DerivedCast[] = (data.credits?.cast ?? [])
		.slice(0, CAST_LIMIT)
		.map((person: Record<string, unknown>) => ({
			sourceId: `tmdb:${person.id}`,
			name: String(person.name ?? ''),
			photo: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null,
			character: (person.character as string) || null
		}))
		.filter((person: DerivedCast) => person.sourceId && person.name);

	const isSeries = kind === 'tv';
	const released = String(data.release_date ?? data.first_air_date ?? '');

	return {
		tags,
		cast,
		title: data.title ?? data.name ?? null,
		altTitle: (data.original_title ?? data.original_name ?? null) || null,
		year: Number(released.slice(0, 4)) || null,
		overview: data.overview || null,
		tagline: data.tagline || null,
		posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
		backdropUrl: data.backdrop_path
			? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
			: null,
		runtimeMinutes: data.runtime ?? data.episode_run_time?.[0] ?? null,
		episodesTotal: data.number_of_episodes ?? null,
		seasons: data.number_of_seasons ?? null,
		externalRating: data.vote_average || null,
		externalVotes: data.vote_count || null,
		imdbId: data.imdb_id ?? data.external_ids?.imdb_id ?? null,
		status: data.status || null,
		homepage: data.homepage || null,
		kind: isSeries ? 'TV' : 'Movie',
		categorySlug: isSeries ? 'tv' : 'movies'
	};
}

async function fromAniList(id: string): Promise<TitleDetails> {
	const response = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: `query($id:Int){Media(id:$id,type:ANIME){
				title{ english romaji native }
				description
				startDate{ year }
				episodes
				duration
				format
				status
				averageScore
				popularity
				siteUrl
				coverImage{ extraLarge large }
				bannerImage
				genres
				studios(isMain:true){nodes{name}}
				characters(sort:ROLE, perPage:15){
					edges{
						node{ name{ full } }
						voiceActors(language:JAPANESE){ id name{ full } image{ medium } }
					}
				}
			}}`,
			variables: { id: Number(id) }
		})
	});

	if (!response.ok) return EMPTY;

	const media = (await response.json())?.data?.Media;
	if (!media) return EMPTY;

	const tags: DerivedTag[] = [];

	for (const genre of media.genres ?? []) tags.push({ name: genre, kind: 'genre' });
	for (const studio of media.studios?.nodes ?? []) {
		if (studio?.name) tags.push({ name: studio.name, kind: 'studio' });
	}

	// For anime the "cast" is the voice actors, labelled with who they play.
	const cast: DerivedCast[] = [];
	const seen = new Set<string>();

	for (const edge of media.characters?.edges ?? []) {
		const actor = edge?.voiceActors?.[0];
		if (!actor?.id || !actor?.name?.full) continue;

		const sourceId = `anilist:${actor.id}`;
		if (seen.has(sourceId)) continue;
		seen.add(sourceId);

		cast.push({
			sourceId,
			name: actor.name.full,
			photo: actor.image?.medium ?? null,
			character: edge.node?.name?.full ?? null
		});
	}

	const english = media.title?.english || null;
	const romaji = media.title?.romaji || null;

	return {
		tags,
		cast,
		title: english || romaji,
		// Show the other name underneath, but never the same one twice.
		altTitle: english && romaji && english !== romaji ? romaji : media.title?.native || null,
		year: media.startDate?.year ?? null,
		// AniList descriptions carry HTML, which would render as markup.
		overview: plainText(media.description),
		tagline: null,
		posterUrl: media.coverImage?.extraLarge || media.coverImage?.large || null,
		backdropUrl: media.bannerImage || null,
		runtimeMinutes: media.duration ?? null,
		episodesTotal: media.episodes ?? null,
		seasons: null,
		externalRating: media.averageScore ? media.averageScore / 10 : null,
		externalVotes: media.popularity ?? null,
		// AniList doesn't carry one; OMDb gets looked up by name instead.
		imdbId: null,
		status: media.status || null,
		homepage: media.siteUrl || null,
		kind: media.format === 'MOVIE' ? 'Movie' : 'Anime',
		categorySlug: 'anime'
	};
}
