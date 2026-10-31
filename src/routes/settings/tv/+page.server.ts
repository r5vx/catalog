import { networkInterfaces, hostname } from 'node:os';
import { readSettings } from '$lib/server/settings';
import { publicNetwork } from '$lib/server/networkType';
import { onThisComputer } from '$lib/server/profile';
import type { PageServerLoad } from './$types';

/**
 * This computer's addresses on the home network, for setting up Catalog on a TV.
 * Tailscale's 100.x address is listed last: it only helps a TV that has Tailscale too. On the
 * computer itself, also whether Windows has set its network to Public (TVs can't connect then).
 */
export const load: PageServerLoad = async ({ request, getClientAddress }) => {
	let client = '';
	try {
		client = getClientAddress();
	} catch {}
	const port = Number(process.env.PORT) || 4173;
	const addresses: { address: string; tailscale: boolean }[] = [];
	for (const [name, list] of Object.entries(networkInterfaces())) {
		// Virtual adapters (WSL, Hyper-V, VirtualBox…) aren't on the Wi-Fi the TV is on.
		if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|vbox|docker|Loopback/i.test(name)) continue;
		for (const net of list ?? []) {
			if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) continue;
			addresses.push({ address: net.address, tailscale: net.address.startsWith('100.') });
		}
	}
	addresses.sort((a, b) => Number(a.tailscale) - Number(b.tailscale));
	return {
		port,
		name: hostname(),
		addresses,
		tvLayout: readSettings().tvLayout !== 'full',
		// Not waited for: asking Windows takes ~0.75 s, and the page shows straight away.
		publicNetwork: onThisComputer(request.headers, client) ? publicNetwork() : Promise.resolve(null)
	};
};
