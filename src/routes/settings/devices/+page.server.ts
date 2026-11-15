import { networkInterfaces, hostname } from 'node:os';
import { fail } from '@sveltejs/kit';
import { readSettings, setPin, pinIsSet } from '$lib/server/settings';
import { publicNetwork } from '$lib/server/networkType';
import { onThisComputer } from '$lib/server/profile';
import { phoneAddress } from '$lib/server/tailscale';
import type { PageServerLoad, Actions } from './$types';

/**
 * Settings → TV and phones: Catalog on a TV (WatchOnTv.svelte), on a phone (Phones.svelte), and the
 * PIN other devices are asked for (Privacy.svelte).
 *
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
	const onComputer = onThisComputer(request.headers, client);
	return {
		port,
		name: hostname(),
		addresses,
		tvLayout: readSettings().tvLayout !== 'full',
		// Not waited for: asking Windows takes ~0.75 s, and the page shows straight away.
		publicNetwork: onComputer ? publicNetwork() : Promise.resolve(null),

		// Phones: the phone app's address, and whether this page is open on the computer Catalog runs on.
		phone: await phoneAddress(),
		onComputer,

		// Privacy: whether a PIN is asked for.
		pinSet: pinIsSet()
	};
};

/** Privacy's forms: the PIN. */
export const actions: Actions = {
	savePin: async ({ request }) => {
		const pin = String((await request.formData()).get('pin') ?? '').trim();

		if (pin.length < 4) return fail(400, { pinError: 'Use at least 4 characters.' });

		setPin(pin);
		return { pinOk: 'PIN set. You will be asked for it on other devices.' };
	},

	removePin: async ({ cookies }) => {
		setPin(null);
		// Attributes must match the ones the cookie was set with, or it won't clear.
		cookies.delete('catalog_auth', { path: '/', secure: false });
		return { pinOk: 'PIN removed.' };
	}
};
