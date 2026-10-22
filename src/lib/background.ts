/**
 * The picture behind the pages (Settings → Personalization → Background). Kept on this computer
 * only: it's in the settings, which are never exported or shared.
 */
export type Background = {
	/** Its "/media/…" address (uploaded like a note's pictures). */
	image: string;
	/** How far it fades toward the theme's own background color, 0–90 (%). */
	dim: number;
	/** How blurred, 0–20 (px). */
	blur: number;
};

export const DEFAULT_DIM = 55;
export const MAX_DIM = 90;
export const MAX_BLUR = 20;

/** Only pictures Catalog stored itself. */
export const isOwnPicture = (url: string) => /^\/media\/[\w.-]+$/.test(url);

/** A whole number from 0 to `max`; `fallback` when it isn't a number. */
export const clampTo = (value: unknown, max: number, fallback: number) => {
	const n = Math.round(Number(value));
	return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
};

/** The saved settings as a background, or null when there's none. */
export function backgroundFrom(settings: { backgroundImage?: string; backgroundDim?: string; backgroundBlur?: string }): Background | null {
	const image = settings.backgroundImage ?? '';
	if (!isOwnPicture(image)) return null;
	return {
		image,
		dim: clampTo(settings.backgroundDim ?? DEFAULT_DIM, MAX_DIM, DEFAULT_DIM),
		blur: clampTo(settings.backgroundBlur ?? 0, MAX_BLUR, 0)
	};
}
