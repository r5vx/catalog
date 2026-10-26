/**
 * Febbox's daily allowance of fast video ("high-speed flow"): 10 GB a day on a free account,
 * 100 GB on Premium. Once it's used up, every video comes in 360p only until it resets. That
 * looked like every Showbox file being 360p-only (2026-10-22: "11.5 GB / 10 GB, Flow Reset 4
 * Hours"). Read from the account's own page, febbox.com/console, which shows both figures.
 */
import { febboxAccountOf, onFebboxAccountChange, readSettings } from './settings';

export type Flow = {
	/** Gigabytes used today, and the day's allowance. */
	used: number;
	allowance: number;
	/** Used up: only 360p until it resets. */
	out: boolean;
	/** When it resets (ms since 1970), as near as Febbox says (it counts in hours). */
	resetsAt: number | null;
};

/**
 * Kept for a few minutes, for each account (by its short name): the page is 300 KB, and the
 * answer doesn't change by the second.
 */
const kept = new Map<string, { flow: Flow | null; at: number }>();
const KEEP = 5 * 60 * 1000;
onFebboxAccountChange(() => kept.clear());

/** Asked afresh next time (its links just came back held to 360p). */
export function forgetFlow(token: string) {
	kept.delete(febboxAccountOf(token));
}

const GB: Record<string, number> = { B: 1 / 1024 ** 3, KB: 1 / 1024 ** 2, MB: 1 / 1024, GB: 1, TB: 1024 };
const gigabytes = (amount: string, unit: string) => parseFloat(amount) * (GB[unit.toUpperCase()] ?? NaN);

/** The allowance of the account signed in with `token` (the main one when not given). */
export async function febboxFlow(token = readSettings().febboxToken): Promise<Flow | null> {
	if (!token) return null;
	const account = febboxAccountOf(token);
	const known = kept.get(account);
	if (known && Date.now() - known.at < KEEP) return known.flow;
	let flow: Flow | null = null;
	try {
		const resp = await fetch('https://www.febbox.com/console', {
			headers: {
				Cookie: token,
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
			},
			signal: AbortSignal.timeout(10000)
		});
		if (resp.ok) flow = readFlow(await resp.text());
	} catch {
		// Not known: the player says what it always has.
	}
	kept.set(account, { flow, at: Date.now() });
	return flow;
}

/**
 * Whether `cookies` really are someone signed in to Febbox: its account page answers them,
 * rather than sending them to the login page. Just opening the login page sets a cookie, so a
 * wrong password used to be saved as "Logged in" (a friend's, 2026-10-22).
 * Null when Febbox couldn't be asked.
 */
export async function isSignedIn(cookies: string): Promise<boolean | null> {
	try {
		const resp = await fetch('https://www.febbox.com/console', {
			headers: {
				Cookie: cookies,
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
			},
			redirect: 'manual',
			signal: AbortSignal.timeout(10000)
		});
		if (resp.status >= 300 && resp.status < 400) return /login/i.test(resp.headers.get('location') ?? '') ? false : null;
		if (!resp.ok) return null;
		const page = await resp.text();
		if (page.includes('Sign Out')) {
			const flow = readFlow(page);
			if (flow) kept.set(febboxAccountOf(cookies), { flow, at: Date.now() });
			return true;
		}
		return false;
	} catch {
		return null;
	}
}

/** `<div class="usage"><p>Usage</p><p>11.5 GB / 10 GB</p>` and `<div class="flow_reset"><p>Flow Reset</p><p>4 Hours</p>`. */
export function readFlow(html: string): Flow | null {
	const usage = html.match(/class="usage"[\s\S]{0,200}?([\d.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB|TB)/i);
	if (!usage) return null;
	const used = gigabytes(usage[1], usage[2]);
	const allowance = gigabytes(usage[3], usage[4]);
	if (!(allowance > 0) || Number.isNaN(used)) return null;
	const reset = html.match(/class="flow_reset"[\s\S]{0,200}?(\d+)\s*(hour|minute|min)/i);
	const resetsAt = reset ? Date.now() + Number(reset[1]) * (/^h/i.test(reset[2]) ? 3600_000 : 60_000) : null;
	return { used: Math.round(used * 100) / 100, allowance, out: used >= allowance, resetsAt };
}
