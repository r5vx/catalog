/** How the app's Febbox sign-in window went, as the app tells the server (api/watch/save-token). */
export type SignInOutcome = { at: number; result: string; name: string };

/**
 * Waits for the app's word on a Febbox sign-in window opened at `asked` (Date.now()), and gives
 * its outcome once the window has really closed: 'saved'/'cookies' for the main account,
 * 'added'/'same'/'refused'/'unreachable' for another, 'closed' when nobody signed in.
 *
 * Not the page's own view of the window (`popup.closed`): Google's sign-in pages cut the window
 * off from the page that opened it (their Cross-Origin-Opener-Policy), so it looked closed as soon
 * as Google's page loaded, and "No account was added" showed while someone was still signing in
 * (2026-11-08). Null when the app never said anything (an older app: the page's view, as before).
 * No `popup` for another account's window, which the app opens itself (its own cookie store).
 */
export async function signInOutcome(kind: 'main' | 'more', asked: number, popup: Window | null): Promise<SignInOutcome | null> {
	const started = Date.now();
	let heard = false;
	while (Date.now() - started < 15 * 60_000) {
		await new Promise((r) => setTimeout(r, 1000));
		const last: SignInOutcome | null = await fetch(`/api/watch/save-token?kind=${kind}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (last && last.at >= asked) {
			heard = true;
			if (last.result !== 'open') return last;
		}
		if (!heard && (popup ? popup.closed && Date.now() - started > 30_000 : Date.now() - started > 15_000)) return null;
	}
	return null;
}
