import { randomBytes } from 'node:crypto';

/**
 * Turning a page into a PDF.
 *
 * The print dialog was the first attempt and it produced files that wouldn't
 * open. Chromium can render a page to PDF directly, and the desktop app *is*
 * Chromium — so the server asks it to, over the channel they already share,
 * and hands back the bytes as an ordinary download.
 *
 * Only the desktop app can do this. In a plain browser there's nothing to ask,
 * so the button isn't offered and the print dialog remains the way.
 */

export const desktopAvailable = () => Boolean(process.send && process.env.CATALOG_DESKTOP);

type Pending = {
	resolve: (pdf: Buffer) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();

/**
 * One-time passes for the hidden window that renders the page.
 *
 * It's a separate window with no cookies, so with a PIN set it would be sent
 * straight to the login page and we'd render a PDF of that. A token in the URL
 * lets exactly one request through, once, within the minute.
 */
const tokens = new Map<string, number>();

const TOKEN_LIFE = 60_000;

function mintToken(): string {
	const token = randomBytes(18).toString('hex');
	tokens.set(token, Date.now() + TOKEN_LIFE);
	return token;
}

/** True once per token, and never after it expires. */
export function consumePdfToken(token: string | null): boolean {
	if (!token) return false;

	const expires = tokens.get(token);
	if (!expires) return false;

	tokens.delete(token);
	return Date.now() < expires;
}

/** Ask the desktop app to render one of our own pages, and wait for the bytes. */
export function renderPdf(path: string, timeoutMs = 45_000): Promise<Buffer> {
	if (!desktopAvailable()) {
		return Promise.reject(new Error('PDF rendering needs the desktop app.'));
	}

	const id = randomBytes(9).toString('hex');
	const separator = path.includes('?') ? '&' : '?';
	const url = `${path}${separator}pdfToken=${mintToken()}`;

	return new Promise<Buffer>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error('The PDF took too long to render.'));
		}, timeoutMs);

		pending.set(id, { resolve, reject, timer });
		process.send?.({ type: 'print-pdf', id, path: url });
	});
}

// Registered once, on first import — `hooks.server.ts` pulls this in at boot.
process.on('message', (message: unknown) => {
	const note = message as { type?: string; id?: string; data?: string; error?: string } | null;
	if (note?.type !== 'pdf-done' || !note.id) return;

	const waiting = pending.get(note.id);
	if (!waiting) return;

	pending.delete(note.id);
	clearTimeout(waiting.timer);

	if (note.error) waiting.reject(new Error(note.error));
	else waiting.resolve(Buffer.from(note.data ?? '', 'base64'));
});
