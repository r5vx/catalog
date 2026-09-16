/**
 * Where a page should send you back to.
 *
 * Carried as a `?back=` path rather than an id, because the chain is now
 * film -> actor -> film -> actor and each hop is a different kind of page.
 * Only our own paths are accepted: anything else, and a crafted link could
 * bounce someone off the app.
 */
export function safeBack(raw: string | null): string | null {
	if (!raw) return null;
	if (!raw.startsWith('/') || raw.startsWith('//')) return null;
	return raw;
}

export const withBack = (href: string, back: string) =>
	`${href}?back=${encodeURIComponent(back)}`;
