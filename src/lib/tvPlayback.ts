/**
 * The facts a "Stuck loading" report carries about how a TV plays (WatchPlayer `reportStuck`):
 * owner, 2026-11-23, a family Fire TV "plays 1 second and stops and infinitely buffers", and
 * nothing had ever been reported. Empty-ish away from a TV.
 */
import { frameRateLog, tvBridge } from './tvFrameRate';

export function tvPlaybackFacts(): Record<string, unknown> {
	if (typeof window === 'undefined') return {};
	const tv = tvBridge() as (ReturnType<typeof tvBridge> & { appVersion?: () => number }) | undefined;
	let frameRateMatching: boolean | null = null;
	let tvApp: number | null = null;
	try {
		frameRateMatching = tv?.frameRateMatching ? tv.frameRateMatching() : null;
		tvApp = tv?.appVersion ? tv.appVersion() : null;
	} catch {}
	return {
		frameRateMatching,
		frameRate: frameRateLog(),
		tvApp,
		browser: /Chrome\/[\d.]+/.exec(navigator.userAgent)?.[0] ?? navigator.userAgent.slice(0, 80)
	};
}
