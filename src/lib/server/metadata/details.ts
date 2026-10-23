import { anilistSaidWait } from './anilistNodes';
import { getOrderCache, saveOrderCache } from '../db/queries';

const DAY = 24 * 60 * 60 * 1000;
import { env } from '$env/dynamic/private';
import { readSettings } from '../settings';
import { plainText } from './types';
import { allDates, onlyInCinemas } from './cinemas';

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
	unreleased?: boolean;
	/** A film out in cinemas but not yet to watch at home; `homeFrom`: when it will be ('' not known). */
	inCinemas?: boolean;
	homeFrom?: string;
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

/** Main cast only — the people you'd actually recognise. */
const CAST_LIMIT = 20;

const tmdbKey = () => (readSettings().tmdbApiKey || env.TMDB_API_KEY || '').trim();

/**
 * Tags come from facts the databases already record, not from anything we
 * invent: who directed it, who made it, what franchise it belongs to, and its
 * genres. That's what makes "show me everything Tarantino" or "all my Marvel"
 * work without you tagging 300 films by hand.
 */
export async function fetchDetails(source: string, sourceId: string): Promise<TitleDetails> {
	// Each title's answer is kept. AniList's is used for three days without asking again: it
	// allows only a few requests a minute, and right after Catalog opens its own background work
	// can use them all up, which made a title's page fail with "AniList is busy". Whenever a
	// fresh answer can't be had, the last one kept is used, however old.
	const key = `details|${source}|${sourceId}`;
	const kept = getOrderCache(key);
	if (kept && source === 'anilist' && Date.now() - kept.at < 3 * DAY) return kept.value as TitleDetails;
	let details = EMPTY;
	try {
		details = source === 'anilist' ? await fromAniList(sourceId) : await fromTmdb(sourceId);
	} catch {}
	if (details.title) saveOrderCache(key, details, Date.now());
	else if (kept) return kept.value as TitleDetails;
	return details;
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

			// The same title can be credited twice — a guest spot and a hosting
			// slot on the same talk show, say. Two entries with one title and
			// year break a keyed list, which froze "Show more" on the click
			// that first reached one.
			const seen = new Set<string>();

			return (data.cast ?? [])
				.filter((c: Record<string, unknown>) => (c.vote_count as number) > 20)
				.sort((a: Record<string, number>, b: Record<string, number>) => b.vote_count - a.vote_count)
				.filter((c: Record<string, unknown>) => {
					const id = `${c.media_type}:${c.id}`;
					if (seen.has(id)) return false;
					seen.add(id);
					return true;
				})
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

		// Kept for a week: AniList allows Catalog only thirty questions a minute, for everything.
		const keyed = `knownfor|anilist:${id}`;
		const kept = getOrderCache(keyed);
		if (kept && Date.now() - kept.at < 7 * DAY) return kept.value as unknown[];

		// Each show they voiced someone in, most popular first (`characters` used to be asked for
		// here, and AniList stopped answering that way: every voice actor had nothing else).
		const response = await fetch('https://graphql.anilist.co', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: `query($id:Int){Staff(id:$id){characterMedia(sort:POPULARITY_DESC,perPage:50){edges{
					characters{ name{ full } }
					node{ id type title{ english romaji } startDate{ year } coverImage{ medium } averageScore popularity }
				}}}}`,
				variables: { id: Number(id) }
			})
		});
		if (response.status === 429) anilistSaidWait(response);
		if (!response.ok) return kept ? (kept.value as unknown[]) : [];

		const edges = (await response.json())?.data?.Staff?.characterMedia?.edges ?? [];
		// Two characters in one show come as two answers: one card, both names.
		const byShow = new Map<number, Record<string, any>>();
		for (const edge of edges as Record<string, any>[]) {
			const media = edge.node;
			if (!media?.id || media.type !== 'ANIME') continue;
			const names = (edge.characters ?? []).map((c: Record<string, any>) => c?.name?.full).filter(Boolean);
			const known = byShow.get(media.id);
			if (known) {
				known.character = [known.character, ...names].filter(Boolean).join(', ');
				continue;
			}
			byShow.set(media.id, {
				title: media.title?.english || media.title?.romaji || '',
				year: media.startDate?.year ? String(media.startDate.year) : '',
				character: names.join(', ') || null,
				poster: media.coverImage?.medium ?? null,
				source: 'anilist',
				sourceId: String(media.id),
				kind: 'Anime',
				categorySlug: 'anime',
				rating: media.averageScore ? media.averageScore / 10 : null,
				votes: media.popularity ?? null
			});
		}
		const list = [...byShow.values()].slice(0, KNOWN_FOR_DEPTH);
		saveOrderCache(keyed, list, Date.now());
		return list;
	} catch {
		return [];
	}
}

async function fromTmdb(sourceId: string): Promise<TitleDetails> {
	const key = tmdbKey();
	if (!key) return EMPTY;

	const [kind, id] = sourceId.split(':');
	if (!id) return EMPTY;

	const isSeries = kind === 'tv';

	const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);

	/**
	 * For a series, `credits` is only whoever is billed on the show record —
	 * The Office returns **four people**. The full cast across every season
	 * lives in `aggregate_credits` (689 for the same show), where each person
	 * carries a `roles` list instead of a single character.
	 *
	 * external_ids is where a series keeps its IMDb id; a film carries its own.
	 */
	// (A film's release dates by kind say whether it's only in cinemas so far: cinemas.ts.)
	url.searchParams.set(
		'append_to_response',
		`${isSeries ? 'aggregate_credits' : 'credits,release_dates'},external_ids`
	);

	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return EMPTY;

	const data = await response.json();
	const tags: DerivedTag[] = [];

	const isAnime = (data.genres ?? []).some((g: { id: number }) => g.id === 16) && data.original_language === 'ja';
	const releaseDate = String(data.release_date ?? data.first_air_date ?? '');

	for (const genre of data.genres ?? []) {
		if (genre?.name) tags.push({ name: genre.name, kind: 'genre' });
	}

	for (const company of data.production_companies ?? []) {
		if (company?.name) tags.push({ name: company.name, kind: 'studio' });
	}

	const crew = data.credits?.crew ?? data.aggregate_credits?.crew ?? [];
	const directors = crew.filter((person: { job?: string; jobs?: { job?: string }[] }) =>
		person.job === 'Director' || person.jobs?.some((one) => one.job === 'Director')
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

	// Whoever appeared most is the main cast; `order` breaks the ties.
	const billed = isSeries
		? [...(data.aggregate_credits?.cast ?? [])].sort(
				(a: Record<string, number>, b: Record<string, number>) =>
					(b.total_episode_count ?? 0) - (a.total_episode_count ?? 0) ||
					(a.order ?? 999) - (b.order ?? 999)
			)
		: (data.credits?.cast ?? []);

	const cast: DerivedCast[] = billed
		.slice(0, CAST_LIMIT)
		.map((person: Record<string, any>) => ({
			sourceId: `tmdb:${person.id}`,
			name: String(person.name ?? ''),
			photo: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null,
			// A series lists every part someone played; the first is the one.
			character: (isSeries ? person.roles?.[0]?.character : person.character) || null
		}))
		.filter((person: DerivedCast) => person.sourceId && person.name);

	return {
		tags,
		cast,
		title: data.title ?? data.name ?? null,
		altTitle: (data.original_title ?? data.original_name ?? null) || null,
		year: Number(releaseDate.slice(0, 4)) || null,
		overview: data.overview || null,
		tagline: data.tagline || null,
		posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
		backdropUrl: data.backdrop_path
			? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
			: null,
		/**
		 * A film carries `runtime`. A series used to carry `episode_run_time`,
		 * and for most of them TMDB now returns an empty array there — which is
		 * why 44 series in a 382-title library had no runtime at all and
		 * sorting by "Longest" skipped every one of them. The length of an
		 * episode that actually aired is the same answer from a field they
		 * still fill in.
		 */
		runtimeMinutes:
			data.runtime ??
			data.episode_run_time?.[0] ??
			data.last_episode_to_air?.runtime ??
			data.next_episode_to_air?.runtime ??
			null,
		episodesTotal: data.number_of_episodes ?? null,
		seasons: data.number_of_seasons ?? null,
		externalRating: data.vote_average || null,
		externalVotes: data.vote_count || null,
		imdbId: data.imdb_id ?? data.external_ids?.imdb_id ?? null,
		status: data.status || null,
		homepage: data.homepage || null,
		kind: isSeries ? 'TV' : 'Movie',
		categorySlug: isAnime ? 'anime' : (isSeries ? 'tv' : 'movies'),
		unreleased: releaseDate.length > 0 && releaseDate > new Date().toISOString().slice(0, 10),
		...(isSeries ? {} : cinemaOnly(onlyInCinemas(allDates(data.release_dates))))
	};
}

const cinemaOnly = (homeFrom: string | null) => (homeFrom === null ? {} : { inCinemas: true, homeFrom });

async function fromAniList(id: string): Promise<TitleDetails> {
	const body = JSON.stringify({
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
			characters(sort:ROLE, perPage:20){
				edges{
					node{ name{ full } }
					voiceActors(language:JAPANESE){ id name{ full } image{ medium } }
				}
			}
		}}`,
		variables: { id: Number(id) }
	});
	const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

	let response = await fetch('https://graphql.anilist.co', opts);

	// A title's own page is worth one short wait; the rest of the app is told to back off.
	if (response.status === 429) {
		anilistSaidWait(response);
		const wait = Number(response.headers.get('Retry-After') ?? '2');
		await new Promise((r) => setTimeout(r, Math.min(wait, 4) * 1000));
		response = await fetch('https://graphql.anilist.co', opts);
	}

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
		categorySlug: 'anime',
		unreleased: media.status === 'NOT_YET_RELEASED'
	};
}

/**
 * Who someone is, for a person who isn't in your library.
 *
 * The cast of a film you don't own has no row here, so their page has to be
 * built from the provider instead — otherwise every actor on a preview page is
 * a dead end, which is exactly what it was.
 */
export async function fetchPerson(
	sourceId: string
): Promise<{ name: string; photo: string | null } | null> {
	const [provider, id] = sourceId.split(':');

	try {
		if (provider === 'tmdb') {
			const key = tmdbKey();
			if (!key) return null;

			const url = new URL(`https://api.themoviedb.org/3/person/${id}`);
			const init = key.startsWith('eyJ')
				? { headers: { Authorization: `Bearer ${key}` } }
				: (url.searchParams.set('api_key', key), {});

			const response = await fetch(url, init);
			if (!response.ok) return null;

			const data = await response.json();
			if (!data?.name) return null;

			return {
				name: String(data.name),
				photo: data.profile_path ? `https://image.tmdb.org/t/p/w185${data.profile_path}` : null
			};
		}

		// Kept for a month, so opening them again doesn't ask AniList.
		const keyed = `person|anilist:${id}`;
		const kept = getOrderCache(keyed);
		if (kept && Date.now() - kept.at < 30 * DAY) return kept.value as { name: string; photo: string | null };

		const response = await fetch('https://graphql.anilist.co', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: `query($id:Int){Staff(id:$id){ name{ full } image{ medium } }}`,
				variables: { id: Number(id) }
			})
		});
		if (response.status === 429) anilistSaidWait(response);
		if (!response.ok) return (kept?.value as { name: string; photo: string | null } | undefined) ?? null;

		const staff = (await response.json())?.data?.Staff;
		if (!staff?.name?.full) return null;

		const person = { name: staff.name.full, photo: staff.image?.medium ?? null };
		saveOrderCache(keyed, person, Date.now());
		return person;
	} catch {
		return null;
	}
}
