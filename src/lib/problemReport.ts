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
