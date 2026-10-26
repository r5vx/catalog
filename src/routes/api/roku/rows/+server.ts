import { error, json } from '@sveltejs/kit';
import { tvLibrary } from '$lib/server/db/queries';
import { continueWatchingWithPosters } from '$lib/server/continueWatching';
import { browseShelves } from '$lib/server/metadata';
import { tvTitleLink } from '$lib/server/tvLinks';
import { browseFor } from '$lib/server/tvBrowse';
import { bigPicture, fromContinue, fromLibrary, fromResult, type Tile, type TileMenu, type TileRow } from '$lib/tv/tiles';
import type { RequestHandler } from './$types';

/**
 * The Roku's screens of posters, row for row what the Fire TV shows (built by the same
 * src/lib/tv/tiles.ts): ?screen=home, movies, tv, anime, or library (&status=). Each tile says
 * where OK goes (`href`: a title's page, or the player), what the banner says about it, and
 * what the remote's menu button offers (`menu`). The rows that take a moment (trending) are
 * waited for a few seconds, then left out.
 */
export const GET: RequestHandler = async ({ url }) => {
	const screen = url.searchParams.get('screen') ?? 'home';
	let rows: TileRow[] = [];
	let later: Promise<TileRow[]> = Promise.resolve([]);
	let wait = 6000;

	if (screen === 'home') {
		const library = tvLibrary();
		const continuing = await continueWatchingWithPosters();
		const links = await Promise.all(continuing.map((item) => (item.type === 'replay' ? null : tvTitleLink(item.title, item.type).catch(() => null))));
		const overviewOf = (title: string) => library.find((item) => item.title.toLowerCase() === title.toLowerCase())?.overview ?? null;
		rows = [
			{ label: 'Continue Watching', tiles: continuing.map((item, i) => fromContinue({ ...item, link: links[i] }, overviewOf(item.title))) },
			{ label: 'Watching', tiles: library.filter((item) => item.status === 'watching').map(fromLibrary) },
			{ label: 'Want to watch', tiles: library.filter((item) => item.status === 'planned').map(fromLibrary) },
			{ label: 'Watch again', tiles: library.filter((item) => item.status === 'completed').slice(0, 40).map(fromLibrary) }
		];
		later = browseShelves()
			.then((shelves) => shelves.map((shelf) => ({ label: shelf.label, tiles: shelf.results.map(fromResult) })))
			.catch(() => []);
	} else if (screen === 'library') {
		const status = url.searchParams.get('status') ?? '';
		const library = tvLibrary();
		rows = [{ label: '', tiles: (status ? library.filter((item) => item.status === status) : library).map(fromLibrary) }];
	} else {
		const found = browseFor(screen);
		if (!found) return error(404, 'Nothing here.');
		rows = [
			{ label: 'Watching', tiles: found.library.filter((item) => item.status === 'watching').map(fromLibrary) },
			{ label: 'Want to watch', tiles: found.library.filter((item) => item.status === 'planned').map(fromLibrary) },
			{ label: 'Watched', tiles: found.library.filter((item) => item.status === 'completed').map(fromLibrary) }
		];
		later = found.shelves.then((shelves) => shelves.map((shelf) => ({ label: shelf.label, tiles: shelf.results.map(fromResult) })));
		wait = 15000;
	}
	const more = await Promise.race([later, new Promise<TileRow[]>((resolve) => setTimeout(() => resolve([]), wait))]);
	// The banner's picture, at a size fit for half a TV; where OK goes; what * offers.
	const withBig = (tile: Tile) => ({ ...tile, big: bigPicture(tile.poster), go: goOf(tile.href), actions: tile.menu ? actionsFor(tile.menu) : [], warm: warmOf(tile) });
	return json({
		rows: [...rows, ...more].filter((row) => row.tiles.length).map((row) => ({ label: row.label, tiles: row.tiles.slice(0, screen === 'library' ? 1000 : 120).map(withBig) }))
	});
};

/** Where a tile's OK goes, from its Fire TV address: a title's page, a replay, or the player. */
function goOf(href: string) {
	if (href.startsWith('/watch?replay=')) {
		const q = new URL(href, 'http://catalog').searchParams;
		return { place: 'replay', replay: q.get('replay') ?? '', label: q.get('name') ?? '' };
	}
	if (href.startsWith('/tv/title/')) {
		const [, , , source, id] = href.split('/');
		return { place: 'title', source, sourceId: decodeURIComponent(id) };
	}
	const q = new URL(href, 'http://catalog').searchParams;
	return { place: 'play', title: q.get('title') ?? '', type: q.get('type') ?? 'movie', year: q.get('year') ?? '', season: Number(q.get('resume_s') ?? 0), episode: Number(q.get('resume_e') ?? 0) };
}

type Call = { method: string; path: string; body?: unknown };

/** What the remote's menu button offers for a tile, as on the Fire TV (src/lib/tv/TvMenu.svelte): the calls each makes. */
function actionsFor(what: TileMenu): { label: string; calls: Call[] }[] {
	if (what.kind === 'continue') {
		const off: Call = { method: 'DELETE', path: `/api/watch/progress?title=${encodeURIComponent(what.title)}&type=${what.type}&hide=1` };
		const complete: Call | null = what.entryId
			? { method: 'PATCH', path: '/api/entries', body: { id: what.entryId, action: 'complete' } }
			: what.link
				? { method: 'POST', path: '/api/add', body: { source: what.link.source, sourceId: what.link.id, status: 'completed' } }
				: null;
		return [
			...(what.newEpisode ? [{ label: 'Dismiss new episode', calls: [{ method: 'POST', path: '/api/watch/caught-up', body: { title: what.title, dismiss: true } }] }] : []),
			{ label: 'Mark as watched', calls: complete ? [complete, off] : [off] },
			{ label: 'Remove from Continue Watching', calls: [off] }
		];
	}
	if (what.kind === 'library') {
		return [
			...(what.status !== 'completed' ? [{ label: 'Mark as watched', calls: [{ method: 'PATCH', path: '/api/entries', body: { id: what.id, action: 'complete' } }] }] : []),
			{ label: 'Remove from My Library', calls: [{ method: 'DELETE', path: '/api/entries', body: { id: what.id } }] }
		];
	}
	return [
		{ label: 'Add to My List', calls: [{ method: 'POST', path: '/api/add', body: { source: what.source, sourceId: what.sourceId, status: 'planned' } }] },
		{ label: 'Mark as watched', calls: [{ method: 'POST', path: '/api/add', body: { source: what.source, sourceId: what.sourceId, status: 'completed' } }] }
	];
}

/**
 * A Continue Watching tile's video, started in the background while it's highlighted (as the
 * Fire TV does: /api/watch/resolve?warm=1), so pressing Play is near-instant.
 */
function warmOf(tile: Tile) {
	if (tile.menu?.kind !== 'continue') return null;
	const at = /S(\d+)E(\d+)/.exec(tile.note ?? '');
	return { title: tile.menu.title, type: tile.menu.type, season: Number(at?.[1] ?? 0), episode: Number(at?.[2] ?? 0) };
}
