/**
 * Problems sent to the owner by themselves, from any screen (this computer, a phone, the Fire TV
 * app): a video that wouldn't play, or an error on a page. They go to the computer Catalog runs
 * on (api/online/report), which adds which screen and profile it was, and sends them on only when
 * that Catalog is online with reports on (Settings → Online). Read in Settings → Online on the
 * owner's computer.
 */

/** Each problem is sent once per visit, and at most this many altogether (one that repeats stays quiet). */
const MOST_PER_VISIT = 20;
const sent = new Set<string>();

export function sendProblemReport(title: string, details: Record<string, unknown>): void {
	if (typeof window === 'undefined') return;
	const key = `${title}|${JSON.stringify(details).slice(0, 300)}`;
	if (sent.has(key) || sent.size >= MOST_PER_VISIT) return;
	sent.add(key);
	fetch('/api/online/report', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'error', title, details: { ...details, page: location.pathname } }),
		keepalive: true
	}).catch(() => {});
}

/**
 * A TV page that took a while to come up after a press (owner, 2026-11-23: "a loading thing every
 * time he clicks on a page"): sent as a report with how long it took and how much of that the
 * computer spent on it (its Server-Timing), so a slow computer can be told from a slow Wi-Fi.
 * Pages on the computer itself answer in milliseconds; this is for TVs. Returns the two hooks
 * the layout calls before and after each move.
 */
const SLOW_PAGE = 2500;
export function watchSlowPages(): { before: () => void; after: (path: string) => void } {
	let started = 0;
	return {
		before: () => (started = performance.now()),
		after: (path) => {
			if (!started) return;
			const took = Math.round(performance.now() - started);
			started = 0;
			if (took < SLOW_PAGE) return;
			// The computer's own time over this page's data, when it said.
			let computerMs: number | null = null;
			try {
				const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
				const data = entries.filter((one) => one.name.includes('__data.json')).pop();
				const own = data?.serverTiming?.find((one) => one.name === 'app');
				if (own) computerMs = Math.round(own.duration);
				performance.clearResourceTimings();
			} catch {}
			sendProblemReport('Slow pages on the TV', { error: 'A page took a while to come up', path, tookMs: took, computerMs });
		}
	};
}

/**
 * Errors nobody caught on a page, sent as reports. Not sent: the connection dropping (the
 * computer asleep or the Wi-Fi gone), which isn't a fault in Catalog and couldn't be sent anyway.
 */
const NOT_FAULTS = /Failed to fetch|NetworkError|Load failed|network error|AbortError|aborted|ResizeObserver loop|^Script error/i;

export function reportPageErrors(): () => void {
	const send = (error: unknown) => {
		const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
		if (NOT_FAULTS.test(`${err.name}: ${err.message}`)) return;
		sendProblemReport(`Page error: ${err.message.slice(0, 100)}`, { error: err.message.slice(0, 500), stack: String(err.stack ?? '').slice(0, 1500) });
	};
	const onError = (event: ErrorEvent) => send(event.error ?? event.message);
	const onRejection = (event: PromiseRejectionEvent) => send(event.reason);
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
	};
}
