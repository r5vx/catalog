/**
 * Which lines of an .ass subtitle file are signs and songs (drawn as made over the video,
 * src/lib/styledSubs.ts) rather than someone talking (the player's own captions). One rule for
 * the player and the server (styledSubtitles.ts), so a file the player would draw is always kept,
 * and a line is never shown twice or not at all. Imports nothing.
 */

/** Style names of songs and signs: "ED", "OP Romaji", "Song_Eng", "Sign", "Title", "kfx", "Ending". */
const SONG_STYLE = /song|lyric|karaoke|insert|opening|ending|sign|title|kfx|(^|[^a-z])(op|ed)([^a-z]|$)/i;

/**
 * Whether a Dialogue line is a sign or a song: its style says so, it's placed somewhere (\pos,
 * \move), or it's a drawing (\p1) or karaoke (\k).
 */
export function isStyledLine(style: string, raw: string): boolean {
	return SONG_STYLE.test(style) || /\\(pos|move)\(/.test(raw) || /\{[^}]*\\(p[1-9]|[kK][fo]?\d)[^}]*\}/.test(raw);
}

/** A Dialogue line's style and text, or null. */
export function dialogueLine(line: string): { style: string; raw: string } | null {
	if (!line.startsWith('Dialogue:')) return null;
	const parts = line.substring(9).split(',');
	if (parts.length < 10) return null;
	return { style: (parts[3] ?? '').trim(), raw: parts.slice(9).join(',') };
}

/** Whether an .ass file has any sign or song lines at all. */
export function hasStyledLines(text: string): boolean {
	if (!text.includes('Dialogue:')) return false;
	for (const line of text.split(/\r?\n/)) {
		const d = dialogueLine(line);
		if (d && isStyledLine(d.style, d.raw)) return true;
	}
	return false;
}
