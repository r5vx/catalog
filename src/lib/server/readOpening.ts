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
	return size ? { done: false, value: Buffer.concat(chunks) } : { done: true, value: undefined };
}
