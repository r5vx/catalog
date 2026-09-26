interface FetchResult {
	status: number;
	body: string;
	error?: string;
}

interface VideoUrlResult {
	playerHtml: string;
	dlText: string;
	capturedUrl?: string;
	videoInfo?: string;
	error?: string;
}

interface CookieSyncResult {
	token: string;
	error?: string;
}

interface CookieDetail {
	name: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: string;
	valueLen: number;
}

interface DebugCookiesResult {
	cookies: CookieDetail[];
	error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pending = new Map<string, (result: any) => void>();

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
						capturedUrl: (m.capturedUrl as string) ?? '',
						videoInfo: (m.videoInfo as string) ?? '',
						error: m.error as string | undefined
					});
					pending.delete(m.id);
				}
				if (m.type === 'sync-cookies-result') {
					pending.get(m.id)!({
						token: (m.token as string) ?? '',
						error: m.error as string | undefined
					});
					pending.delete(m.id);
				}
				if (m.type === 'get-subtitles-result') {
					pending.get(m.id)!({
						data: (m.data as string) ?? '',
						error: m.error as string | undefined
					});
					pending.delete(m.id);
				}
				if (m.type === 'debug-cookies-result') {
					pending.get(m.id)!({
						cookies: (m.cookies as CookieDetail[]) ?? [],
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
				resolve({ playerHtml: '', dlText: '', capturedUrl: '', videoInfo: '', error: 'timeout' });
			}
		}, 20000);
	});
}

export function electronDebugCookies(): Promise<DebugCookiesResult> {
	if (typeof process.send !== 'function') {
		return Promise.resolve({ cookies: [], error: 'not in Electron' });
	}

	const id = String(++counter);

	return new Promise<DebugCookiesResult>((resolve) => {
		pending.set(id, resolve);
		process.send!({ type: 'debug-cookies', id });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ cookies: [], error: 'timeout' });
			}
		}, 10000);
	});
}

export function electronSyncCookies(): Promise<CookieSyncResult> {
	if (typeof process.send !== 'function') {
		return Promise.resolve({ token: '', error: 'not in Electron' });
	}

	const id = String(++counter);

	return new Promise<CookieSyncResult>((resolve) => {
		pending.set(id, resolve);
		process.send!({ type: 'sync-cookies', id });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ token: '', error: 'timeout' });
			}
		}, 10000);
	});
}

interface SubtitleResult {
	data: string;
	error?: string;
}

export function electronGetSubtitles(
	shareKey: string,
	fid: number
): Promise<SubtitleResult> {
	if (typeof process.send !== 'function') {
		return Promise.resolve({ data: '', error: 'not in Electron' });
	}

	const id = String(++counter);

	return new Promise<SubtitleResult>((resolve) => {
		pending.set(id, resolve);
		process.send!({ type: 'get-subtitles', id, shareKey, fid });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ data: '', error: 'timeout' });
			}
		}, 15000);
	});
}
