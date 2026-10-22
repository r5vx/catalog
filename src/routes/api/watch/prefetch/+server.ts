import { json } from '@sveltejs/kit';
import { prefetchStreamUrls } from '$lib/server/showbox';
import { readSettings } from '$lib/server/settings';
import { parseAniwaveShareKey, warmAniwaveStream } from '$lib/server/sources/aniwave';
import { parseVidriftShareKey, vidriftStream } from '$lib/server/sources/vidrift';
import { movyStream, parseMovyShareKey } from '$lib/server/sources/movy';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	const { share_key, fids } = await request.json();
	if (!share_key || !Array.isArray(fids) || fids.length === 0) return json({ ok: false });

	// Aniwave's next episode: its link, fetched now so the episode starts at once.
	const aniwave = parseAniwaveShareKey(String(share_key));
	if (aniwave) {
		warmAniwaveStream(aniwave.id, aniwave.episode, aniwave.kind);
		return json({ ok: true });
	}
	// 7Movies' and Movy's next episode too (each keeps its link a while: 20 and 40 minutes).
	// Without this, Next Episode on either waited on their whole lookup, ~10–30 s.
	if (parseVidriftShareKey(String(share_key))) {
		vidriftStream(String(share_key)).catch(() => null);
		return json({ ok: true });
	}
	if (parseMovyShareKey(String(share_key))) {
		movyStream(String(share_key)).catch(() => null);
		return json({ ok: true });
	}
	if (String(share_key).includes(':')) return json({ ok: false });

	const { febboxToken } = readSettings();
	if (!febboxToken) return json({ ok: false });

	prefetchStreamUrls(share_key, fids.map(Number), febboxToken);
	return json({ ok: true });
};
