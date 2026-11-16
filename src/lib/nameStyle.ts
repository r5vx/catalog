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
	return { font, effect, colors };
}

export const hasStyle = (s: NameStyle) => Boolean(s.font || s.colors.length);

/** The inline style for a name drawn with `s`. */
export function nameCss(s: NameStyle): string {
	const parts: string[] = [];
	const font = FONTS.find((f) => f.id === s.font);
	if (font?.family) parts.push(`font-family: ${font.family}`);
	const [a, b] = s.colors;
	if (s.effect === 'gradient' && a) {
		parts.push(
			`background-image: linear-gradient(90deg, ${a}, ${b ?? a})`,
			'-webkit-background-clip: text',
			'background-clip: text',
			'color: transparent',
			'-webkit-text-fill-color: transparent'
		);
	} else if (a) {
		parts.push(`color: ${a}`);
		if (s.effect === 'glow') parts.push(`text-shadow: 0 0 6px ${a}, 0 0 16px color-mix(in srgb, ${a} 60%, transparent)`);
	}
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
