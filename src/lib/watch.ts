/** The quality the player reaches for first. */
export const PREFERRED_QUALITY = '1080p';

type Pickable = { quality: string; size: string; source?: string; audio?: string };

/**
 * The wanted quality if it's there, otherwise the highest (then largest) file.
 * Showbox's files come first; another source's (Aniwave) only when Showbox has none, and then
 * the one in the wanted audio ("Japanese" or "English") if there is one.
 */
export function pickFile<T extends Pickable>(files: T[], wanted: string, audio = ''): T | null {
	if (!files.length) return null;
	const showbox = files.filter((f) => !f.source);
	if (!showbox.length) return files.find((f) => audio && f.audio === audio) ?? files[0];
	const exact = showbox.find((f) => f.quality === wanted);
	if (exact) return exact;
	const sorted = [...showbox].sort((a, b) => {
		const aq = parseInt(a.quality) || 0;
		const bq = parseInt(b.quality) || 0;
		if (bq !== aq) return bq - aq;
		const aSize = parseFloat(a.size) || 0;
		const bSize = parseFloat(b.size) || 0;
		return bSize - aSize;
	});
	return sorted[0];
}

type EpisodeFiles = {
	season: number;
	episode: number;
	files: { fid: number; quality: string; size: string; source?: string; shareKey?: string }[];
	/** Set when the episode comes from another Showbox entry for the same show. */
	shareKey?: string;
};

const warmed = new Set<string>();

/**
 * Finds a title and its stream link in the background, so opening it is near-instant.
 * Asks with the same parameters the player will, so it fills the same server caches.
 */
export async function warmUpTitle(item: { title: string; type: string; season: number; episode: number }) {
	const key = `${item.title}:${item.type}:${item.season}:${item.episode}`;
	if (warmed.has(key)) return;
	warmed.add(key);
	try {
		const params = new URLSearchParams({ title: item.title, nostream: '1' });
		if (item.type) params.set('type', item.type);
		const resp = await fetch(`/api/watch/resolve?${params}`);
		if (!resp.ok) throw new Error();
		const data = await resp.json();
		// Films fetch their link as part of the lookup, so they're already warm.
		if (data.error || !data.episodes) return;
		const episodes = data.episodes.episodes as EpisodeFiles[];
		const ep = episodes.find((e) => e.season === item.season && e.episode === item.episode) ?? episodes[0];
		const file = ep ? pickFile(ep.files, PREFERRED_QUALITY) : null;
		// Only Showbox links are fetched ahead.
		if (!file || file.source || !(ep.shareKey ?? data.shareKey)) return;
		await fetch('/api/watch/prefetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ share_key: ep.shareKey ?? data.shareKey, fids: [file.fid] })
		});
	} catch {
		warmed.delete(key);
	}
}
