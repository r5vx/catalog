/**
 * Keeps a download on this phone (phoneKeep.svelte.ts): its MP4, captions and poster go into the
 * browser's private storage for Catalog (the origin private file system), in `kept/`:
 * `<id>.mp4`, `<id>.vtt`, `<id>.jpg`, and `<id>.json` last, which says it's whole. Written here,
 * in a worker, because Safari only writes those files from one. An MP4 cut short (the app closed,
 * the connection lost) carries on from where it got to next time.
 *
 * Messages in: { action: 'keep', id, meta } | { action: 'remove', id } | { action: 'stop' }.
 * Out: { progress: bytes } | { done: true } | { error: string }.
 */
type Meta = { bytes: number; hasSubtitles: boolean; poster: string | null } & Record<string, unknown>;

type SyncHandle = {
	getSize(): number;
	write(data: Uint8Array, options: { at: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
};
type FileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> };

let stopped = false;

async function keptFolder(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle('kept', { create: true });
}

async function writeWhole(folder: FileSystemDirectoryHandle, name: string, bytes: Uint8Array) {
	const file = (await folder.getFileHandle(name, { create: true })) as FileHandle;
	const handle = await file.createSyncAccessHandle();
	try {
		handle.truncate(0);
		handle.write(bytes, { at: 0 });
		handle.flush();
	} finally {
		handle.close();
	}
}

/** SRT to WebVTT, which the phone's own player reads. */
function toVtt(srt: string): string {
	const body = srt
		.replace(/\r/g, '')
		.replace(/^﻿/, '')
		.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
		.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3} -->)/gm, '');
	return `WEBVTT\n\n${body.trim()}\n`;
}

async function keep(id: number, meta: Meta) {
	const folder = await keptFolder();
	const file = (await folder.getFileHandle(`${id}.mp4`, { create: true })) as FileHandle;
	const handle = await file.createSyncAccessHandle();
	try {
		let at = handle.getSize();
		if (at >= meta.bytes && meta.bytes > 0) at = meta.bytes;
		else {
			const response = await fetch(`/api/downloads/${id}/file`, { headers: at ? { Range: `bytes=${at}-` } : {} });
			if (!response.ok || !response.body) throw new Error("The computer didn't send the video");
			// Asked to carry on but sent from the start: written again from the start.
			if (at && response.status !== 206) {
				handle.truncate(0);
				at = 0;
			}
			const reader = response.body.getReader();
			let told = 0;
			for (;;) {
				if (stopped) {
					reader.cancel().catch(() => {});
					handle.flush();
					postMessage({ error: 'Stopped' });
					return;
				}
				const { value, done } = await reader.read();
				if (done) break;
				handle.write(value, { at });
				at += value.byteLength;
				if (at - told > 2 * 1024 * 1024) {
					told = at;
					postMessage({ progress: at });
				}
			}
			handle.flush();
		}
		if (meta.bytes && at < meta.bytes) throw new Error('The video stopped coming partway');
	} finally {
		handle.close();
	}

	if (meta.hasSubtitles) {
		const srt = await fetch(`/api/downloads/${id}/subtitles`).then((r) => (r.ok ? r.text() : ''));
		if (srt) await writeWhole(folder, `${id}.vtt`, new TextEncoder().encode(toVtt(srt)));
	}
	if (meta.poster) {
		const picture = await fetch(meta.poster)
			.then((r) => (r.ok ? r.arrayBuffer() : null))
			.catch(() => null);
		if (picture) await writeWhole(folder, `${id}.jpg`, new Uint8Array(picture));
	}
	await writeWhole(folder, `${id}.json`, new TextEncoder().encode(JSON.stringify({ ...meta, id, keptAt: Date.now() })));
	postMessage({ done: true });
}

async function remove(id: number) {
	const folder = await keptFolder();
	for (const ext of ['json', 'mp4', 'vtt', 'jpg']) await folder.removeEntry(`${id}.${ext}`).catch(() => {});
	postMessage({ done: true });
}

onmessage = (event: MessageEvent) => {
	const { action, id, meta } = event.data ?? {};
	if (action === 'stop') {
		stopped = true;
		return;
	}
	const work = action === 'keep' ? keep(Number(id), meta) : action === 'remove' ? remove(Number(id)) : Promise.resolve();
	work.catch((e: unknown) => postMessage({ error: e instanceof Error ? e.message : "Couldn't keep it on this phone" }));
};
