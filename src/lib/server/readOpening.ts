const decoder = new TextDecoder();
const htmlStart = /^\s*<(?:!doctype\s+html\b|!--|(?:html|head|body|meta|title|script|iframe|div|form|link|style)\b)/i;

export const openingLength = 512;
export const isWebPage = (bytes: Uint8Array): boolean =>
	htmlStart.test(decoder.decode(bytes.subarray(0, openingLength)));

export async function readOpening(
	read: () => Promise<ReadableStreamReadResult<Uint8Array>>,
	length: number,
	first?: ReadableStreamReadResult<Uint8Array>
): Promise<ReadableStreamReadResult<Uint8Array>> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	let next = first ?? await read();
	for (;;) {
		if (next.value?.length) {
			chunks.push(next.value);
			size += next.value.length;
		}
		if (next.done || size >= length) break;
		next = await read();
	}
	return size ? { done: false, value: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks) } : { done: true, value: undefined };
}
