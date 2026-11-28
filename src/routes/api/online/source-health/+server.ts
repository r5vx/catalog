import { json } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/ownerSession';
import { savedAddons } from '$lib/server/sources/addons';
import { SITES } from '$lib/server/reachable';
import type { RequestHandler } from './$types';

async function probe({ id, name, url }: { id: string; name: string; url: string }) {
	const start = Date.now();
	let code = 0;
	try {
		const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
		code = res.status;
		await res.body?.cancel();
	} catch { /* No HTTP response. */ }
	const status = !code ? 'Unreachable' : code < 400 ? 'Responding' : [401, 403, 429].includes(code) ? 'Access limited' : code >= 500 ? 'Server error' : 'Endpoint error';
	return { id, name, status, code, ms: Date.now() - start };
}

async function check() {
	const sites = Object.entries(SITES).map(([name, url]) => ({ id: name, name, url }));
	for (const addon of savedAddons()) {
		// Check the installed host only; private configuration can be embedded in the path.
		try {
			const url = new URL(addon.base);
			if (url.protocol === 'https:' || url.protocol === 'http:') sites.push({ id: `addon:${addon.key}`, name: `${addon.name} (add-on)`, url: url.origin });
		} catch { /* Invalid saved install. */ }
	}
	const results = [];
	for (let i = 0; i < sites.length; i += 4) results.push(...await Promise.all(sites.slice(i, i + 4).map(probe)));
	return { at: Date.now(), results };
}

let pending: ReturnType<typeof check> | undefined;
let last: Awaited<ReturnType<typeof check>> | undefined;
export const POST: RequestHandler = async ({ cookies }) => {
	requireOwner(cookies);
	if (!last || Date.now() - last.at >= 30_000) {
		pending ??= check().finally(() => { pending = undefined; });
		last = await pending;
	}
	return json(last, { headers: { 'cache-control': 'no-store' } });
};
