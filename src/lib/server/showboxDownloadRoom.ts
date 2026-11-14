/**
 * Downloading Showbox's own copies, only as far as it can't spoil the day's watching.
 *
 * Febbox gives each account so much fast video a day (10 GB free: febboxFlow.ts); past that,
 * every Showbox video is 360p until it resets. Downloads of Showbox's copies were never allowed
 * for that reason (owner, 2026-10-26). Since 2026-11-13 they are, while enough is left: a
 * download may use what's left of today's allowance except a share kept back for watching.
 */
import { febboxFlowAll } from './febboxAccounts';

const GB = 1024 ** 3;
/** Kept back for watching: 40% of the day's allowance, and never under 3 GB. */
const KEPT_BACK_SHARE = 0.4;
const KEPT_BACK_AT_LEAST = 3 * GB;
/** A download just started isn't in Febbox's count yet: its size is held against the room this long. */
const COUNTED_AFTER = 3 * 60 * 60 * 1000;

const started: { bytes: number; at: number }[] = [];

/**
 * How many bytes of Showbox video may be downloaded right now, and why not more. Zero when the
 * allowance isn't known (Febbox didn't say): never guessed at.
 */
export async function showboxDownloadRoom(): Promise<{ bytes: number; known: boolean; allowance: number; used: number; keptBack: number }> {
	const flow = await febboxFlowAll().catch(() => null);
	if (!flow) return { bytes: 0, known: false, allowance: 0, used: 0, keptBack: 0 };
	const allowance = flow.allowance * GB;
	const used = flow.used * GB;
	const keptBack = Math.max(KEPT_BACK_AT_LEAST, allowance * KEPT_BACK_SHARE);
	const now = Date.now();
	while (started.length && now - started[0].at > COUNTED_AFTER) started.shift();
	const waiting = started.reduce((sum, s) => sum + s.bytes, 0);
	const bytes = flow.out ? 0 : Math.max(0, Math.floor(allowance - used - keptBack - waiting));
	return { bytes, known: true, allowance, used, keptBack };
}

/** A Showbox download of this size has started. */
export function noteShowboxDownload(bytes: number): void {
	started.push({ bytes, at: Date.now() });
}
