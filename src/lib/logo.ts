import { isOwnPicture } from './background';
import { isHexColour } from './accent';

/**
 * The logo at the top of the sidebar, the library, the TV menu and the sign-in page
 * (Settings → Personalization → Logo): Catalog's own, words of your own, or a picture.
 * `dot` recolors the pink circle in Catalog's own logo ('' keeps the theme's pink).
 */
export type Logo = { kind: 'catalog' | 'words' | 'picture'; words: string; image: string; dot: string };

export const LOGO_WORDS_MOST = 24;

export function logoFrom(settings: { logoKind?: string; logoWords?: string; logoImage?: string; logoDot?: string }): Logo {
	const words = (settings.logoWords ?? '').slice(0, LOGO_WORDS_MOST);
	const image = isOwnPicture(settings.logoImage ?? '') ? settings.logoImage! : '';
	const dot = isHexColour(settings.logoDot ?? '') ? settings.logoDot! : '';
	const kind = settings.logoKind === 'words' && words.trim() ? 'words' : settings.logoKind === 'picture' && image ? 'picture' : 'catalog';
	return { kind, words, image, dot };
}

/**
 * The app icon (Settings → Personalization → App icon): the pink circle, a circle in a color of
 * your own, or a picture (cut to a square, round or not). The picture itself is drawn on the page
 * and saved as app-icon.png beside the library (src/lib/server/appIcon.ts).
 */
export type AppIconChoice = { kind: 'pink' | 'color' | 'picture'; color: string; image: string; round: boolean };

export const PINK = '#e994c2';

export function appIconFrom(saved: string | undefined): AppIconChoice {
	try {
		const parsed = JSON.parse(saved ?? 'null') as Partial<AppIconChoice> | null;
		if (parsed && (parsed.kind === 'color' || parsed.kind === 'picture')) {
			return {
				kind: parsed.kind === 'picture' && isOwnPicture(parsed.image ?? '') ? 'picture' : 'color',
				color: isHexColour(parsed.color ?? '') ? parsed.color! : PINK,
				image: isOwnPicture(parsed.image ?? '') ? parsed.image! : '',
				round: parsed.round !== false
			};
		}
	} catch {}
	return { kind: 'pink', color: PINK, image: '', round: true };
}
