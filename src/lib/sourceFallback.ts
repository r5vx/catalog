type Copy = { source?: string; shareKey?: string; burnedIn?: boolean };
export const youtubeCopy = (f: Copy) => f.shareKey?.startsWith('channel:') === true || /^YouTube(?: ·|$)/.test(f.source ?? '');
export const ordinaryCopies = <T extends Copy>(files: T[]) => {
	const other = files.filter(f => !youtubeCopy(f));
	return other.length ? other : files;
};

export const DISCOVERY_WAIT = 12_000;

export function episodeFailure(ep: { season: number; episode: number }, tried: string[], timedOut: boolean, canOpenYouTube: boolean) {
	const slot = `S${ep.season}E${ep.episode}`;
	const reason = timedOut ? `No source answered in time for ${slot}.` : `No playable stream for ${slot}.`;
	const attempts = tried.length ? ` Tried: ${tried.join(', ')}.` : ' No eligible source on this device.';
	const action = canOpenYouTube ? ' Open this episode in YouTube from Sources.' : timedOut ? ' Select the episode to retry.' : '';
	return reason + attempts + action;
}

/** Unverified episode listings are leads, not a reason to wait a full provider timeout. */
export function automaticEpisodeBudget<T extends Copy>(files: T[], confirmed: (f: T) => boolean) {
	const ordinary = files.filter(f => !youtubeCopy(f));
	if (!ordinary.length || !ordinary.every(f => (f.source === 'Movy' || f.source === '7Movies') && !confirmed(f))) return {};
	return { grace: 1_000, ...(files.some(youtubeCopy) ? {} : { limit: DISCOVERY_WAIT }) };
}

type Link = { url: string; debug?: string };
type Options<T> = {
	ask: (f: T) => Promise<Link>; key: (f: T) => string; current: () => boolean;
	onlyPicked?: boolean; late?: Promise<T | null>; grace: number; limit: number; burnedWait: number;
};

/** Explicit menu picks bypass this race. An exact episode probe may join while its first file is loading. */
export async function resolveCopies<T extends Copy>(picked: T, others: T[], opt: Options<T>) {
	const asked = new Map<string, Promise<Link & { file: T }>>();
	const tried = new Set<string>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let done = false, debug: string | undefined;
	const wait = (ms: number) => new Promise<null>(r => { timers.add(setTimeout(() => r(null), ms)); });
	const ask = (file: T) => {
		if (done || !opt.current()) return Promise.reject(new Error('superseded'));
		const id = opt.key(file);
		let link = asked.get(id);
		if (!link) {
			tried.add(file.source || 'Showbox');
			link = opt.ask(file).then(answer => {
				if (!answer.url) { debug = answer.debug ?? debug; throw new Error('no link'); }
				return { ...answer, file };
			});
			asked.set(id, link);
		}
		return link;
	};
	try {
		if (opt.onlyPicked) {
			const selected = await Promise.race([ask(picked).catch(() => null), wait(opt.limit)]);
			return { ...(selected ?? { file: picked, url: '', debug }), tried: [...tried] };
		}
		const all = [picked, ...others];
		const slow = (f: T) => (f.source === 'Nyaa' || f.source === 'AllAnime') && f.source !== picked.source;
		const normal = all.filter(f => !youtubeCopy(f) && !slow(f));
		const last = [...all.filter(f => !youtubeCopy(f) && slow(f)), ...all.filter(youtubeCopy)];
		const first = normal.includes(picked) ? ask(picked) : null;
		const settled = first?.then(() => null, () => null);
		const grace = settled ? Promise.race([settled, wait(opt.grace)]) : Promise.resolve();
		const same = settled ? Promise.race([settled, wait(Math.min(5000, opt.grace))]) : Promise.resolve();
		const attempt = async (f: T) => {
			const found = await ask(f);
			if (f !== picked) {
				await (f.source === picked.source ? same : grace);
				if (f.burnedIn && !picked.burnedIn && !done) await wait(opt.burnedWait);
			}
			return found;
		};
		const listed = Promise.any(normal.map(attempt));
		const group = [listed];
		if (opt.late) group.push(opt.late.then(f => { if (!f) throw new Error('no additional copy'); return attempt(f); }));
		const deadline = Date.now() + opt.limit;
		const primary = Promise.any(group);
		const waiting = [primary.catch(() => null), wait(last.length ? Math.min(opt.limit / 2, opt.grace || 1) : opt.limit)];
		if (opt.late && last.length && youtubeCopy(last[0])) {
			// Once all listed alternatives miss, discovery gets a short head start, not a second full timeout.
			// A usable copy discovered during YouTube startup can still win the race below.
			waiting.push(listed.catch(() => wait(Math.min(350, opt.grace))));
		}
		const firstResult = await Promise.race(waiting);
		if (firstResult) return { ...firstResult, tried: [...tried] };
		const pending = [primary];
		for (const [i, file] of last.entries()) {
			if (!opt.current()) break;
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			const next = ask(file);
			pending.push(next);
			// Reserve time for every remaining fallback. Earlier links can still win.
			const winner = Promise.any(pending).catch(() => null);
			const slice = wait(Math.ceil(remaining / (last.length - i)));
			const result = await Promise.race(i + 1 === last.length ? [winner, slice] : [winner, next.catch(() => null), slice]);
			if (result) return { ...result, tried: [...tried] };
		}
		return { file: picked, url: '', debug, tried: [...tried], timedOut: Date.now() >= deadline };
	} finally {
		done = true;
		for (const timer of timers) clearTimeout(timer);
	}
}
