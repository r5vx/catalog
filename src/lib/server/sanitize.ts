/**
 * Cleans the HTML a note editor produces before it's stored.
 *
 * You're the only person writing these, so this isn't about defending against
 * you — it's about what comes along for the ride when you paste from a web
 * page. A pasted block can carry scripts, tracking pixels and inline handlers,
 * and none of that belongs in your notes.
 */

/** Formatting worth keeping. Anything else is unwrapped or dropped. */
const ALLOWED = new Set([
	'p', 'br', 'div', 'span',
	'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'mark', 'code', 'pre',
	'h1', 'h2', 'h3', 'h4',
	'ul', 'ol', 'li',
	'blockquote', 'hr',
	'a', 'img',
	'table', 'thead', 'tbody', 'tr', 'td', 'th'
]);

/** Tags whose entire contents go too, not just the tag itself. */
const STRIP_WHOLE = /<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1\s*>/gi;

const ATTRIBUTES: Record<string, string[]> = {
	a: ['href', 'title'],
	img: ['src', 'alt', 'width', 'height'],
	td: ['colspan', 'rowspan'],
	th: ['colspan', 'rowspan']
};

function safeUrl(value: string): boolean {
	const url = value.trim().toLowerCase();
	// Our own uploads, ordinary links, and inline data images only.
	return (
		url.startsWith('/media/') ||
		url.startsWith('http://') ||
		url.startsWith('https://') ||
		url.startsWith('mailto:') ||
		url.startsWith('data:image/')
	);
}

export function sanitizeHtml(input: string): string {
	let html = String(input ?? '')
		.replace(STRIP_WHOLE, '')
		// Svelte leaves marker comments inside the editor; without this they'd be
		// saved back and pile up a little more on every keystroke.
		.replace(/<!--[\s\S]*?-->/g, '');

	// Rewrite every tag: drop the ones we don't allow, and strip attributes
	// that aren't on the list for that tag (which removes all on* handlers).
	html = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
		(_match, closing: string, rawName: string, rawAttrs: string) => {
			const name = rawName.toLowerCase();
			if (!ALLOWED.has(name)) return '';
			if (closing) return `</${name}>`;

			const permitted = ATTRIBUTES[name] ?? [];
			const kept: string[] = [];

			for (const attr of rawAttrs.matchAll(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
				const key = attr[1].toLowerCase();
				if (!permitted.includes(key)) continue;

				const value = attr[2].replace(/^["']|["']$/g, '');
				if ((key === 'href' || key === 'src') && !safeUrl(value)) continue;

				kept.push(`${key}="${value.replace(/"/g, '&quot;')}"`);
			}

			const selfClosing = name === 'br' || name === 'hr' || name === 'img';
			return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClosing ? ' /' : ''}>`;
		}
	);

	return html;
}

/** A note's title is plain text, never markup. */
export function sanitizeTitle(input: string): string {
	return String(input ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}
