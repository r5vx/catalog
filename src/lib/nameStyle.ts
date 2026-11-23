/**
 * How a person's name looks on their profile and friend cards (owner, 2026-11-15: "pick gradients or
 * custom fonts like how discord lets you do that"). Chosen under Edit profile, kept on the meeting
 * point with the profile (cloud/src/worker.js, the `looks` table), drawn by src/lib/StyledName.svelte.
 *
 * To add a font: one more line in FONTS with a Google Fonts family. The server only checks the id's
 * shape, so older Catalogs just show an unknown font in the normal one.
 */

export type NameStyle = {
	/** An id from FONTS ('' = the app's own). */
	font: string;
	/** solid: one color; gradient: the first color into the second; glow: one color, lit up. */
	effect: 'solid' | 'gradient' | 'glow';
	/** One or two #rrggbb colors ([] = the normal text color). */
	colors: string[];
	/**
	 * Lit up, on top of one color or a gradient (owner, 2026-11-20: "combine stuff like gradient and
	 * glow"). A name saved as `effect: 'glow'` before is one color, lit up.
	 */
	glow?: boolean;
	/** A shine passing across the letters now and then. */
	shimmer?: boolean;
};

export const NO_STYLE: NameStyle = { font: '', effect: 'solid', colors: [] };

/** Fonts a name can have. `google` is the family as Google Fonts spells it, with the weight wanted. */
export const FONTS: { id: string; label: string; family: string; google: string }[] = [
	{ id: '', label: 'Normal', family: '', google: '' },
	{ id: 'fraunces', label: 'Serif', family: "'Fraunces', serif", google: 'Fraunces:wght@600' },
	{ id: 'fredoka', label: 'Rounded', family: "'Fredoka', sans-serif", google: 'Fredoka:wght@600' },
	{ id: 'bungee', label: 'Bold', family: "'Bungee', sans-serif", google: 'Bungee' },
	{ id: 'orbitron', label: 'Future', family: "'Orbitron', sans-serif", google: 'Orbitron:wght@700' },
	{ id: 'pacifico', label: 'Script', family: "'Pacifico', cursive", google: 'Pacifico' },
	{ id: 'caveat', label: 'Handwritten', family: "'Caveat', cursive", google: 'Caveat:wght@700' },
	{ id: 'marker', label: 'Marker', family: "'Permanent Marker', cursive", google: 'Permanent+Marker' },
	{ id: 'cinzel', label: 'Classic', family: "'Cinzel', serif", google: 'Cinzel:wght@700' },
	{ id: 'gothic', label: 'Gothic', family: "'UnifrakturMaguntia', serif", google: 'UnifrakturMaguntia' },
	{ id: 'pixel', label: 'Pixel', family: "'Press Start 2P', monospace", google: 'Press+Start+2P' },
	{ id: 'mono', label: 'Typewriter', family: "'Special Elite', monospace", google: 'Special+Elite' }
];

/** Ready-made color pairs for a gradient (any two colors can be picked as well). */
export const GRADIENTS: [string, string][] = [
	['#ff7eb3', '#7afcff'],
	['#f6d365', '#fda085'],
	['#a18cd1', '#fbc2eb'],
	['#43e97b', '#38f9d7'],
	['#fa709a', '#fee140'],
	['#30cfd0', '#8b5cf6'],
	['#ff512f', '#dd2476'],
	['#e0e0e0', '#7f8c8d']
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Whatever came from the server or a form, as a NameStyle (anything odd is left out). */
export function readNameStyle(value: unknown): NameStyle {
	let v = value;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return { ...NO_STYLE };
		}
	}
	const o = (v && typeof v === 'object' ? v : {}) as Partial<NameStyle>;
	const effect = o.effect === 'gradient' || o.effect === 'glow' ? o.effect : 'solid';
	const colors = (Array.isArray(o.colors) ? o.colors : []).filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 2);
	const font = typeof o.font === 'string' && FONTS.some((f) => f.id === o.font) ? o.font : '';
	const style: NameStyle = { font, effect, colors };
	if (o.glow === true || effect === 'glow') style.glow = true;
	if (o.shimmer === true) style.shimmer = true;
	return style;
}

/**
 * Saved so an older Catalog shows the nearest it can: one color lit up is still `glow`, a gradient
 * stays `gradient` (it just shows it without the extras).
 */
export function nameStyleToSave(s: NameStyle): NameStyle {
	const effect = s.effect === 'gradient' ? 'gradient' : s.glow ? 'glow' : 'solid';
	return { font: s.font, effect, colors: s.colors, ...(s.glow ? { glow: true } : {}), ...(s.shimmer ? { shimmer: true } : {}) };
}

/** The inline style for a name drawn with `s`. */
export function nameCss(s: NameStyle): string {
	const parts: string[] = [];
	const font = FONTS.find((f) => f.id === s.font);
	if (font?.family) parts.push(`font-family: ${font.family}`);
	const [a, b] = s.colors;
	if (!a) return parts.join('; ');
	const gradient = s.effect === 'gradient';
	if (gradient || s.shimmer) {
		// Drawn across the letters themselves. A shine is a light band in the colors, moved along.
		const colors = gradient ? `${a}, ${b ?? a}` : `${a}, ${a}`;
		const image = s.shimmer
			? `linear-gradient(100deg, ${colors.split(', ')[0]} 0%, ${colors.split(', ')[1]} 40%, color-mix(in srgb, ${b ?? a} 35%, white) 50%, ${colors.split(', ')[1]} 60%, ${colors.split(', ')[0]} 100%)`
			: `linear-gradient(90deg, ${colors})`;
		parts.push(
			`background-image: ${image}`,
			'-webkit-background-clip: text',
			'background-clip: text',
			'color: transparent',
			'-webkit-text-fill-color: transparent'
		);
		if (s.shimmer) parts.push('background-size: 250% 100%', 'animation: name-shimmer 3.5s ease-in-out infinite');
	} else {
		parts.push(`color: ${a}`);
	}
	// A glow as a shadow of the drawn letters (a text-shadow would show through a gradient's
	// see-through letters and muddy it): the first color, and the second for a gradient.
	if (s.glow) parts.push(`filter: drop-shadow(0 0 4px ${a}) drop-shadow(0 0 10px color-mix(in srgb, ${b ?? a} 70%, transparent))`);
	return parts.join('; ');
}

/** The Google Fonts stylesheet for one font id, or '' for the normal one. */
export function fontHref(id: string): string {
	const font = FONTS.find((f) => f.id === id);
	return font?.google ? `https://fonts.googleapis.com/css2?family=${font.google}&display=swap` : '';
}

/** Loads a font's stylesheet once (a <link> in the page's head). */
export function loadFont(id: string): void {
	if (typeof document === 'undefined') return;
	const href = fontHref(id);
	if (!href || document.head.querySelector(`link[data-name-font="${id}"]`)) return;
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	link.dataset.nameFont = id;
	document.head.appendChild(link);
}
