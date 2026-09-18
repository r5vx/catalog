interface FetchResult {
	status: number;
	body: string;
	error?: string;
}

interface VideoUrlResult {
	playerHtml: string;
	dlText: string;
	error?: string;
}

const pending = new Map<string, (result: FetchResult | VideoUrlResult) => void>();

try {
	if (typeof process.send === 'function') {
		process.on('message', (msg: unknown) => {
			const m = msg as Record<string, unknown>;
			if (m?.id && typeof m.id === 'string' && pending.has(m.id)) {
				if (m.type === 'fetch-febbox-result') {
					pending.get(m.id)!({
						status: (m.status as number) ?? 0,
						body: (m.body as string) ?? '',
						error: m.error as string | undefined
					});
					pending.delete(m.id);
				}
				if (m.type === 'get-video-url-result') {
					pending.get(m.id)!({
						playerHtml: (m.playerHtml as string) ?? '',
						dlText: (m.dlText as string) ?? '',
						error: m.error as string | undefined
					});
					pending.delete(m.id);
				}
			}
		});
	}
} catch {}

let counter = 0;

export function electronFetch(
	url: string,
	options?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<FetchResult> {
	if (typeof process.send !== 'function') {
		return Promise.resolve({ status: 0, body: '', error: 'not in Electron' });
	}

	const id = String(++counter);

	return new Promise<FetchResult>((resolve) => {
		pending.set(id, resolve as (r: FetchResult | VideoUrlResult) => void);
		process.send!({ type: 'fetch-febbox', id, url, options });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ status: 0, body: '', error: 'timeout' });
			}
		}, 15000);
	});
}

export function electronGetVideoUrl(
	shareKey: string,
	fid: number
): Promise<VideoUrlResult> {
	if (typeof process.send !== 'function') {
		return Promise.resolve({ playerHtml: '', dlText: '', error: 'not in Electron' });
	}

	const id = String(++counter);

	return new Promise<VideoUrlResult>((resolve) => {
		pending.set(id, resolve as (r: FetchResult | VideoUrlResult) => void);
		process.send!({ type: 'get-video-url', id, shareKey, fid });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ playerHtml: '', dlText: '', error: 'timeout' });
			}
		}, 20000);
	});
}
