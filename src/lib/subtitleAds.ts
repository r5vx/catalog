/**
 * Lines and whole subtitles that subtitle sites and teams slip in: adverts, web addresses and
 * credits, not anything said. Used by the player (routes/watch) and the Roku's captions
 * (api/roku/subtitles), so both drop the same ones.
 */

/**
 * A whole subtitle that's a credit or an advert spread over several lines, where one line alone
 * doesn't say so ("Subtitles by / SDI Media Group", "Captioning made possible by / Touchstone
 * Television…", "Press play. Subtitles appear. / 200+ languages. One app: tryray.app"). Found by
 * going through 209 English subtitle files of 32 films and shows (2026-10-22).
 */
export function isCredit(cue: string): boolean {
	return (
		/^[-–=[\s]*(english |closed )?(subtit\w*|captions?|synch?(ed|ro\w*)?|titles( re[- ]?edited)?)( (and|&) \w+)?\s*(by\b|:)/i.test(cue) ||
		/\bcaption(ing|ed)( (made possible|provided|performed))? by\b|\bcaptioning institute\b/i.test(cue) ||
		/explosive ?skull|kaboom ?skull|swesubs|press play\.? subtitles appear|\b200\+ languages|copyright (from|by) s?d?i media|\bsdi media group\b/i.test(cue) ||
		/hope you('ve| have)? (liked|enjoyed)( (&|and) enjoyed)? the (movie|film|show|episode)/i.test(cue) ||
		// Labels, not anything said: "[ENGLISH SDH]", "English - US - SDH"
		/^\[?english( - (us|uk))?( - | )?p?sdh\]?$|^\[?english - (us|uk)\]?$/i.test(cue)
	);
}

/**
 * A line the subtitle sites slip in, not anything said: a web address ("Watch Online Movies
 * and Series for FREE www.osdb.link/lm", "Downloaded From www.AllSubs.org") or their wording
 * ("Do you want subtitles for any video?", "Support us and become VIP member", "Subtitles by
 * …"). Only that line goes: a subtitle with nothing else in it is dropped, and every other
 * one keeps its own times, so the timing isn't touched. Found by going through the English
 * subtitles of 20 films and shows; ordinary lines like "...to the real world" don't match.
 */
export function isAdvert(line: string): boolean {
	return (
		// Not "Awww.. Hey.."
		/(https?:\/\/|\bwww\.)\S+/i.test(line) ||
		// Spaced out to get past filters: "www  .  OpenSubtitles  .  org", "—www. ncicap. org—"
		/\bwww\s*\.\s*[a-z0-9-]+\s*\.\s*[a-z]{2,4}\b/i.test(line) ||
		// "-=xXSwesubsXx=-", and letters drawn out of letters ("sssssss    iiiiiii    mmmmmm")
		/^-=.+=-$/.test(line) ||
		/([a-z])\1{7,}(\s{3,}|\t)/i.test(line) ||
		/\b[a-z0-9-]{2,}\.(com|org|net|link|io|me|to|tv|cc|ws|info|xyz|site|club|mx|ag|ru|pt|ro|app)(\/\S*)?(?![a-z])/i.test(line) ||
		// "Tired of searching for subtitles? Ray generates them instantly: getray.app"
		/subtitles for any video|tired of searching for subtitles|generates (them|subtitles) instantly|advertise your product|support us and become|become (a )?vip|downloaded from/i.test(line) ||
		// A subtitle team's, not Madagascar's "The Central Park Zoo proudly presents..."
		/\b(subs|subtitles?|team|group)\b.{0,30}proudly presents/i.test(line) ||
		// "Watch Online Movies and Series for FREE" (the only line it caught in 56,120 kept ones)
		/\bwatch\b.{0,25}\b(movies?|series|tv shows?|anime)\b.{0,25}\bfree\b|\bfree\b.{0,15}\b(movies?|series)\b.{0,15}\bonline\b/i.test(line) ||
		// …and "Edited by BugZ" (Ice Age, 2026-11-04), "Proofread by …", "Re-edited by …"
		/^[-–=[\s]*(subtitles?|subs|captions?|synch?(ed|roni[sz]ed)?|resynch?(ed)?|corrected|ripped|translated|transcribed|subtitled|timing|encoded|(re-?)?edited|proof-?read|conformed|tweaked)( (and|&) \w+)? by\b/i.test(line)
	);
}
