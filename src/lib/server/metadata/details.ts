import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';

/** A tag and what sort of thing it is, so the filter can group them. */
export type DerivedTag = { name: string; kind: 'genre' | 'studio' | 'director' | 'franchise' };

export type DerivedCast = {
	sourceId: string;
	name: string;
	photo: string | null;
	character: string | null;
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
export async function fetchDetails(
	source: string,
	sourceId: string
): Promise<{ tags: DerivedTag[]; cast: DerivedCast[] }> {
	try {
		return source === 'anilist' ? await fromAniList(sourceId) : await fromTmdb(sourceId);
	} catch {
		return { tags: [], cast: [] };
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

async function fromTmdb(
	sourceId: string
): Promise<{ tags: DerivedTag[]; cast: DerivedCast[] }> {
	const empty = { tags: [], cast: [] };
	const key = tmdbKey();
	if (!key) return empty;

	const [kind, id] = sourceId.split(':');
	if (!id) return empty;

	const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
	url.searchParams.set('append_to_response', 'credits');

	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return empty;

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

	return { tags, cast };
}

async function fromAniList(
	id: string
): Promise<{ tags: DerivedTag[]; cast: DerivedCast[] }> {
	const empty = { tags: [], cast: [] };

	const response = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: `query($id:Int){Media(id:$id,type:ANIME){
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

	if (!response.ok) return empty;

	const media = (await response.json())?.data?.Media;
	if (!media) return empty;

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

	return { tags, cast };
}
