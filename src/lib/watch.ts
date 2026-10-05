/** The quality the player reaches for first. */
export const PREFERRED_QUALITY = '1080p';

/** The wanted quality if it's there, otherwise the highest (then largest) file. */
export function pickFile<T extends { quality: string; size: string }>(files: T[], wanted: string): T | null {
	if (!files.length) return null;
	const exact = files.find((f) => f.quality === wanted);
	if (exact) return exact;
	const sorted = [...files].sort((a, b) => {
		const aq = parseInt(a.quality) || 0;
		const bq = parseInt(b.quality) || 0;
		if (bq !== aq) return bq - aq;
		const aSize = parseFloat(a.size) || 0;
		const bSize = parseFloat(b.size) || 0;
		return bSize - aSize;
	});
	return sorted[0];
}

type EpisodeFiles = { season: number; episode: number; files: { fid: number; quality: string; size: string }[] };

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
		if (data.error || !data.shareKey || !data.episodes) return;
		const episodes = data.episodes.episodes as EpisodeFiles[];
		const ep = episodes.find((e) => e.season === item.season && e.episode === item.episode) ?? episodes[0];
		const file = ep ? pickFile(ep.files, PREFERRED_QUALITY) : null;
		if (!file) return;
		await fetch('/api/watch/prefetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ share_key: data.shareKey, fids: [file.fid] })
		});
	} catch {
		warmed.delete(key);
	}
}
