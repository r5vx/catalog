/**
 * How a picture sits in its frame (the app icon, the background, a profile picture): which part of
 * it is in the middle and how far it's zoomed in, as picked in src/lib/PictureAdjust.svelte (owner,
 * 2026-11-19: "how discord does it": zoom in or out, move where it's centered).
 *
 * The picture first fills the frame (cover), then `x`/`y` (0–100) say which part of it shows, as
 * CSS's background-position does, and `zoom` (1–3) enlarges it around that same point. The page
 * (fitStyle) and a drawing (drawFitted) use exactly the same rule, so what's seen while adjusting
 * is what's saved.
 */
export type Fit = { x: number; y: number; zoom: number };

export const DEFAULT_FIT: Fit = { x: 50, y: 50, zoom: 1 };
export const MAX_ZOOM = 3;

const clamp = (n: unknown, low: number, high: number, fallback: number) => {
	const v = Number(n);
	return Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : fallback;
};

/** A saved fit (an object, or its JSON), made safe; the default when there's none. */
export function fitFrom(saved: unknown): Fit {
	let value = saved;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			value = null;
		}
	}
	const v = (value ?? {}) as Partial<Fit>;
	return {
		x: Math.round(clamp(v.x, 0, 100, 50) * 10) / 10,
		y: Math.round(clamp(v.y, 0, 100, 50) * 10) / 10,
		zoom: Math.round(clamp(v.zoom, 1, MAX_ZOOM, 1) * 100) / 100
	};
}

export const isDefaultFit = (fit: Fit) => fit.x === 50 && fit.y === 50 && fit.zoom === 1;

/** CSS for an element whose background-image is the picture (the element is the frame). */
export function fitStyle(fit: Fit): string {
	return `background-size: cover; background-repeat: no-repeat; background-position: ${fit.x}% ${fit.y}%; transform: scale(${fit.zoom}); transform-origin: ${fit.x}% ${fit.y}%;`;
}

/** The same, drawn onto a canvas of `width` × `height` (the caller clips it round, if wanted). */
export function drawFitted(pen: CanvasRenderingContext2D, picture: CanvasImageSource & { width: number; height: number }, width: number, height: number, fit: Fit): void {
	const source = picture as { naturalWidth?: number; naturalHeight?: number; width: number; height: number };
	const pw = source.naturalWidth || source.width;
	const ph = source.naturalHeight || source.height;
	const cover = Math.max(width / pw, height / ph);
	const w = pw * cover;
	const h = ph * cover;
	// background-position: the picture's x% point on the frame's x% point.
	let left = (width - w) * (fit.x / 100);
	let top = (height - h) * (fit.y / 100);
	// Then scaled around that same point of the frame.
	const ox = width * (fit.x / 100);
	const oy = height * (fit.y / 100);
	left = ox + (left - ox) * fit.zoom;
	top = oy + (top - oy) * fit.zoom;
	pen.imageSmoothingQuality = 'high';
	pen.drawImage(picture, left, top, w * fit.zoom, h * fit.zoom);
}
