/**
 * Internet providers in some countries block streaming sites by their DNS: the site's name looks
 * up as "doesn't exist", or as the provider's warning page. So Catalog's server looks names up over
 * HTTPS with Cloudflare first (Google next), asked by their addresses so the provider's DNS isn't
 * involved at all, and only falls back to the computer's own DNS when neither answers. Local names
 * and addresses (the TVs, Tailscale, this computer) always go the usual way. The desktop app's own
 * windows do the same (main.cjs, configureHostResolver).
 *
 * Every lookup in the server goes through Node's dns.lookup (fetch included), which is wrapped
 * here once at start. Answers are kept for their TTL (at least a minute).
 *
 * Fast lookups (2026-11-18): on the owner's line 1.1.1.1 often gave up after 3 s and Google answered
 * 2 s after that, so every message to a friend waited 3–9 s on the name alone, again whenever its
 * five-minute TTL ran out. Now both servers are asked at once (the first answer wins), one lookup of a
 * name is shared by everything asking for it at the same moment, and an answer past its TTL is used
 * straight away while a fresh one is asked behind it (up to a day old).
 */
import dns from 'node:dns';
import net from 'node:net';

type Answer = { address: string; family: 4 | 6 };
const kept = new Map<string, { until: number; answers: Answer[] }>();
const SERVERS = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/resolve'];
/** An answer past its TTL is still used (and refreshed behind it) for this long. */
const STALE_FOR = 24 * 60 * 60 * 1000;
/** Lookups being asked right now, by name: everything asking for the same name waits on the one. */
const asking = new Map<string, Promise<Answer[] | null>>();
let installed = false;
/** How names were looked up lately (for /api/diagnostics). */
export const secureDnsStats = { overHttps: 0, usual: 0, failedOverHttps: 0 };

const local = (name: string) =>
	net.isIP(name) !== 0 || name === 'localhost' || !name.includes('.') || /\.(local|lan|home|internal|ts\.net|localhost)$/i.test(name);

/** One server's answer for `name`, or null (no address, or it didn't answer in 3 s). */
async function askServer(server: string, name: string): Promise<{ answers: Answer[]; ttl: number } | null> {
	const resp = await fetch(`${server}?name=${encodeURIComponent(name)}&type=A`, {
		headers: { Accept: 'application/dns-json' },
		signal: AbortSignal.timeout(3000)
	});
	if (!resp.ok) throw new Error(`${resp.status}`);
	const body = (await resp.json()) as { Status?: number; Answer?: { type: number; data: string; TTL: number }[] };
	const answers = (body.Answer ?? []).filter((a) => a.type === 1 && net.isIPv4(a.data)).map((a) => ({ address: a.data, family: 4 as const }));
	if (!answers.length) return null;
	return { answers, ttl: Math.max(60, Math.min(3600, ...(body.Answer ?? []).map((a) => a.TTL || 60))) };
}

/** Both servers at once; the first with addresses wins. Null when neither has any. */
function lookUpNow(name: string): Promise<Answer[] | null> {
	const already = asking.get(name);
	if (already) return already;
	const asked = Promise.any(
		SERVERS.map(async (server) => {
			const found = await askServer(server, name);
			if (!found) throw new Error('no address');
			return found;
		})
	)
		.then((found) => {
			kept.set(name, { until: Date.now() + found.ttl * 1000, answers: found.answers });
			return found.answers;
		})
		.catch(() => null)
		.finally(() => asking.delete(name));
	asking.set(name, asked);
	return asked;
}

async function overHttps(name: string): Promise<Answer[] | null> {
	const hit = kept.get(name);
	if (hit && hit.until > Date.now()) return hit.answers;
	// (Past its TTL but not by much: used now, and a fresh answer asked for the next time.)
	if (hit && Date.now() - hit.until < STALE_FOR) {
		void lookUpNow(name);
		return hit.answers;
	}
	return lookUpNow(name);
}

/** Wraps dns.lookup once, so every name the server looks up goes over HTTPS first. */
export function installSecureDns(): void {
	if (installed) return;
	installed = true;
	const usual = dns.lookup.bind(dns) as (...args: unknown[]) => void;
	const wrapped = (hostname: string, options: unknown, callback?: unknown) => {
		const cb = (typeof options === 'function' ? options : callback) as (err: Error | null, address?: unknown, family?: number) => void;
		const opts = (typeof options === 'function' ? {} : typeof options === 'number' ? { family: options } : (options ?? {})) as { all?: boolean; family?: number };
		if (local(hostname) || opts.family === 6) {
			secureDnsStats.usual++;
			return usual(hostname, options, callback);
		}
		overHttps(hostname).then(
			(answers) => {
				if (!answers) {
					secureDnsStats.failedOverHttps++;
					return usual(hostname, options, callback);
				}
				secureDnsStats.overHttps++;
				if (opts.all) cb(null, answers);
				else cb(null, answers[0].address, answers[0].family);
			},
			() => usual(hostname, options, callback)
		);
	};
	(dns as unknown as { lookup: typeof wrapped }).lookup = wrapped;
}
