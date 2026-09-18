interface FetchResult {
	status: number;
	body: string;
	error?: string;
}

const pending = new Map<string, (result: FetchResult) => void>();

try {
	if (typeof process.send === 'function') {
		process.on('message', (msg: unknown) => {
			const m = msg as {
				type?: string;
				id?: string;
				status?: number;
				body?: string;
				error?: string;
			};
			if (m?.type === 'fetch-febbox-result' && m.id && pending.has(m.id)) {
				pending.get(m.id)!({ status: m.status ?? 0, body: m.body ?? '', error: m.error });
				pending.delete(m.id);
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
		pending.set(id, resolve);
		process.send!({ type: 'fetch-febbox', id, url, options });

		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				resolve({ status: 0, body: '', error: 'timeout' });
			}
		}, 15000);
	});
}
