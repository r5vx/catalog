type SubtitleResponse = Pick<Response, 'ok' | 'status' | 'text' | 'json' | 'arrayBuffer'>;
type Pending = { response: Promise<Response>; body: Promise<ArrayBuffer>; stop: AbortController; users: number };

const requests = new Map<string, Pending>();

function within<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
	if (!signal) return work;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener('abort', aborted, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
	});
}

export async function fetchSubtitle(url: string, options: RequestInit, variant: (string | number | undefined)[] = []): Promise<SubtitleResponse> {
	if (options.body || (options.method && options.method !== 'GET')) return fetch(url, options);
	const signal = options.signal;
	signal?.throwIfAborted();
	const request = new Request(url, { ...options, signal: undefined });
	const key = JSON.stringify([request.url, [...request.headers], request.cache, request.credentials, request.integrity, request.mode, request.redirect, request.referrer, request.referrerPolicy, request.keepalive, variant]);
	let under = requests.get(key);
	if (!under) {
		const stop = new AbortController();
		const response = fetch(url, { ...options, signal: stop.signal });
		const body = response.then((r) => r.arrayBuffer()).finally(() => {
			if (requests.get(key) === result) requests.delete(key);
		});
		const result = { response, body, stop, users: 0 };
		requests.set(key, result);
		under = result;
	}
	const pending = under;
	pending.users++;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		signal?.removeEventListener('abort', release);
		if (--pending.users === 0 && requests.get(key) === pending) {
			requests.delete(key);
			pending.stop.abort();
		}
	};
	signal?.addEventListener('abort', release, { once: true });
	void pending.body.then(release, release);
	const response = await within(pending.response, signal);
	const copy = async () => new Response((await within(pending.body, signal)).slice(0));
	return {
		ok: response.ok,
		status: response.status,
		text: async () => (await copy()).text(),
		json: async () => (await copy()).json(),
		arrayBuffer: async () => (await copy()).arrayBuffer()
	};
}
