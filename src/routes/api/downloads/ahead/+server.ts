import { error, json } from '@sveltejs/kit';
import { downloadsAheadList, removeAhead } from '$lib/server/episodeDownloads';
import { startDownload } from '$lib/server/downloads';
import { tmdbGet } from '$lib/server/metadata/tmdb';
import type { RequestHandler } from './$types';

/**
 * Episodes and films on this computer for now: what 7Movies and Movy copies the computer has
 * downloaded ahead so they play without waiting (src/lib/server/episodeDownloads.ts). Downloads
 * lists them apart from what was downloaded on purpose: they go by themselves (six hours after
 * they were last played; a new episode after eight days), unless Keep makes one a download.
 */
type Named = { title: string; year: string; poster: string | null };
const names = new Map<string, Named | null>();

/** A share key's parts: "vidrift:tv:2734:28:5:avc", "movy:tv:2734:28:5", "vidrift:movie:603:0:0:avc". */
function partsOf(share: string) {
	const m = share.match(/^(vidrift|movy):(tv|movie):(\d+)(?::(\d+))?(?::(\d+))?(?::(hevc|avc))?/);
	if (!m) return null;
	const kind = m[1] as 'vidrift' | 'movy';
	return {
		source: kind === 'vidrift' ? '7Movies' : 'Movy',
		type: m[2] as 'tv' | 'movie',
		id: Number(m[3]),
		season: Number(m[4]) || 0,
		episode: Number(m[5]) || 0,
		// (The copies' numbers, as the sources list them: vidrift.ts and movy.ts.)
		fid: kind === 'movy' ? -5 : m[6] === 'hevc' ? -3 : -4,
		hevc: m[6] === 'hevc'
	};
}

async function nameOf(type: 'tv' | 'movie', id: number): Promise<Named | null> {
	const key = `${type}:${id}`;
	if (names.has(key)) return names.get(key) ?? null;
	type Details = { name?: string; title?: string; first_air_date?: string; release_date?: string; poster_path?: string | null };
	const details = await tmdbGet<Details>(`/${type}/${id}`).catch(() => null);
	const named = details
		? {
				title: details.name ?? details.title ?? '',
				year: (details.first_air_date ?? details.release_date ?? '').slice(0, 4),
				poster: details.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : null
			}
		: null;
	// (Not kept when TMDB didn't answer: asked again next time.)
	if (named?.title) names.set(key, named);
	return named?.title ? named : null;
}

/** One row per film or episode: its picture copy (the biggest of its copies), sound tracks added in. */
async function listed() {
	const byShare = new Map<string, ReturnType<typeof downloadsAheadList>>();
	for (const copy of downloadsAheadList()) {
		const share = copy.copy.split('~')[0];
		byShare.set(share, [...(byShare.get(share) ?? []), copy]);
	}
	const rows = [];
	for (const [share, copies] of byShare) {
		const parts = partsOf(share);
		if (!parts) continue;
		const main = copies.reduce((best, c) => (c.bytes > best.bytes ? c : best));
		const named = await nameOf(parts.type, parts.id);
		rows.push({
			share,
			...parts,
			title: named?.title ?? '',
			year: named?.year ?? '',
			poster: named?.poster ?? null,
			here: main.here,
			total: main.total,
			bytes: copies.reduce((sum, c) => sum + c.bytes, 0),
			until: Math.max(...copies.map((c) => c.until)),
			busy: copies.some((c) => c.busy)
		});
	}
	return rows.sort((a, b) => b.until - a.until);
}

export const GET: RequestHandler = async () => json({ ahead: await listed() });

/** Keep: made a download like any other (its pieces are read off this computer, so it's quick). Body: { share }. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const row = (await listed()).find((r) => r.share === body?.share);
	if (!row || !row.title) return error(404, "That one isn't here any more");
	return json(
		startDownload({
			kind: row.type === 'tv' ? 'episode' : 'film',
			title: row.title,
			year: row.year,
			season: row.season,
			episode: row.episode,
			episodeName: null,
			poster: row.poster,
			source: row.source,
			shareKey: row.share,
			fid: row.fid,
			replayId: null,
			replayVersion: null,
			height: 0,
			audio: '',
			subtitles: null,
			estimate: row.bytes
		})
	);
};

/** Removed now rather than when its time is up (?share=). Not while it's being played. */
export const DELETE: RequestHandler = async ({ url }) => {
	const share = url.searchParams.get('share') ?? '';
	const copies = downloadsAheadList().filter((c) => c.copy.split('~')[0] === share);
	if (!copies.length) return json({ ok: true });
	if (copies.some((c) => c.busy)) return error(409, "It's being played or downloaded right now");
	for (const c of copies) removeAhead(c.copy);
	return json({ ok: true });
};
