/**
 * The qualities of a video a Roku can show, for its MinBandwidth (the Roku is held at one, never
 * lowering by itself the way it did: blurry now and then on replays, 2026-11-08).
 *
 * Holding it at a quality it can't show stops the video ("an unexpected problem (but not server
 * timeout or HTTP error)", a 1080p 60-frame replay, 2026-11-08), so the Roku says what it can show
 * with every request (the X-Roku-Video header, "1080,60": its screen's height, and the most frames
 * a second it plays at 1080p) and only those are given, best first. The Roku steps down the list
 * itself if one still won't start.
 */

export type RokuScreen = { height: number; fps1080: number };

/** What the asking Roku can show; a Roku app from before it said so: 1080p at 60. */
export function rokuScreen(request: Request): RokuScreen {
	const [height, fps] = (request.headers.get('x-roku-video') ?? '').split(',').map(Number);
	return { height: height > 0 ? height : 1080, fps1080: fps > 0 ? fps : 60 };
}

/** The qualities a Roku can show from a playlist's text, in kbps, best first. */
export function qualitiesIn(playlist: string, screen: RokuScreen): number[] {
	const kbps = new Set<number>();
	for (const line of playlist.match(/#EXT-X-STREAM-INF:[^\n]*/g) ?? []) {
		const codecs = /CODECS="([^"]*)"/.exec(line)?.[1] ?? '';
		// Not HEVC, AV1 or Dolby Vision, nor Dolby sound a Roku may not play.
		if (/hvc1|hev1|av01|dvh1|dvhe|ec-3|ac-3/i.test(codecs)) continue;
		const height = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0);
		if (height > screen.height + 8) continue;
		// 60 frames a second at 1080p (or H.264 level 4.2 and up) needs a Roku that says it plays it.
		const fps = Number(/FRAME-RATE=([\d.]+)/.exec(line)?.[1] ?? 0);
		const level = parseInt(/avc[13]\.[0-9a-f]{4}([0-9a-f]{2})/i.exec(codecs)?.[1] ?? '0', 16);
		if (height >= 1000 && (fps > 31 || level >= 42) && screen.fps1080 < 50) continue;
		const bandwidth = Number(/[:,]BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
		if (bandwidth > 0) kbps.add(Math.floor(bandwidth / 1000));
	}
	return [...kbps].sort((a, b) => b - a);
}

/** The same for a playlist at an address; none when it can't be read. */
export async function qualitiesAt(address: string, headers: Record<string, string>, screen: RokuScreen): Promise<number[]> {
	try {
		const r = await fetch(address, { headers, signal: AbortSignal.timeout(8000) });
		return r.ok ? qualitiesIn(await r.text(), screen) : [];
	} catch {
		return [];
	}
}
