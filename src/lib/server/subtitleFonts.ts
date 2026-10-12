/**
 * Anime subtitle files (.ass) can be enormous: fonts written out inside them, and tens of
 * thousands of lines that animate signs and songs a piece at a time (Re:Zero's from AnimeTosho
 * were 32 MB each, 52,000 lines: the ending's lyrics one letter per line, "a" alone 4,162 times;
 * a few hundred lines were anyone talking). The player shows none of that (src/routes/watch/
 * +page.svelte, cleanCue), so it's dropped before a file is kept or sent on:
 *   - fonts and pictures;
 *   - drawings (\p1 and up) and karaoke syllables (\k, \kf, \ko);
 *   - lines of a single letter;
 *   - the same line again straight after itself (a sign redrawn every frame), made one.
 * Imports nothing, so the library's own start-up can use it.
 */
export function slimSubtitle(text: string): string {
	if (!/^\[(Fonts|Graphics|Events)\]/im.test(text)) return text;
	const out: string[] = [];
	/** The last line kept for each style and wording, and where it is in `out`. */
	const last = new Map<string, { at: number; end: number; parts: string[] }>();
	let dropping = false;
	for (const line of text.split(/\r?\n/)) {
		const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
		if (section) dropping = /^(fonts|graphics)$/i.test(section[1]);
		if (dropping) continue;
		if (!line.startsWith('Dialogue:')) {
			out.push(line);
			continue;
		}
		if (/\{[^}]*\\(p[1-9]|[kK][fo]?\d)[^}]*\}/.test(line)) continue;
		const parts = line.split(',');
		if (parts.length < 10) {
			out.push(line);
			continue;
		}
		const wording = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, ' ').trim();
		if ([...wording].length <= 1) continue;
		const start = seconds(parts[1]);
		const end = seconds(parts[2]);
		const key = `${parts[3]}|${wording}`;
		const before = last.get(key);
		if (before && start <= before.end + 0.05) {
			// Carries straight on from the last one: that one just lasts longer.
			if (end > before.end) {
				before.end = end;
				before.parts[2] = parts[2];
				out[before.at] = before.parts.join(',');
			}
			continue;
		}
		last.set(key, { at: out.length, end, parts });
		out.push(line);
	}
	return out.join('\n');
}

function seconds(stamp: string): number {
	const m = stamp.trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
	return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
}
