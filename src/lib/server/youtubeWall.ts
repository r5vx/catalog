import { readSettings, updateSettings } from './settings';
import { searchYouTube } from './youtube';

const SEARCHES = ['official music video', 'movie trailer', 'nature 4k', 'highlights', 'cooking', 'travel'];
const KEEP = 12 * 60 * 60 * 1000;
const RETRY = 15 * 60 * 1000;
type Wall = { at: number; thumbs: string[] };
let kept: Wall | null | undefined;
let asking: Promise<void> | null = null;
let retryAt = 0;

export function cachedYouTubeWall(): string[] {
	if (kept === undefined) {
		kept = null;
		try {
			const saved = JSON.parse(readSettings().youtubeWall ?? 'null');
			if (saved && Number.isFinite(saved.at) && Array.isArray(saved.thumbs)) {
				const thumbs = saved.thumbs.filter((url: unknown): url is string =>
					typeof url === 'string' && /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{6,20}\/mqdefault\.jpg$/.test(url)
				).slice(0, 72);
				if (thumbs.length) kept = { at: saved.at, thumbs };
			}
		} catch {}
	}
	return kept?.thumbs ?? [];
}

function refresh(): Promise<void> {
	if (asking) return asking;
	if (Date.now() < retryAt) return Promise.resolve();
	retryAt = Date.now() + RETRY;
	let ready!: () => void;
	asking = new Promise<void>((resolve) => { ready = resolve; });
	const answers: string[][] = SEARCHES.map(() => []);
	const before = kept?.thumbs.length ?? 0;
	let failed = false;
	const keep = (thumbs: string[]) => {
		kept = { at: Date.now(), thumbs };
		try { updateSettings({ youtubeWall: JSON.stringify(kept) }); } catch {}
	};
	const gathered = () => {
		const seen = new Set<string>();
		for (let row = 0; row < 12; row++) {
			for (const list of answers) {
				if (list[row]) seen.add(`https://i.ytimg.com/vi/${list[row]}/mqdefault.jpg`);
			}
		}
		return [...seen];
	};
	void Promise.all(SEARCHES.map(async (query, index) => {
		try {
			answers[index] = (await searchYouTube(query)).slice(0, 12).map((video) => video.id);
		} catch {}
		// (An unreachable YouTube answers nothing rather than failing.)
		if (!answers[index].length) {
			failed = true;
			return;
		}
		// The saved wall stays until the new one has as many pictures: a refresh that partly
		// fails would otherwise leave a dozen pictures repeating across the wall for 12 hours.
		const thumbs = gathered();
		if (thumbs.length && thumbs.length >= before) {
			keep(thumbs);
			if (thumbs.length >= 28) ready();
		}
	})).finally(() => {
		retryAt = Date.now() + RETRY;
		const thumbs = gathered();
		if (thumbs.length && (!failed || !before) && thumbs.length !== kept?.thumbs.length) keep(thumbs);
		ready();
		asking = null;
	});
	return asking;
}

export async function youtubeWall(): Promise<string[]> {
	const thumbs = cachedYouTubeWall();
	if (kept && Date.now() - kept.at < KEEP) return thumbs;
	const ready = refresh();
	if (thumbs.length) return thumbs;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([ready, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); })]);
	} finally {
		clearTimeout(timer);
	}
	return cachedYouTubeWall();
}
