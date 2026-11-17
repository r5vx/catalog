import { json } from '@sveltejs/kit';
import { cloud, onlineConnected, serverKeepsAll } from '$lib/server/online';
import { currentProfile } from '$lib/server/profile';
import { isFriendAnime } from '$lib/server/friendAnime';
import type { RequestHandler } from './$types';

/**
 * A friend's library for their library page, filtered like your own (owner, 2026-11-16: "it
 * combines anime and shows"; "view other people's want to watch"). ?kind=|movie|tv|anime
 * &status=watched|planned|watching|…|all &sort= &q= &offset=.
 *
 * Films and everything pass straight through. Shows and Anime: Catalogs since 2026-11-17 say which
 * titles are anime; an older Catalog's list says "show" for both, so those are told apart here
 * (friendAnime.ts) from the whole list, then sorted and paged on this computer.
 */
type Item = { key: string; title: string; rating: number | null; year: string; type: string; anime?: boolean; poster: string; status: string };
type Page = { items: Item[]; total: number };

const PAGE = 120;
/** Whole lists asked for Shows/Anime, kept a few minutes (paging and switching tabs ask again). */
const lists = new Map<string, { at: number; items: Item[] }>();

async function ask(id: string, params: URLSearchParams): Promise<Page | null> {
	const answer = await cloud<Page>(`/v1/people/${id}/library?${params}`, { profile: currentProfile() });
	return answer.ok && answer.data ? { items: answer.data.items ?? [], total: answer.data.total ?? 0 } : null;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const id = params.id;
	if (!onlineConnected() || !/^[A-Z0-9]{16}$/.test(id)) return json({ items: [], total: 0, statuses: false }, { status: 404 });
	const kind = url.searchParams.get('kind') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const sort = url.searchParams.get('sort') ?? 'rating';
	const q = (url.searchParams.get('q') ?? '').trim();
	const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
	const statuses = await serverKeepsAll();

	const base = new URLSearchParams({ sort });
	if (statuses && status) base.set('status', status);
	if (q) base.set('q', q);

	if (kind !== 'tv' && kind !== 'anime') {
		if (kind === 'movie') base.set('type', 'movie');
		base.set('offset', String(offset));
		const page = await ask(id, base);
		return page ? json({ ...page, statuses }) : json({ error: "Couldn't open that library" }, { status: 502 });
	}

	// Shows or anime: every show (and anime) of theirs, told apart, then this page of it.
	base.set('type', 'tv');
	const listKey = `${currentProfile()}|${id}|${base}`;
	let kept = lists.get(listKey);
	if (!kept || Date.now() - kept.at > 3 * 60_000) {
		const items: Item[] = [];
		for (let at = 0; at < 1200; at += PAGE) {
			base.set('offset', String(at));
			const page = await ask(id, base);
			if (!page) return json({ error: "Couldn't open that library" }, { status: 502 });
			items.push(...page.items);
			if (page.items.length < PAGE) break;
		}
		// A list that marks anime itself (a newer Catalog) is trusted; an older one's is looked up.
		const marked = items.some((item) => item.anime);
		const unknown = marked ? [] : items.filter((item) => item.anime === undefined);
		for (let at = 0; at < unknown.length; at += 8) {
			await Promise.all(unknown.slice(at, at + 8).map(async (item) => (item.anime = await isFriendAnime(item.key))));
		}
		if (lists.size > 30) lists.clear();
		kept = { at: Date.now(), items };
		lists.set(listKey, kept);
	}
	const wanted = kept.items.filter((item) => Boolean(item.anime) === (kind === 'anime'));
	return json({ items: wanted.slice(offset, offset + PAGE), total: wanted.length, statuses });
};
