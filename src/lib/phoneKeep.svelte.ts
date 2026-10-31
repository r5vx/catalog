/**
 * Downloads kept on this phone, to play with no connection (the phone app, opened from the
 * Home Screen on the secure Tailscale address: Settings → Phones). The files are written by
 * phoneKeep.worker.ts; static/offline.html lists and plays them when Catalog can't be reached,
 * and keeps where each was left (`catalog:keptPlaces`), which `sendKeptPlaces` hands back to
 * Catalog once it can.
 *
 * Needs the secure address: a phone's browser keeps no files for a plain http:// page.
 */
export type KeptMeta = {
	id: number;
	kind: 'film' | 'episode' | 'replay';
	title: string;
	year: string;
	season: number;
	episode: number;
	episodeName: string | null;
	poster: string | null;
	bytes: number;
	duration: number;
	place: number;
	hasSubtitles: boolean;
	name: string;
};

/** Where each one is: kept, being kept (bytes so far), or a problem. */
export const kept = $state<{ ids: number[]; saving: Record<number, number>; problems: Record<number, string> }>({ ids: [], saving: {}, problems: {} });

const workers = new Map<number, Worker>();

/** Whether this phone can keep files for Catalog (a secure address, a browser that can). */
export function canKeep(): boolean {
	return typeof window !== 'undefined' && window.isSecureContext && typeof navigator.storage?.getDirectory === 'function' && typeof Worker !== 'undefined';
}

async function folder(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const root = await navigator.storage.getDirectory();
		return await root.getDirectoryHandle('kept', { create: true });
	} catch {
		return null;
	}
}

/** Which downloads are whole on this phone. */
export async function refreshKept(): Promise<void> {
	if (!canKeep()) return;
	const dir = await folder();
	if (!dir) return;
	const ids: number[] = [];
	try {
		for await (const name of (dir as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) {
			const m = name.match(/^(\d+)\.json$/);
			if (m) ids.push(Number(m[1]));
		}
	} catch {}
	kept.ids = ids;
}

function run(id: number, message: Record<string, unknown>, onProgress?: (bytes: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./phoneKeep.worker.ts', import.meta.url), { type: 'module' });
		workers.set(id, worker);
		worker.onmessage = (event) => {
			const data = event.data;
			if (typeof data.progress === 'number') onProgress?.(data.progress);
			else {
				worker.terminate();
				workers.delete(id);
				if (data.done) resolve();
				else reject(new Error(data.error ?? "Couldn't keep it on this phone"));
			}
		};
		worker.onerror = () => {
			worker.terminate();
			workers.delete(id);
			reject(new Error("This phone couldn't save it"));
		};
		worker.postMessage({ ...message, id });
	});
}

/** Saves a download onto this phone (carrying on if it was cut short before). */
export async function keepOnPhone(meta: KeptMeta): Promise<boolean> {
	if (!canKeep() || workers.has(meta.id)) return false;
	// Asked to be kept for good, so the phone doesn't clear it to make room.
	navigator.storage.persist?.().catch(() => {});
	delete kept.problems[meta.id];
	kept.saving[meta.id] = 0;
	try {
		await run(meta.id, { action: 'keep', meta }, (bytes) => (kept.saving[meta.id] = bytes));
		delete kept.saving[meta.id];
		await refreshKept();
		return true;
	} catch (e) {
		delete kept.saving[meta.id];
		kept.problems[meta.id] = e instanceof Error ? e.message : "Couldn't keep it on this phone";
		return false;
	}
}

export function stopKeeping(id: number): void {
	workers.get(id)?.postMessage({ action: 'stop' });
}

export async function removeFromPhone(id: number): Promise<void> {
	stopKeeping(id);
	await run(id, { action: 'remove' }).catch(() => {});
	await refreshKept();
}

type KeptPlace = { place: number; duration: number; at: number };

/**
 * Places from watching with no connection, handed to Catalog: the download's own place and the
 * title's (Continue Watching), as the player sends them. Each goes once it's been taken.
 */
export async function sendKeptPlaces(): Promise<void> {
	let places: Record<string, KeptPlace> = {};
	try {
		places = JSON.parse(localStorage.getItem('catalog:keptPlaces') ?? '{}');
	} catch {
		return;
	}
	const dir = Object.keys(places).length ? await folder() : null;
	for (const [id, where] of Object.entries(places)) {
		let meta: KeptMeta | null = null;
		try {
			meta = dir ? JSON.parse(await (await (await dir.getFileHandle(`${id}.json`)).getFile()).text()) : null;
		} catch {}
		const sent = await fetch(`/api/downloads/${id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ place: where.place, duration: where.duration })
		})
			.then((r) => r.ok || r.status === 404)
			.catch(() => false);
		if (!sent) continue;
		if (meta) {
			const type = meta.kind === 'episode' ? 'tv' : meta.kind === 'replay' ? 'replay' : 'movie';
			await fetch('/api/watch/progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: meta.title, type, season: meta.season, episode: meta.episode, currentTime: where.place, duration: where.duration, posterUrl: meta.poster ?? '' })
			}).catch(() => {});
		}
		delete places[id];
	}
	try {
		localStorage.setItem('catalog:keptPlaces', JSON.stringify(places));
	} catch {}
}
