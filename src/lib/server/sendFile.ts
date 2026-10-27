/**
 * A file from the disk as a response, with Range requests answered (a video player seeking asks
 * for parts of it). `saveAs`: offered as a download with that name.
 */
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

/** The header that offers a response as a file called `name`. */
export const attachment = (name: string) => `attachment; filename="${name.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function sendFile(path: string, type: string, rangeHeader: string | null, saveAs?: string): Response {
	const size = statSync(path).size;
	const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
	if (saveAs) headers['Content-Disposition'] = attachment(saveAs);
	const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
	if (range && (range[1] || range[2])) {
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
		const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
		return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
	}
	const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
	return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } });
}
