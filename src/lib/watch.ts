/** The quality the player reaches for first. */
export const PREFERRED_QUALITY = '1080p';

type Pickable = { quality: string; size: string; source?: string; audio?: string; hevc?: boolean };

let hevcAnswer: boolean | null = null;

/** Whether this TV or computer can play HEVC video (7Movies' Orion copies). */
export function canPlayHevc(): boolean {
	if (hevcAnswer === null) {
		try {
			hevcAnswer =
				typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"');
		} catch {
			hevcAnswer = false;
		}
	}
	return hevcAnswer;
}

/** A copy this device can play: anything but HEVC where HEVC can't be played. */
export const playableHere = (file: { hevc?: boolean }) => !file.hevc || canPlayHevc();

/**
 * The wanted quality if it's there, otherwise the highest (then largest) file.
 * Showbox's files come first; another source's (Aniwave) only when Showbox has none, and then
 * the one in the wanted audio ("Japanese" or "English") if there is one.
 */
export function pickFile<T extends Pickable>(files: T[], wanted: string, audio = ''): T | null {
	files = files.filter(playableHere);
	if (!files.length) return null;
	const showbox = files.filter((f) => !f.source);
	// No Showbox copy: the language asked for; failing that, never the English dub unless it was
	// asked for (someone watching in Japanese isn't switched to it just because it's listed first).
	if (!showbox.length) {
		return files.find((f) => audio && f.audio === audio) ?? files.find((f) => audio === 'English' || f.audio !== 'English') ?? files[0];
	}
	// The largest of the wanted quality. (It took the first one listed: Dungeon Meshi E8 lists a
	// 503 MB single-file copy before its 2.45 GB one, which has the usual playlist and both
	// languages. And sizes were compared without their units, so "503.66 MB" beat "2.45 GB".)
	const largest = (list: T[]) => [...list].sort((a, b) => bytesOf(b.size) - bytesOf(a.size))[0];
	const exact = showbox.filter((f) => f.quality === wanted);
	if (exact.length) return largest(exact);
	const top = Math.max(...showbox.map((f) => parseInt(f.quality) || 0));
	return largest(showbox.filter((f) => (parseInt(f.quality) || 0) === top));
}

/** "503.66 MB", "2.45 GB" → bytes (0 when it can't be read). */
export function bytesOf(size: string): number {
	const match = /([\d.]+)\s*([KMGT]?)B/i.exec(size ?? '');
	if (!match) return 0;
	return parseFloat(match[1]) * 1024 ** ' KMGT'.indexOf(match[2].toUpperCase() || ' ');
}

/** When each title was last warmed up: again after 10 minutes, as links last 15 (a TV stays open for days). */
const warmed = new Map<string, number>();
const WARM_AGAIN_MS = 10 * 60 * 1000;

/**
 * Finds a title and starts its video link in the background, so opening it is near-instant:
 * asked exactly as the player will ask (same title, type and year, so it fills the same
 * server caches), with `warm=1` so the computer also starts the link for the episode the player
 * will start (the one given, else where it was left off). Films get theirs as part of the lookup.
 */
export async function warmUpTitle(item: { title: string; type: string; year?: number | string | null; season?: number; episode?: number }) {
	const key = `${item.title}:${item.type}:${item.year ?? ''}:${item.season ?? 0}:${item.episode ?? 0}`;
	if (Date.now() - (warmed.get(key) ?? 0) < WARM_AGAIN_MS) return;
	warmed.set(key, Date.now());
	try {
		const params = new URLSearchParams({ title: item.title, nostream: '1', warm: '1' });
		if (item.type) params.set('type', item.type);
		if (item.year) params.set('year', String(item.year));
		if (item.type === 'tv' && item.season && item.episode) {
			params.set('resume_s', String(item.season));
			params.set('resume_e', String(item.episode));
		}
		const resp = await fetch(`/api/watch/resolve?${params}`);
		if (!resp.ok) throw new Error();
	} catch {
		warmed.delete(key);
	}
}

/**
 * Warms a title up once the pointer (or the TV's highlight) has rested on its Watch button for
 * a moment, so sweeping past buttons doesn't look up each one. `stop` when it moves off.
 */
export function warmWhenResting(wait: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		start(item: Parameters<typeof warmUpTitle>[0]) {
			clearTimeout(timer);
			timer = setTimeout(() => warmUpTitle(item), wait);
		},
		stop() {
			clearTimeout(timer);
			timer = undefined;
		}
	};
}
