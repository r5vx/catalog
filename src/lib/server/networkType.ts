import { execFile } from 'node:child_process';

/*
 * Windows sets a network it thinks is new to Public (after a router restart or update, a new
 * router, another mesh point), and Catalog is only let through Windows' firewall on Private
 * networks. Then the computer itself works but the TVs can't reach it, and can't find it either
 * (mom's laptop, 2026-10-30). Settings → TV on the computer itself says so, with a button that
 * sets the network back to Private (one Windows prompt). Only there: the owner didn't want it on
 * every page when nobody is connecting a TV. Windows desktop app only.
 */

export type PublicNetwork = { name: string; index: number };

const CHECK_MS = 60_000;
/** Not the home network: Tailscale's, and virtual machines'. */
const NOT_HOME = /tailscale|vethernet|loopback|wsl|virtualbox|vmware|hyper-v|zerotier|vpn/i;

let checkedAt = 0;
let found: PublicNetwork | null = null;
let checking: Promise<void> | null = null;

const wanted = () => process.platform === 'win32' && process.env.CATALOG_DESKTOP === '1';

function powershell(command: string): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => {
		execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120_000 }, (error, out) =>
			resolve({ ok: !error, out: String(out ?? '') })
		);
	});
}

async function check() {
	const answer = await powershell('Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,InterfaceIndex,NetworkCategory | ConvertTo-Json -Compress');
	checkedAt = Date.now();
	if (!answer.ok) return;
	let profiles: { Name: string; InterfaceAlias: string; InterfaceIndex: number; NetworkCategory: number }[] = [];
	try {
		const parsed = JSON.parse(answer.out || '[]');
		profiles = Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		return;
	}
	// NetworkCategory: 0 Public, 1 Private, 2 Domain.
	const one = profiles.find((p) => p.NetworkCategory === 0 && !NOT_HOME.test(`${p.InterfaceAlias} ${p.Name}`));
	found = one ? { name: one.Name, index: one.InterfaceIndex } : null;
}

/** The home network when Windows has it set to Public (asked again when the last answer is over a minute old). */
export async function publicNetwork(): Promise<PublicNetwork | null> {
	if (!wanted()) return null;
	if (!checking && Date.now() - checkedAt > CHECK_MS) checking = check().finally(() => (checking = null));
	if (checking) await checking;
	return found;
}

/** Sets it to Private. Windows asks first; false when that was declined or it didn't take. */
export async function makePrivate(): Promise<boolean> {
	if (!wanted() || !found) return false;
	const index = Number(found.index);
	if (!Number.isInteger(index)) return false;
	const set = `Set-NetConnectionProfile -InterfaceIndex ${index} -NetworkCategory Private`;
	await powershell(`Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command','${set}'`);
	await check();
	return !found;
}
