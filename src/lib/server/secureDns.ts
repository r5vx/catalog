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
 */
import dns from 'node:dns';
import net from 'node:net';

type Answer = { address: string; family: 4 | 6 };
const kept = new Map<string, { until: number; answers: Answer[] }>();
const SERVERS = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/resolve'];
let installed = false;
/** How names were looked up lately (for /api/diagnostics). */
export const secureDnsStats = { overHttps: 0, usual: 0, failedOverHttps: 0 };

const local = (name: string) =>
	net.isIP(name) !== 0 || name === 'localhost' || !name.includes('.') || /\.(local|lan|home|internal|ts\.net|localhost)$/i.test(name);

async function overHttps(name: string): Promise<Answer[] | null> {
	const hit = kept.get(name);
	if (hit && hit.until > Date.now()) return hit.answers;
	for (const server of SERVERS) {
		try {
			const resp = await fetch(`${server}?name=${encodeURIComponent(name)}&type=A`, {
				headers: { Accept: 'application/dns-json' },
				signal: AbortSignal.timeout(3000)
			});
			if (!resp.ok) continue;
			const body = (await resp.json()) as { Status?: number; Answer?: { type: number; data: string; TTL: number }[] };
			const answers = (body.Answer ?? []).filter((a) => a.type === 1 && net.isIPv4(a.data)).map((a) => ({ address: a.data, family: 4 as const }));
			if (!answers.length) return null;
			const ttl = Math.max(60, Math.min(3600, ...(body.Answer ?? []).map((a) => a.TTL || 60)));
			kept.set(name, { until: Date.now() + ttl * 1000, answers });
			return answers;
		} catch {
			// next server
		}
	}
	return null;
}

/** Wraps dns.lookup once, so every name the server looks up goes over HTTPS first. */
export function installSecureDns(): void {
	if (installed) return;
	installed = true;
	const usual = dns.lookup.bind(dns) as (...args: unknown[]) => void;
	const wrapped = (hostname: string, options: unknown, callback?: unknown) => {
		const cb = (typeof options === 'function' ? options : callback) as (err: Error | null, address?: unknown, family?: number) => void;
		const opts = (typeof options === 'function' ? {} : typeof options === 'number' ? { family: options } : (options ?? {})) as { all?: boolean; family?: number };
		if (local(hostname) || opts.family === 6) return usual(hostname, options, callback);
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
