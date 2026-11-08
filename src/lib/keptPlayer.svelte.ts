/**
 * The player stays loaded while another page is open (owner, 2026-11-08: writing a note or
 * looking at a cast member's other films meant reloading the film and redoing auto-timing,
 * ~20 s, every time).
 *
 * The player (src/lib/WatchPlayer.svelte) is drawn by the root layout, not by /watch itself.
 * Leaving /watch hides it, paused, with everything it had loaded: the video, the subtitles and
 * their timing, the episode list. Coming back to the same thing (Back, its Continue Watching
 * card, its Watch button, the sidebar's Now playing) shows it again where it was, playing on if
 * it was playing. Something else to watch replaces it. After 30 minutes away it's let go.
 *
 * Not kept: on a TV, in the mini player, and for Live TV (a live channel is never where you
 * left it anyway).
 */
import { goto } from '$app/navigation';

export type Kept = {
	/** Changes when a new player replaces the old one. */
	id: number;
	/** The address (`?…`) the player was opened with. */
	search: string;
	/** Set by the player: whether it may be kept while another page is open. */
	keepable: boolean;
	/** Set by the player, for Now playing: the title, its picture, and the episode playing. */
	title: string;
	poster: string;
	season: number;
	episode: number;
};

/** How long a hidden player is kept before it's let go. */
const KEEP_FOR_MS = 30 * 60 * 1000;

export const keptPlayer = $state<{ current: Kept | null }>({ current: null });

let nextId = 0;
let letGoTimer: ReturnType<typeof setTimeout> | undefined;

const lower = (value: string | null) => (value ?? '').trim().toLowerCase();

/** What a /watch address plays: the same title, replay or download is the same thing. */
function mediaOf(params: URLSearchParams): string {
	if (params.get('live')) return '';
	if (params.get('replay')) return `replay:${params.get('replay')}`;
	if (params.get('download')) return `download:${params.get('download')}`;
	const title = lower(params.get('title'));
	return title ? `title:${title}|${lower(params.get('type'))}` : '';
}

/** Whether `url` (a /watch address) is what the kept player is already playing. */
function isKept(kept: Kept, url: URL): boolean {
	if (url.search === kept.search) return true;
	const wanted = mediaOf(url.searchParams);
	if (!wanted || wanted !== mediaOf(new URLSearchParams(kept.search))) return false;
	if (url.searchParams.get('mini') || url.searchParams.get('fid')) return false;
	// A particular episode asked for: only if it's the one playing.
	const season = Number(url.searchParams.get('resume_s')) || 0;
	const episode = Number(url.searchParams.get('resume_e')) || 0;
	if (season && kept.season && (season !== kept.season || (episode && episode !== kept.episode))) return false;
	return true;
}

/** Called by the root layout whenever the address changes, before the page draws. */
export function followRoute(url: URL) {
	const kept = keptPlayer.current;
	if (url.pathname === '/watch') {
		clearTimeout(letGoTimer);
		letGoTimer = undefined;
		if (kept && isKept(kept, url)) return;
		keptPlayer.current = { id: nextId++, search: url.search, keepable: false, title: '', poster: '', season: 0, episode: 0 };
		return;
	}
	if (!kept) return;
	if (!kept.keepable) {
		letGo();
		return;
	}
	letGoTimer ??= setTimeout(letGo, KEEP_FOR_MS);
}

/** Unloads the hidden player (it saved its place when it was left). */
export function letGo() {
	clearTimeout(letGoTimer);
	letGoTimer = undefined;
	keptPlayer.current = null;
}

/** Back to the hidden player. */
export function showKept() {
	const kept = keptPlayer.current;
	if (kept) goto(`/watch${kept.search}`);
}
