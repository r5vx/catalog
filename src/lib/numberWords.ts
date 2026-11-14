/**
 * Numbers one to ten written either way, so searching "Fantastic Four" finds "The Fantastic 4:
 * First Steps" and "Oceans 8" finds "Ocean's Eight". Used by Browse's search ranking and the
 * library's own search.
 */
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "fantastic four" → "fantastic 4". Expects lower case. */
export const numbersAsDigits = (text: string) =>
	text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => String(WORDS.indexOf(word) + 1));

/** "fantastic 4" → "fantastic four". Expects lower case. */
export const digitsAsWords = (text: string) => text.replace(/\b([1-9]|10)\b/g, (digit) => WORDS[Number(digit) - 1]);

/**
 * Whether swapping is worth trying for this search: it has a number and a real word beside it.
 * "seven" alone would match every title with a 7 in it.
 */
export const hasNumberToSwap = (text: string) =>
	/\b(one|two|three|four|five|six|seven|eight|nine|ten|[1-9]|10)\b/.test(text) && /[a-z]{3,}/.test(text.replace(/^(the|a|an)\s+/, '').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ''));
