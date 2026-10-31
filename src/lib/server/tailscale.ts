/**
 * The phone app's secure address (Settings → Phones): https://<this computer>.<network>.ts.net,
 * from Tailscale's own `tailscale serve`, which hands the phone's requests to Catalog on this
 * computer. A phone only keeps files and opens a page with no connection on a secure (https)
 * address; the plain http://100.x… one stays for everything else.
 *
 * Only Tailscale's command-line tool is used (it comes with Tailscale). The first time, Tailscale
 * says HTTPS isn't on for the network yet and gives a link to turn it on (whoever owns the
 * Tailscale account clicks it once); that link is passed on.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const PLACES = [
	'tailscale',
	'C:\\Program Files\\Tailscale\\tailscale.exe',
	'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
	'/Applications/Tailscale.app/Contents/MacOS/Tailscale',
	'/usr/local/bin/tailscale',
	'/usr/bin/tailscale'
];

type Ran = { ok: boolean; out: string };

function run(file: string, args: string[], timeout: number): Promise<Ran> {
	return new Promise((resolve) => {
		execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
			resolve({ ok: !error, out: `${stdout ?? ''}\n${stderr ?? ''}` });
		});
	});
}

let tool: string | null | undefined;

/** Tailscale's command-line tool, or null when Tailscale isn't installed. */
async function tailscaleTool(): Promise<string | null> {
	if (tool !== undefined) return tool;
	for (const place of PLACES) {
		if (place !== 'tailscale' && !existsSync(place)) continue;
		const answer = await run(place, ['version'], 5000);
		if (answer.ok) return (tool = place);
	}
	// (Not kept: Tailscale may be installed while Catalog runs.)
	return null;
}

export type PhoneAddress = {
	/** Tailscale is installed and signed in. */
	tailscale: boolean;
	/** https://name.network.ts.net (without the last slash), when Tailscale gives one. */
	address: string | null;
	/** The plain one, http://100.x.x.x:port. */
	plain: string | null;
	/** `tailscale serve` is handing the secure address to Catalog. */
	on: boolean;
};

const port = () => Number(process.env.PORT) || 4173;

export async function phoneAddress(): Promise<PhoneAddress> {
	const cli = await tailscaleTool();
	if (!cli) return { tailscale: false, address: null, plain: null, on: false };
	const status = await run(cli, ['status', '--json'], 8000);
	let name = '';
	let ip = '';
	try {
		const parsed = JSON.parse(status.out.slice(status.out.indexOf('{'), status.out.lastIndexOf('}') + 1));
		name = String(parsed.Self?.DNSName ?? '').replace(/\.$/, '');
		ip = (parsed.Self?.TailscaleIPs ?? []).find((a: string) => a.startsWith('100.')) ?? '';
	} catch {}
	if (!name && !ip) return { tailscale: false, address: null, plain: null, on: false };
	const serving = await run(cli, ['serve', 'status', '--json'], 8000);
	// Serving this computer's Catalog on its secure address.
	const on = serving.ok && new RegExp(`127\\.0\\.0\\.1:${port()}|localhost:${port()}`).test(serving.out);
	return { tailscale: true, address: name ? `https://${name}` : null, plain: ip ? `http://${ip}:${port()}` : null, on };
}

/**
 * Turns the secure address on. `enable`: Tailscale's link for turning HTTPS on for the network,
 * when that's needed first.
 */
export async function turnOnPhoneAddress(): Promise<{ ok: boolean; enable?: string; message?: string }> {
	const cli = await tailscaleTool();
	if (!cli) return { ok: false, message: 'Tailscale isn\'t installed on this computer.' };
	// It waits for HTTPS to be turned on when it isn't yet: given 20 s, its link is read meanwhile.
	const answer = await run(cli, ['serve', '--bg', `http://127.0.0.1:${port()}`], 20_000);
	const link = answer.out.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
	if (link) return { ok: false, enable: link };
	if ((await phoneAddress()).on) return { ok: true };
	return { ok: false, message: answer.out.trim().split('\n').slice(-3).join(' ') || "Tailscale didn't turn it on." };
}
