/**
 * Sharper posters: the library keeps TMDB's 342-pixel-wide copy, which a card stretches on a
 * high-resolution or scaled screen (a 230-point card is 460 real pixels at 200%), so the
 * pictures looked soft. TMDB has the same picture larger; this offers the browser all three,
 * and it takes the one that fits the screen (an ordinary screen still gets the small one).
 */
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/.+)$/;

export function posterSrcset(url: string | null | undefined): string | undefined {
	const m = url?.match(TMDB);
	if (!m) return undefined;
	return [342, 500, 780].map((w) => `${m[1]}w${w}${m[3]} ${w}w`).join(', ');
}

/** How wide a poster card is drawn, for picking from the above. */
export const POSTER_SIZES = '(min-width: 600px) 240px, 45vw';
