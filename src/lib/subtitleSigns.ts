/**
 * On-screen text in subtitles that lost its place (owner, 2026-11-19: ERASED E5).
 *
 * Fansub groups translate signs (a TV's news ticker, a letter, a shop sign) and place each one on
 * the sign itself. Turned into SRT, the place is lost, and the converter often joins the sign onto
 * whatever is said at the same time: "The investigation became public, / NEXT UP: / ELEMENTARY
 * SCHOOL STUDENT MISSING / HOKKAIDO - CHILDREN'S WHEREABOUTS UNKNOWN / KAYO HINAZUKI" as one
 * six-line wall at the bottom. Signs are written in capitals; talking isn't. So in a file that
 * is otherwise in ordinary case, its all-capital lines are split off and shown at the top of the
 * picture, apart from the talking (and marked as not talking, for auto-timing).
 *
 * Only for files where capitals are rare (an all-capitals file, old DVD subtitles or captions
 * written that way, is left alone), and only lines of four letters or more ("NO!" stays).
 */
type Cue = { start: number; end: number; text: string; top: boolean; song?: boolean };

const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/g, ' ');

function inCapitals(html: string): boolean {
	const text = plain(html);
	// A speaker's name or a sound in captions ("[SUBARU]", "(GASPS)") belongs with the talking.
	if (/^\s*[[(].*[\])]\s*:?\s*$/.test(text)) return false;
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 4) return false;
	// No small letters at all, and some capitals (not just Japanese or numbers).
	return !/\p{Ll}/u.test(text) && /\p{Lu}/u.test(text);
}

/**
 * Shouted, not written: capitals ending like a sentence ("OK, OK, OK, OK.", "UDC! UDC!",
 * "FUCK!"). The Day of the Jackal's subtitles write shouts in capitals, and each one went to the
 * top of the picture, so the line seemed missing from the bottom (owner, 2026-11-26). Signs
 * rarely end in ! or ? ("NEXT UP:", "KAYO HINAZUKI"); a full stop only after short words, since a
 * sign's last line can have one (Re:Zero's "PERSON OR ORGANIZATION.").
 */
function isShout(html: string): boolean {
	if (!inCapitals(html)) return false;
	const text = plain(html);
	return /[!?…]['"’”]?\s*$/.test(text) || (/\.['"’”]?\s*$/.test(text) && !/\p{L}{5}/u.test(text));
}

const isSignLine = (html: string) => inCapitals(html) && !isShout(html);

/** `<i>`, `<b>` and `<u>` opened on one line and closed on another: tags dropped from a line on its own. */
const tidy = (html: string) => {
	const opens = (html.match(/<[ibu]>/g) ?? []).length;
	const closes = (html.match(/<\/[ibu]>/g) ?? []).length;
	return opens === closes ? html : html.replace(/<\/?[ibu]>/g, '');
};

export function splitSigns<T extends Cue>(cues: T[]): T[] {
	const lines = cues.flatMap((cue) => cue.text.split('\n'));
	if (lines.length < 50) return cues;
	const signs = lines.filter(isSignLine).length;
	// Capitals everywhere: that's how the whole file is written.
	if (!signs || signs / lines.length > 0.15) return cues;
	const out: T[] = [];
	for (const cue of cues) {
		const parts = cue.text.split('\n');
		const sign = parts.filter(isSignLine);
		// A shout over two lines stays whole ("CRUMBLE AND BURN TO CINDERS, / FALSE SONGSTRESS!!!").
		if (!sign.length || cue.top || parts.some(isShout)) {
			out.push(cue);
			continue;
		}
		const said = parts.filter((line) => !isSignLine(line));
		if (said.length) out.push({ ...cue, text: said.map(tidy).join('\n') });
		out.push({ ...cue, text: sign.map((line) => line.replace(/<\/?[ibu]>/g, '')).join('\n'), top: true, song: true });
	}
	return out;
}
