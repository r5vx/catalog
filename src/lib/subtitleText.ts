/*
 * A subtitle file's bytes as text, whatever character set it was saved in.
 *
 * Many subtitle files are older than UTF-8 being the norm: they were saved in Windows' own
 * character set for their language. Read as UTF-8, every accented letter in them turned into
 * the "unknown character" mark: Ice Age's first English file (OpenSubtitles) has "Bon appêtit"
 * at 7:25 with the ê saved as one Windows-1252 byte (0xEA), so the caption showed "Bon app?tit"
 * (2026-11-03). Used on the computer (downloads) and in the player (a file picked by hand).
 */

/** Windows' character set for each language's older subtitle files (by ISO 639 code). */
const LEGACY: Record<string, string> = {
	// Cyrillic
	rus: 'windows-1251', ru: 'windows-1251', ukr: 'windows-1251', uk: 'windows-1251',
	bul: 'windows-1251', bg: 'windows-1251', bel: 'windows-1251', be: 'windows-1251',
	mkd: 'windows-1251', mk: 'windows-1251', srp: 'windows-1251', sr: 'windows-1251',
	// Central European
	pol: 'windows-1250', pl: 'windows-1250', ces: 'windows-1250', cze: 'windows-1250', cs: 'windows-1250',
	slk: 'windows-1250', slo: 'windows-1250', sk: 'windows-1250', hun: 'windows-1250', hu: 'windows-1250',
	ron: 'windows-1250', rum: 'windows-1250', ro: 'windows-1250', hrv: 'windows-1250', hr: 'windows-1250',
	slv: 'windows-1250', sl: 'windows-1250', bos: 'windows-1250', bs: 'windows-1250', sqi: 'windows-1250', alb: 'windows-1250',
	// Others with their own
	ell: 'windows-1253', gre: 'windows-1253', el: 'windows-1253',
	tur: 'windows-1254', tr: 'windows-1254',
	heb: 'windows-1255', he: 'windows-1255',
	ara: 'windows-1256', ar: 'windows-1256', per: 'windows-1256', fas: 'windows-1256', fa: 'windows-1256',
	est: 'windows-1257', et: 'windows-1257', lav: 'windows-1257', lv: 'windows-1257', lit: 'windows-1257', lt: 'windows-1257',
	vie: 'windows-1258', vi: 'windows-1258',
	tha: 'windows-874', th: 'windows-874',
	chi: 'gbk', zho: 'gbk', zh: 'gbk', zht: 'big5', zhe: 'big5',
	jpn: 'shift_jis', ja: 'shift_jis',
	kor: 'euc-kr', ko: 'euc-kr'
};

const decode = (bytes: Uint8Array, set: string, fatal = false) => new TextDecoder(set, { fatal }).decode(bytes);

/** UTF-16 without a byte-order mark: every other byte is zero in Latin text. */
function utf16Guess(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
	const n = Math.min(bytes.length - (bytes.length % 2), 4000);
	if (n < 20) return null;
	let evenZero = 0, oddZero = 0;
	for (let i = 0; i < n; i += 2) {
		if (bytes[i] === 0) evenZero++;
		if (bytes[i + 1] === 0) oddZero++;
	}
	if (oddZero > n * 0.3 && evenZero < n * 0.05) return 'utf-16le';
	if (evenZero > n * 0.3 && oddZero < n * 0.05) return 'utf-16be';
	return null;
}

/**
 * The text, in order of how sure it is: a byte-order mark, UTF-16 by its zero bytes, valid
 * UTF-8, then the language's older Windows set. With no language known, Western European
 * (Windows-1252), unless most letters are outside ASCII, which means another alphabet:
 * Cyrillic (Windows-1251), the most common one on subtitle sites.
 */
export function subtitleText(bytes: Uint8Array, lang = ''): string {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode(bytes.subarray(3), 'utf-8');
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes.subarray(2), 'utf-16le');
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes.subarray(2), 'utf-16be');
	const wide = utf16Guess(bytes);
	if (wide) return decode(bytes, wide);
	try {
		return decode(bytes, 'utf-8', true);
	} catch {
		// Not UTF-8: an older character set.
	}
	const known = LEGACY[lang.toLowerCase().slice(0, 3)] ?? LEGACY[lang.toLowerCase().slice(0, 2)];
	if (known) {
		try {
			return decode(bytes, known);
		} catch {
			// (A set this runtime can't read: the guess below.)
		}
	}
	let high = 0, letters = 0;
	for (const b of bytes) {
		if (b >= 0xc0) high++;
		if (b >= 0xc0 || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) letters++;
	}
	return decode(bytes, letters && high / letters > 0.4 ? 'windows-1251' : 'windows-1252');
}
