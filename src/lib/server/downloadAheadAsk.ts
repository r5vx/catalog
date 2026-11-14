/**
 * Getting a 7Movies or Movy copy onto this computer before it's played (episodeDownloads.ts says
 * why: their servers are slow over pieces nobody has asked for yet, and the newest episode of a
 * show is exactly that).
 *
 * Asked three ways: the player, for the episode after the one playing; the new-episode check, the
 * moment a new episode can be played (newEpisodes.ts), kept until it's watched; and a title's
 * page or a TV's highlight resting on a show (the resolve's warm-up).
 *
 * Its playlists are asked for the way the player asks (this server's own /api/watch/stream and
 * relay), so the pieces are noted under the same copy name the player will use.
 */
import { downloadAhead, downloadKindOf, stopAhead } from './episodeDownloads';
import { ownFetch } from './ownFetch';

/** This server's own address for a playlist, as a path ownFetch can ask for. */
const pathOf = (address: string) => {
	const url = new URL(address, 'http://catalog');
	return url.pathname + url.search;
};

const copyOf = (address: string) => new URL(address, 'http://catalog').searchParams.get('copy');

async function text(path: string): Promise<string> {
	const answer = await ownFetch(path, { signal: AbortSignal.timeout(120_000) });
	return answer.ok ? answer.text() : '';
}

/**
 * Starts downloading a copy (`shareKey` + `fid`, as the player names it): the quality the player
 * picks (the highest H.264 one; the highest of any when it has none) and its sound track when
 * that's separate. `keepUntil`: when it may be deleted if nobody has played it (else the usual six
 * hours). Answers with the copies' names being downloaded, none if it couldn't be started.
 */
export async function downloadCopyAhead(shareKey: string, fid: number, keepUntil = 0, most = 0): Promise<string[]> {
	if (!shareKey || !fid || !downloadKindOf(shareKey)) return [];
	const started: string[] = [];
	try {
		const stream = (await (await ownFetch(`/api/watch/stream?share_key=${encodeURIComponent(shareKey)}&fid=${fid}`, { signal: AbortSignal.timeout(120_000) })).json()) as { url?: string };
		if (!stream.url) return [];
		let playlist = pathOf(stream.url);
		let list = await text(playlist);
		// A choice of qualities: the one the player picks.
		if (list && !list.includes('#EXTINF')) {
			const lines = list.split('\n');
			type Choice = { address: string; bandwidth: number; avc: boolean };
			let best: Choice | null = null;
			for (let i = 0; i < lines.length; i++) {
				const info = lines[i];
				if (!info.startsWith('#EXT-X-STREAM-INF')) continue;
				const codecs = /CODECS="([^"]*)"/.exec(info)?.[1] ?? '';
				const avc = !codecs || /avc1/.test(codecs);
				const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(info)?.[1] ?? 0);
				const address = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'))?.trim();
				if (!address) continue;
				if (!best || (avc && !best.avc) || (avc === best.avc && bandwidth > best.bandwidth)) best = { address, bandwidth, avc };
			}
			if (!best) return [];
			// Its sound, where that's a track of its own: the one that plays first.
			const sounds = lines.filter((l) => l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l) && /URI="/.test(l));
			const sound = sounds.find((l) => /DEFAULT=YES/.test(l)) ?? sounds[0];
			const soundAddress = sound ? /URI="([^"]*)"/.exec(sound)?.[1] : '';
			if (soundAddress) {
				const soundCopy = copyOf(soundAddress);
				const soundList = await text(pathOf(soundAddress)).catch(() => '');
				if (soundCopy && soundList.includes('#EXTINF')) {
					downloadAhead(soundCopy, keepUntil, most);
					started.push(soundCopy);
				}
			}
			playlist = pathOf(best.address);
			list = await text(playlist);
		}
		const copy = copyOf(playlist);
		if (copy && list.includes('#EXTINF')) {
			downloadAhead(copy, keepUntil, most);
			started.push(copy);
		}
	} catch {
		// Not now: it plays the usual way when it comes.
	}
	return started;
}

/*
 * A show's page opened, or a TV's highlight resting on it: its likely episode is started on, so
 * pressing Play finds the first minutes here already. One title at a time: when another is looked
 * at, the one before stops (unless it's being watched by then, or is a new episode being kept).
 */
let looked: { key: string; copies: Promise<string[]> } | null = null;
/** The first three minutes or so (pieces are about six seconds). */
const START_PIECES = 30;
/** Looked at for this long first: a highlight passing over a row of shows starts nothing. */
const RESTED_MS = 3000;

export function downloadLikelyAhead(shareKey: string, fid: number): void {
	const key = `${shareKey}:${fid}`;
	if (looked?.key === key) return;
	const before = looked;
	const rested = new Promise<void>((resolve) => setTimeout(resolve, RESTED_MS));
	const mine: { key: string; copies: Promise<string[]> } = {
		key,
		copies: rested.then((): Promise<string[]> | string[] => (looked === mine ? downloadCopyAhead(shareKey, fid, 0, START_PIECES) : []))
	};
	looked = mine;
	void before?.copies.then((copies) => copies.forEach(stopAhead)).catch(() => {});
}
