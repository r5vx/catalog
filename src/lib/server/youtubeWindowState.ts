/**
 * Whether the desktop app's YouTube window (electron/youtubeWindow.cjs) is open, so Catalog's
 * YouTube page can say so, and offer to open it again once it's closed. The desktop app tells the
 * server each time it opens or closes; on start the server asks once.
 */
let open = false;

if (typeof process.send === 'function' && process.env.CATALOG_DESKTOP) {
	process.on('message', (message: unknown) => {
		const m = message as { type?: string; open?: unknown } | null;
		if (m?.type === 'youtube-state') open = Boolean(m.open);
	});
	process.send({ type: 'youtube-ask' });
}

export function youTubeWindowOpen(): boolean {
	return open;
}
