/**
 * How long until an episode airs, in words: "today", "tomorrow", "in 3 days", or the date when
 * it's two weeks or more away. Used by the episode lists (computer and TV) and by the library's
 * Caught up cards ("New ep in 3 days"). Air dates are TMDB's (the US date, "2026-11-07").
 */

/** Whole days from today to the air date, by the calendar (not hours). */
export function daysUntil(airDate: string, now = new Date()): number {
	const [y, m, d] = airDate.split('-').map(Number);
	const air = new Date(y, (m || 1) - 1, d || 1);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((air.getTime() - today.getTime()) / 86_400_000);
}

const shortDate = (airDate: string) =>
	new Date(`${airDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "today", "tomorrow", "in 3 days", or "Nov 21". */
export function whenText(airDate: string, now = new Date()): string {
	const days = daysUntil(airDate, now);
	if (days <= 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days < 14) return `in ${days} days`;
	return shortDate(airDate);
}

/** An episode not out yet: "Airs Fri, Nov 7 · in 3 days", "Airs today", "Airs Dec 25". */
export function airsText(airDate: string, now = new Date()): string {
	const days = daysUntil(airDate, now);
	if (days <= 1) return `Airs ${whenText(airDate, now)}`;
	const day = new Date(`${airDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	return days < 14 ? `Airs ${day} · ${whenText(airDate, now)}` : `Airs ${shortDate(airDate)}`;
}
