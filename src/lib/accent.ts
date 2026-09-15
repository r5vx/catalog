/** The colour the app ships with — the same pink as the icon. */
export const DEFAULT_ACCENT = '#8c2f39';

export const ACCENT_PRESETS = [
	{ name: 'Maroon', value: '#8c2f39' },
	{ name: 'Pink', value: '#e9699b' },
	{ name: 'Purple', value: '#7a5af5' },
	{ name: 'Blue', value: '#2f6fd0' },
	{ name: 'Teal', value: '#118a80' },
	{ name: 'Green', value: '#3f7d4e' },
	{ name: 'Amber', value: '#b5730f' },
	{ name: 'Slate', value: '#5b6570' }
];

export const isHexColour = (value: string) => /^#[0-9a-f]{6}$/i.test(value.trim());

/**
 * Black or white text, whichever stays readable on the chosen colour.
 * Uses relative luminance rather than a plain brightness average, because
 * green reads far lighter than blue at the same numeric value.
 */
export function inkFor(hex: string): string {
	const value = Number.parseInt(hex.replace('#', ''), 16);
	const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});

	const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	return luminance > 0.45 ? '#141414' : '#ffffff';
}
