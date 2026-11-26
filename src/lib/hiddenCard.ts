/**
 * Browse shows a hidden card when its search box holds a certain phrase. Only the phrase's
 * fingerprint is kept here (the code is public), so reading this doesn't tell anyone what to type.
 */
const FINGERPRINT = '1ss5fed';

/** FNV-1a of the box's text, lower case with single spaces. */
function fingerprint(text: string): string {
	let hash = 0x811c9dc5;
	for (const letter of text.toLowerCase().replace(/\s+/g, ' ').trim()) {
		hash ^= letter.codePointAt(0)!;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36);
}

export const opensHiddenCard = (text: string) => text.length > 0 && text.length < 60 && fingerprint(text) === FINGERPRINT;
