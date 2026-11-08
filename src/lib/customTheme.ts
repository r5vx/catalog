/**
 * The Custom theme (Settings → Personalization → Theme): every colour of the page picked by hand,
 * kept as exact hex codes in the `customTheme` setting (JSON). The accent stays its own choice
 * (Personalization → Colour); the soft tints behind "good" and "warning" notes are mixed from
 * the picked colours, so they always match.
 */

export type CustomTheme = Record<string, string>;

/** Each colour that can be picked: its name in Settings, and the variable in src/app.css. */
export const CUSTOM_COLOURS = [
	{ key: 'paper', label: 'Background', hint: 'Behind every page' },
	{ key: 'surface', label: 'Cards', hint: 'Cards, boxes and menus' },
	{ key: 'surface-2', label: 'Raised', hint: 'Buttons and tiles on cards' },
	{ key: 'sunk', label: 'Sunken', hint: 'Fields and wells' },
	{ key: 'ink', label: 'Text', hint: 'Titles and main text' },
	{ key: 'ink-soft', label: 'Soft text', hint: 'Descriptions' },
	{ key: 'ink-faint', label: 'Faint text', hint: 'Hints and small print' },
	{ key: 'rule', label: 'Lines', hint: 'Borders and dividers' },
	{ key: 'rule-firm', label: 'Strong lines', hint: 'Field borders' },
	{ key: 'good', label: 'Good', hint: 'Done, saved, watched' },
	{ key: 'warn', label: 'Warning', hint: 'Needs a look' }
] as const;

/** Starting points: the built-in themes' own colours (the same as src/app.css). */
export const THEME_COLOURS: Record<'light' | 'dark' | 'black', CustomTheme> = {
	light: {
		paper: '#f1f3f1', surface: '#fbfcfb', 'surface-2': '#e8ece9', sunk: '#e2e7e3',
		ink: '#14201d', 'ink-soft': '#48574f', 'ink-faint': '#77857c',
		rule: '#d3dad5', 'rule-firm': '#b6c0b9', good: '#3f6350', warn: '#8a5d14'
	},
	dark: {
		paper: '#111614', surface: '#181f1c', 'surface-2': '#1f2724', sunk: '#0c100e',
		ink: '#e7ede9', 'ink-soft': '#a3b0a8', 'ink-faint': '#75837b',
		rule: '#2a342f', 'rule-firm': '#3c4a43', good: '#7fb395', warn: '#d7a64e'
	},
	black: {
		paper: '#000000', surface: '#0a0a0a', 'surface-2': '#151515', sunk: '#000000',
		ink: '#e7ede9', 'ink-soft': '#a3b0a8', 'ink-faint': '#6b7970',
		rule: '#1e2622', 'rule-firm': '#2e3a34', good: '#7fb395', warn: '#d7a64e'
	}
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The saved setting, every colour checked; anything missing or broken comes from Dark. */
export function readCustomTheme(saved: string | undefined): CustomTheme {
	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(saved || '{}') ?? {};
	} catch {
		parsed = {};
	}
	const theme: CustomTheme = {};
	for (const { key } of CUSTOM_COLOURS) {
		const value = parsed[key];
		theme[key] = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : THEME_COLOURS.dark[key];
	}
	return theme;
}

/** Whether a colour is a light one (decides light or dark scroll bars, shadows and form fields). */
export function isLight(hex: string): boolean {
	const value = Number.parseInt(hex.replace('#', ''), 16);
	const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** The theme as CSS variables, for the page's root element (`style="…"`). */
export function customThemeCss(theme: CustomTheme): string {
	const light = isLight(theme.paper);
	const parts = CUSTOM_COLOURS.map(({ key }) => `--${key}: ${theme[key]}`);
	parts.push(
		`--good-bg: color-mix(in srgb, ${theme.good} 14%, ${theme.surface})`,
		`--warn-bg: color-mix(in srgb, ${theme.warn} 14%, ${theme.surface})`,
		`--logo-dot: ${light ? '#d16aa6' : '#e994c2'}`,
		light
			? '--shadow: 0 1px 2px rgb(20 32 29 / 6%), 0 6px 20px -12px rgb(20 32 29 / 25%)'
			: '--shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 8px 24px -14px rgb(0 0 0 / 80%)',
		`color-scheme: ${light ? 'light' : 'dark'}`
	);
	return parts.join('; ');
}

/** The names of everything customThemeCss sets, to take them off again for another theme. */
export const CUSTOM_PROPERTIES = [...CUSTOM_COLOURS.map(({ key }) => `--${key}`), '--good-bg', '--warn-bg', '--logo-dot', '--shadow', 'color-scheme'];

/** Puts the theme on the page now (or takes it off with null): live preview and page changes. */
export function applyCustomTheme(theme: CustomTheme | null) {
	const root = document.documentElement.style;
	for (const name of CUSTOM_PROPERTIES) root.removeProperty(name);
	if (!theme) return;
	for (const part of customThemeCss(theme).split('; ')) {
		const at = part.indexOf(':');
		root.setProperty(part.slice(0, at), part.slice(at + 1).trim());
	}
}
