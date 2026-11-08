/**
 * When the next episode of a show you're caught up with airs, for the library's countdown
 * ("New ep in 3 days" on its card, computer and TV). TMDB's `next_episode_to_air`, asked for
 * each caught-up show twice a day in the background (one request a show, spaced out) and kept
 * in the library; pages only read what's kept (loading a page never asks TMDB).
 */
import { caughtUpShows, getOrderCache, saveOrderCache } from './db/queries';
import { tmdbShow } from './combinedEpisodes';
import { tmdbGet } from './metadata/tmdb';
import { daysUntil } from '$lib/airs';

export type NextAir = { date: string; season: number; episode: number };

const HOUR = 60 * 60 * 1000;
const LOOK_AGAIN = 12 * HOUR;
const SPACING_MS = 1500;
const keyOf = (title: string, year: string | number | null | undefined) => `next-air|${title.trim().toLowerCase()}|${year ?? ''}`;

/** What's kept for a show: its next episode, while that's today or later. */
export function nextAirOf(title: string, year: string | number | null | undefined): NextAir | null {
	const kept = getOrderCache(keyOf(title, year))?.value as { next?: NextAir | null } | undefined;
	const next = kept?.next;
	return next && daysUntil(next.date) >= 0 ? next : null;
}

/** Caught-up items get `nextAir` (null when nothing's announced). */
export function withNextAir<T extends { title: string; year?: string | number | null; status: string }>(items: T[]): (T & { nextAir: NextAir | null })[] {
	return items.map((item) => ({ ...item, nextAir: item.status === 'caught_up' ? nextAirOf(item.title, item.year) : null }));
}

async function lookUp(title: string, year: string): Promise<void> {
	const show = (await tmdbShow(title, year).catch(() => null)) ?? (year ? await tmdbShow(title, '').catch(() => null) : null);
	if (!show) return saveOrderCache(keyOf(title, year), { next: null }, Date.now());
	type Details = { next_episode_to_air?: { air_date?: string | null; season_number?: number; episode_number?: number } | null };
	const details = await tmdbGet<Details>(`/tv/${show.id}`).catch(() => null);
	if (!details) return; // asked again next round
	const n = details.next_episode_to_air;
	const next = n?.air_date ? { date: n.air_date, season: n.season_number ?? 0, episode: n.episode_number ?? 0 } : null;
	saveOrderCache(keyOf(title, year), { next }, Date.now());
}

let running = false;

export async function refreshNextAirs(): Promise<void> {
	if (running) return;
	running = true;
	try {
		for (const { title, year } of caughtUpShows()) {
			const at = getOrderCache(keyOf(title, year))?.at ?? 0;
			if (Date.now() - at < LOOK_AGAIN) continue;
			await lookUp(title, year).catch((e) => console.error('[next-air]', title, e));
			await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
		}
	} finally {
		running = false;
	}
}

let started = false;

/** Two minutes after start, then every six hours (each show at most twice a day). */
export function scheduleNextAirs(): void {
	if (started) return;
	started = true;
	const run = () => refreshNextAirs().catch((e) => console.error('[next-air]', e));
	setTimeout(run, 2 * 60 * 1000).unref?.();
	setInterval(run, 6 * HOUR).unref?.();
}
