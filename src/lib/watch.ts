/** The quality the player reaches for first. */
export const PREFERRED_QUALITY = '1080p';

type Pickable = { quality: string; size: string; name?: string; source?: string; audio?: string; hevc?: boolean };

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

/** A 4K file by its quality label ("2160p"). */
export const isFourK = (file: { quality: string }) => (parseInt(file.quality) || 0) >= 2160;

/**
 * The wanted quality if it's there, otherwise the highest (then largest) file.
 * Showbox's files come first; another source's (Aniwave) only when Showbox has none, and then
 * the one in the wanted audio ("Japanese" or "English") if there is one.
 *
 * When 1080p is wanted, a 4K file comes before a plain 1080p one: the player plays the 4K
 * file's own 1080p (Febbox makes one of every file, all at the same rate), which is made from a
 * sharper source. `fourK` says which 4K files may stand in (the player leaves out ones found to
 * have no 1080p; the Roku, which picks its own quality, none).
 */
export function pickFile<T extends Pickable>(files: T[], wanted: string, audio = '', fourK: (file: T) => boolean = () => true): T | null {
	files = files.filter(playableHere);
	if (!files.length) return null;
	const showbox = files.filter((f) => !f.source);
	// No Showbox copy: the language asked for; failing that, never the English dub unless it was
	// asked for (someone watching in Japanese isn't switched to it just because it's listed first).
	if (!showbox.length) {
		return files.find((f) => audio && f.audio === audio) ?? files.find((f) => audio === 'English' || f.audio !== 'English') ?? files[0];
	}
	// Of the wanted quality: one with both languages first, then the largest. (It took the first
	// one listed: Dungeon Meshi E8 lists a 503 MB single-file copy before its 2.45 GB one. Then
	// "largest" alone put Re:Zero S2 on its 1.67 GB Japanese-only copy, past the 458 MB "dual"
	// one with the English dub that was being watched, 2026-10-24.)
	// Never a recording made in a cinema (TELESYNC, CAM…) while a proper copy is listed: every copy
	// streams at the same rate (Febbox makes its own 1080p), so the source is what you see. Brand New
	// Day's largest 1080p file was a TELESYNC, picked over the WEB ones (2026-11-06).
	const proper = showbox.filter((f) => !isCinemaRecording(f.name));
	const pool = proper.length ? proper : showbox;
	const best = (list: T[]) =>
		[...list].sort((a, b) => Number(bothLanguages(b)) - Number(bothLanguages(a)) || bytesOf(b.size) - bytesOf(a.size))[0];
	const exact = pool.filter((f) => f.quality.toLowerCase() === wanted.toLowerCase());
	if (wanted.toLowerCase() === '1080p') {
		// A 4K file's 1080p first, unless only a 1080p copy has both languages (anime's "dual";
		// "Multi" 4K films are Hindi/Tamil/Telugu dubs plus English, so it counts for nothing here).
		const standIns = pool.filter((f) => isFourK(f) && fourK(f));
		const both = [...standIns, ...exact];
		if (standIns.length) {
			const dual = both.filter((f) => /(^|[^a-z])dual([^a-z]|$)/i.test(f.name ?? ''));
			const from = dual.length ? dual : both;
			if (!from.some(isFourK)) return best(from);
			// An SDR one first: its 1080p streams at the 1080p file's rate (3.4 Mbps), an HDR or Dolby
			// Vision one's at ~2.3 (colors converted fine). Brand New Day, measured 2026-11-06.
			const fourKs = from.filter(isFourK);
			const sdr = fourKs.filter((f) => !isHdr(f.name));
			return best(sdr.length ? sdr : fourKs);
		}
	}
	if (exact.length) return best(exact);
	const top = Math.max(...pool.map((f) => parseInt(f.quality) || 0));
	return best(pool.filter((f) => (parseInt(f.quality) || 0) === top));
}

/**
 * A recording made in a cinema, or a screener sent out before release, by its file name: CAM, TS,
 * TELESYNC, HDTS, TC, SCR, R5… (and c1nem4/SUNSCREEN's pre-release rips). Video copies and subtitles
 * alike. (R5 subtitles are loosely timed, two speakers to a line: Ice Age 3's came first in the list
 * and auto-timing took 20 minutes to fit them, 2026-11-07.)
 */
export const isCinemaRecording = (name: string | undefined) =>
	/(^|[^a-z])(hd)?(cam|ts|tc|telesync|telecine|hdts|hdtc|hqcam|scr|dvdscr|screener|r5)([^a-z]|$)|c1nem4|sunscreen/i.test(name ?? '');

/** A copy whose name says it's HDR or Dolby Vision ("HDR10+", "DV", "DoVi", "HLG"). */
export const isHdr = (name: string | undefined) => /(^|[^a-z])(hdr\d*\+?|dv|dovi|dolby.?vision|hlg)([^a-z]|$)/i.test(name ?? '');

/** A copy whose name says it has more than one language ("….1080p.dual.mkv", "Dual-Audio", "Multi"). */
export const bothLanguages = (file: { name?: string }) => /(^|[^a-z])(dual|multi)([^a-z]|$)/i.test(file.name ?? '');

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
