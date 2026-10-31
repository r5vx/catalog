/**
 * More than one Febbox account (2026-10-24). Mom's laptop plays Showbox on four or more TVs at
 * once, and a free account's 10 GB a day of fast video (febboxFlow.ts) runs out after about
 * seven hours of 1080p between them, then everything is 360p until it resets.
 *
 * Febbox counts a video against the account whose sign-in asked for its link. So each link is
 * asked for with one account, the one with the most fast video left today (the main one on a
 * tie). An account whose link comes back held to 360p is passed over for a while, and the next
 * one asked instead.
 *
 * The main account (Settings → Services → Watch) does everything else as before: listings,
 * subtitles, its window's cookies. The others are kept in Settings as their sign-ins (cookies),
 * like a pasted key; in the desktop app each gets its own cookie store, so they never mix.
 */
import { febboxFlow, forgetFlow, isSignedIn, type Flow } from './febboxFlow';
import { febboxAccountOf, readSettings, updateSettings } from './settings';

export type FebboxAccount = {
	/** A short name for it (never the sign-in itself). */
	key: string;
	token: string;
	/** The desktop app's cookie store for it; null for the main account (the app's own). */
	partition: string | null;
	main: boolean;
	/** Its name or email as Febbox shows it, when the sign-in window told us ('' before). */
	name: string;
};

function names(): Record<string, string> {
	try {
		const map = JSON.parse(readSettings().febboxNames ?? '{}');
		return map && typeof map === 'object' ? map : {};
	} catch {
		return {};
	}
}

/** Remembers an account's name (from Febbox's own page, in the sign-in window). */
export function nameFebboxAccount(token: string, name: string | undefined): void {
	const clean = String(name ?? '').trim().slice(0, 80);
	if (!clean) return;
	updateSettings({ febboxNames: JSON.stringify({ ...names(), [febboxAccountOf(token)]: clean }) });
}

function moreTokens(): string[] {
	try {
		const list = JSON.parse(readSettings().febboxMore ?? '[]');
		return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
	} catch {
		return [];
	}
}

/** Every account signed in: the main one first. */
export function febboxAccounts(): FebboxAccount[] {
	const { febboxToken } = readSettings();
	const named = names();
	const accounts: FebboxAccount[] = [];
	if (febboxToken) {
		const key = febboxAccountOf(febboxToken);
		accounts.push({ key, token: febboxToken, partition: null, main: true, name: named[key] ?? '' });
	}
	for (const token of moreTokens()) {
		const key = febboxAccountOf(token);
		if (!accounts.some((a) => a.key === key)) accounts.push({ key, token, partition: `persist:febbox-${key}`, main: false, name: named[key] ?? '' });
	}
	return accounts;
}

/**
 * Adds another account by its sign-in, once Febbox says it's signed in. 'same': it's an account
 * already there (the main one, say); 'refused': not signed in; null: Febbox couldn't be asked.
 * `confirmed`: the desktop app's sign-in window already saw it signed in, on Febbox's own page.
 * Asking again from here could be turned away by Febbox's Cloudflare check, which dropped every
 * account the owner signed in (2026-10-31: "No account was added", twice, with two accounts).
 */
export async function addFebboxAccount(token: string, confirmed = false): Promise<'added' | 'same' | 'refused' | null> {
	if (!confirmed) {
		const signedIn = await isSignedIn(token);
		if (signedIn === false) return 'refused';
		if (signedIn === null) return null;
	}
	const key = febboxAccountOf(token);
	const accounts = febboxAccounts();
	if (accounts.some((a) => a.key === key && a.main)) return 'same';
	// The same account signed in again: its new sign-in replaces the old.
	const others = moreTokens().filter((t) => febboxAccountOf(t) !== key);
	updateSettings({ febboxMore: JSON.stringify([...others, token]) });
	return accounts.some((a) => a.key === key) ? 'same' : 'added';
}

export function removeFebboxAccount(key: string): void {
	const left = moreTokens().filter((t) => febboxAccountOf(t) !== key);
	updateSettings({ febboxMore: left.length ? JSON.stringify(left) : undefined });
}

/** Accounts whose links came back held to 360p: passed over until then (ms). */
const heldBack = new Map<string, number>();
const HELD_BACK_MS = 10 * 60 * 1000;

/** `account`'s link came back held to 360p: the others first for a while. */
export function noteHeldBack(account: FebboxAccount) {
	heldBack.set(account.key, Date.now() + HELD_BACK_MS);
	forgetFlow(account.token);
}

/**
 * The accounts in the order to ask with: the most fast video left today first (the main one on
 * a tie), any used up or held back last. With one account, just that one (nothing is asked).
 */
export async function accountsToUse(): Promise<FebboxAccount[]> {
	const accounts = febboxAccounts();
	if (accounts.length < 2) return accounts;
	const flows = await Promise.all(accounts.map((a) => febboxFlow(a.token).catch(() => null)));
	const now = Date.now();
	return accounts
		.map((account, i) => {
			const flow = flows[i];
			const out = !!flow?.out || (heldBack.get(account.key) ?? 0) > now;
			// (Not known: as if it had a free account's half left.)
			return { account, out, left: flow ? flow.allowance - flow.used : 5 };
		})
		.sort((a, b) => Number(a.out) - Number(b.out) || b.left - a.left || Number(b.account.main) - Number(a.account.main))
		.map((entry) => entry.account);
}

/**
 * The fast video left across every account, for the player: used up only when every account
 * is (resetting when the first of them does). `account` names this set of accounts, as the
 * player keeps "used up" per sign-in. Null when not known.
 */
export async function febboxFlowAll(): Promise<(Flow & { account: string }) | null> {
	const accounts = febboxAccounts();
	if (!accounts.length) return null;
	const flows = (await Promise.all(accounts.map((a) => febboxFlow(a.token).catch(() => null)))).filter((f): f is Flow => !!f);
	if (!flows.length) return null;
	const out = flows.length === accounts.length && flows.every((f) => f.out);
	const resets = flows.map((f) => f.resetsAt).filter((at): at is number => at !== null);
	return {
		used: Math.round(flows.reduce((sum, f) => sum + f.used, 0) * 100) / 100,
		allowance: flows.reduce((sum, f) => sum + f.allowance, 0),
		out,
		resetsAt: resets.length ? Math.min(...resets) : null,
		account: febboxAccountsName()
	};
}

/**
 * A short name for the accounts signed in, together: the main one's alone when there's only
 * that (what the player has kept from before), all of theirs otherwise.
 */
export function febboxAccountsName(): string {
	return febboxAccounts()
		.map((a) => a.key)
		.join('+');
}
