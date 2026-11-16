/**
 * Debrid services: Real-Debrid, TorBox, AllDebrid and Premiumize (owner, 2026-11-15: another
 * app was criticised on Reddit for having none). Someone with an account pastes its API key in
 * Settings → Services, and every film and episode gets two more copies, "<service> 1080p" and
 * "<service> 4K" (fid -10 and -11), listed first among the other sources (combinedEpisodes.ts
 * `unasked`).
 *
 * Picked, a copy is found like this:
 *   1. The title's IMDb id from TMDB.
 *   2. Torrentio (the torrent finder Stremio's add-on uses) lists the releases for it. Only the
 *      IMDb id is sent there; the debrid key never is.
 *   3. Releases that would play badly are left out, and the rest put in order (`ranked`).
 *      Measured in Catalog's Electron 38 on 2026-11-15 (scratchpad canplay test): MKV and MP4
 *      both play, H.264 and HEVC both play, AAC sound plays, but Dolby (AC3, E-AC3/DDP) and DTS
 *      sound play SILENT. So releases that say they have those are left out, AAC/Opus ones come
 *      first, and ones that don't say come after.
 *   4. The debrid service is asked which of those it already has (cached: ready at once).
 *      TorBox and Premiumize say for many at a time; Real-Debrid and AllDebrid only by adding
 *      the torrent and looking, so those are tried one by one (at most 5) and the ones that
 *      aren't ready are deleted again from the account.
 *   5. The first ready one's file (the episode's, in a season pack) becomes a direct link, which
 *      the player plays as a plain file (it isn't relayed: it's a normal web address).
 *
 * Found links are kept 3 hours, "nothing ready" 30 minutes. The key stays in `settings`, which
 * is never exported. Tests point everything at a pretend server: CATALOG_DEBRID_TEST_BASE and
 * CATALOG_TORRENTIO_BASE (scripts/dev/debridtest.mjs).
 */
import type { FileOption } from '../showbox';
import { readSettings } from '../settings';
import { tmdbGet } from '../metadata/tmdb';

export type DebridService = 'realdebrid' | 'torbox' | 'alldebrid' | 'premiumize';

/** Each service, and where its API key is found. */
export const DEBRID_SERVICES: { id: DebridService; name: string; keyPage: string }[] = [
	{ id: 'realdebrid', name: 'Real-Debrid', keyPage: 'https://real-debrid.com/apitoken' },
	{ id: 'torbox', name: 'TorBox', keyPage: 'https://torbox.app/settings' },
	{ id: 'alldebrid', name: 'AllDebrid', keyPage: 'https://alldebrid.com/apikeys/' },
	{ id: 'premiumize', name: 'Premiumize', keyPage: 'https://www.premiumize.me/account' }
];

const TEST_BASE = process.env.CATALOG_DEBRID_TEST_BASE ?? '';
const BASE: Record<DebridService, string> = {
	realdebrid: TEST_BASE ? `${TEST_BASE}/rd` : 'https://api.real-debrid.com/rest/1.0',
	torbox: TEST_BASE ? `${TEST_BASE}/tb` : 'https://api.torbox.app/v1/api',
	alldebrid: TEST_BASE ? `${TEST_BASE}/ad` : 'https://api.alldebrid.com',
	premiumize: TEST_BASE ? `${TEST_BASE}/pm` : 'https://www.premiumize.me/api'
};
const TORRENTIO = process.env.CATALOG_TORRENTIO_BASE || 'https://torrentio.strem.fun';
/** Only these sites' torrents (Torrentio's English and anime ones), and no cinema recordings. */
const TORRENTIO_OPTIONS =
	'providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex|qualityfilter=480p,scr,cam,unknown';
/** AllDebrid wants every request to say which app it is. */
const AGENT = 'catalog';
const MINUTE = 60 * 1000;

export const serviceName = (id: string) => DEBRID_SERVICES.find((s) => s.id === id)?.name ?? 'Debrid';

/** The service and key saved in Settings → Services, or null when debrid is off. */
export function debridSetting(): { service: DebridService; key: string } | null {
	const s = readSettings();
	const service = DEBRID_SERVICES.find((one) => one.id === s.debridService)?.id;
	return service && s.debridKey ? { service, key: s.debridKey } : null;
}

/* ------------------------------------------------ copies */

type What = { type: 'tv' | 'movie'; id: number; season: number; episode: number };
type Wanted = '1080p' | '2160p';

/** A debrid copy's share key: `debrid:<1080p|2160p>:<tv|movie>:<TMDB id>:<season>:<episode>`. */
export const debridShareKey = (what: What, quality: Wanted) => `debrid:${quality}:${what.type}:${what.id}:${what.season}:${what.episode}`;

export function parseDebridShareKey(shareKey: string): (What & { quality: Wanted }) | null {
	const m = shareKey.match(/^debrid:(1080p|2160p):(tv|movie):(\d+):(\d+):(\d+)$/);
	if (!m) return null;
	return { quality: m[1] as Wanted, type: m[2] as 'tv' | 'movie', id: Number(m[3]), season: Number(m[4]), episode: Number(m[5]) };
}

/** The two debrid copies of a film or episode, or none when debrid is off. */
export function debridCopies(what: What): FileOption[] {
	const on = debridSetting();
	if (!on) return [];
	const name = serviceName(on.service);
	return [
		{ fid: -10, quality: '1080p', name: `${name} 1080p`, size: '', source: name, shareKey: debridShareKey(what, '1080p') },
		{ fid: -11, quality: '2160p', name: `${name} 4K`, size: '', source: name, shareKey: debridShareKey(what, '2160p') }
	];
}

/* ------------------------------------------------ Torrentio's releases */

export type Release = {
	hash: string;
	/** The file in the torrent (its place in Torrentio's list, and its name), for season packs. */
	fileIdx: number | null;
	filename: string;
	/** The release's own name (first line of Torrentio's title). */
	name: string;
	quality: '2160p' | '1080p' | '720p' | '';
	gb: number;
	seeders: number;
	/**
	 * Torrentio flags other languages than English and Japanese (🇮🇳, 🇮🇹…, "Multi Audio"). A plain
	 * file's sound track can't be switched in the player, and a dual-audio file may start in the
	 * other language, so these come last (86 of Interstellar's 315 releases, 2026-11-15).
	 */
	otherLanguages: boolean;
};

type TorrentioStream = { name?: string; title?: string; infoHash?: string; fileIdx?: number; behaviorHints?: { filename?: string } };

/** Torrentio's "Torrentio\n4k HDR" and "...\n👤 272 💾 95.63 GB ⚙️ TorrentGalaxy" as a Release. */
export function releaseFrom(stream: TorrentioStream): Release | null {
	if (!stream.infoHash || !/^[a-f0-9]{40}$/i.test(stream.infoHash)) return null;
	const label = (stream.name ?? '').toLowerCase();
	const title = stream.title ?? '';
	const quality = /4k|2160p/.test(label) ? '2160p' : /1080p/.test(label) ? '1080p' : /720p/.test(label) ? '720p' : '';
	const size = title.match(/([\d.]+)\s*(GB|MB)/i);
	const gb = size ? Number(size[1]) / (size[2].toUpperCase() === 'MB' ? 1024 : 1) : 0;
	const seeders = Number(title.match(/👤\s*(\d+)/u)?.[1] ?? 0);
	const flags = title.match(/\p{Regional_Indicator}{2}/gu) ?? [];
	const otherLanguages = flags.some((flag) => flag !== '🇬🇧' && flag !== '🇯🇵') || /(dual|multi) audio/i.test(title);
	return {
		otherLanguages,
		hash: stream.infoHash.toLowerCase(),
		fileIdx: Number.isInteger(stream.fileIdx) ? (stream.fileIdx as number) : null,
		filename: stream.behaviorHints?.filename ?? '',
		name: title.split('\n')[0].trim(),
		quality,
		gb,
		seeders
	};
}

/** Sound Catalog can't play (it plays silent): Dolby Digital (Plus), TrueHD/Atmos, DTS. */
const SILENT_SOUND = /(^|[^a-z])(ddp?\+?(\s?[257]\.[01])?|dd\+|e-?ac-?3|ac-?3|dts(-?hd)?|truehd|atmos|lpcm|pcm)([^a-z]|$)/i;
/** Sound it plays: AAC, Opus, FLAC, MP3 ("6CH"/"2CH" is how PSA and RMTeam write their AAC). */
const GOOD_SOUND = /(^|[^a-z])(aac(\d\.\d)?|opus|flac|mp3|\d+ch)([^a-z]|$)/i;
/** Dolby Vision without an HDR10 picture underneath shows wrong colors outside a Dolby TV. */
const DV_ONLY = (name: string) => /(^|[^a-z])(dv|dovi|dolby.?vision)([^a-z]|$)/i.test(name) && !/hdr/i.test(name);
const NOT_A_FILM = /(^|[^a-z])(remux|3d|sample|trailer|iso|bdmv|complete\.bluray)([^a-z]|$)/i;
const H264 = /(^|[^a-z])(x\.?264|h\.?264|avc)([^a-z]|$)/i;
const AV1 = /(^|[^a-z])av1([^a-z]|$)/i;
const YTS = /yts|yify/i;

/**
 * The releases worth trying for the quality wanted, best first: never silent sound, never a
 * REMUX or a file too big to stream (a film over 15 GB at 1080p or 40 GB in 4K, an episode over
 * 4 GB or 12 GB), never Dolby Vision only; releases with other languages last; then AAC/Opus
 * first, H.264 before HEVC before AV1, then the most seeders.
 */
export function ranked<T extends Release>(releases: T[], wanted: Wanted, kind: 'tv' | 'movie', unlabelled = false): T[] {
	const most = kind === 'movie' ? (wanted === '2160p' ? 40 : 15) : wanted === '2160p' ? 12 : 4;
	// (`unlabelled`: a Stremio addon's streams that don't say their quality may fill the 1080p copy, last.)
	const fits = (r: Release) =>
		wanted === '2160p' ? r.quality === '2160p' : r.quality === '1080p' || r.quality === '720p' || (unlabelled && r.quality === '');
	const text = (r: Release) => `${r.name} ${r.filename}`;
	const usable = releases.filter((r) => fits(r) && !SILENT_SOUND.test(text(r)) && !NOT_A_FILM.test(text(r)) && !DV_ONLY(text(r)) && (!r.gb || r.gb <= most));
	const score = (r: Release) => {
		const t = text(r);
		return (
			(r.otherLanguages ? -200 : 0) +
			(GOOD_SOUND.test(t) || YTS.test(t) ? 100 : 0) +
			(r.quality === wanted ? 50 : r.quality === '' ? -50 : 0) +
			(H264.test(t) ? 20 : AV1.test(t) ? 0 : 10)
		);
	};
	return usable.sort((a, b) => score(b) - score(a) || b.seeders - a.seeders);
}

async function imdbIdOf(what: What): Promise<string | null> {
	const ids = await tmdbGet<{ imdb_id?: string | null }>(`/${what.type === 'tv' ? 'tv' : 'movie'}/${what.id}/external_ids`);
	return ids?.imdb_id && /^tt\d+$/.test(ids.imdb_id) ? ids.imdb_id : null;
}

/** Torrentio's releases for a film or episode (null: it couldn't be asked). */
export async function torrentioReleases(what: What): Promise<Release[] | null> {
	const imdb = await imdbIdOf(what);
	if (!imdb) return null;
	const path = what.type === 'tv' ? `series/${imdb}:${what.season}:${what.episode}` : `movie/${imdb}`;
	try {
		const response = await fetch(`${TORRENTIO}/${TORRENTIO_OPTIONS}/stream/${path}.json`, {
			headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!response.ok) return null;
		const answer = (await response.json()) as { streams?: TorrentioStream[] };
		return (answer.streams ?? []).map(releaseFrom).filter((r): r is Release => r !== null);
	} catch {
		return null;
	}
}

/* ------------------------------------------------ the services */

const magnet = (hash: string) => `magnet:?xt=urn:btih:${hash}`;
const VIDEO = /\.(mkv|mp4|m4v|webm|avi)$/i;
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The file to play among a torrent's: the one Torrentio named, else its place, else the largest video. */
function pickFileOf<T>(files: T[], release: Release, name: (f: T) => string, size: (f: T) => number, index?: (f: T, i: number) => boolean): T | null {
	const videos = files.filter((f) => VIDEO.test(name(f)));
	if (!videos.length) return null;
	const wantedName = release.filename.toLowerCase();
	const byName = wantedName ? videos.find((f) => baseName(name(f)).toLowerCase() === wantedName) : undefined;
	if (byName) return byName;
	if (release.fileIdx !== null && index) {
		const byPlace = files.find((f, i) => index(f, i));
		if (byPlace && VIDEO.test(name(byPlace))) return byPlace;
	}
	return [...videos].sort((a, b) => size(b) - size(a))[0];
}

class DebridProblem extends Error {}

async function ask<T>(url: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout ?? 15_000) });
	const text = await response.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {}
	if (response.status === 401 || response.status === 403) throw new DebridProblem('The debrid key was refused (check it in Settings → Services, and that the account is paid up)');
	if (!response.ok && response.status !== 202) {
		const said = (body as { error?: string; detail?: string; message?: string } | null) ?? null;
		throw new DebridProblem(said?.error || said?.detail || said?.message || `The debrid service answered ${response.status}`);
	}
	return body as T;
}

const form = (values: Record<string, string>) => new URLSearchParams(values);

/**
 * Each service: is it ready (cached)? and the file's link. `tryOne` adds and looks; `cachedOf`
 * (where the service can say) answers for many hashes at once without adding anything.
 */
type Service = {
	cachedOf?: (hashes: string[]) => Promise<Set<string>>;
	link: (release: Release) => Promise<string | null>;
	check: () => Promise<string>;
};

function realDebrid(key: string): Service {
	const base = BASE.realdebrid;
	const auth = { Authorization: `Bearer ${key}` };
	type Info = { id: string; status: string; files?: { id: number; path: string; bytes: number; selected: number }[]; links?: string[] };
	return {
		async check() {
			const me = await ask<{ username?: string; type?: string; expiration?: string }>(`${base}/user`, { headers: auth });
			if (me?.type !== 'premium') throw new DebridProblem(`${me?.username ?? 'This account'} isn't premium on Real-Debrid`);
			return `${me.username}, premium until ${me.expiration?.slice(0, 10) ?? '?'}`;
		},
		// (No way to ask without adding since late 2024: the torrent is added, and deleted again unless it's ready.)
		async link(release) {
			const added = await ask<{ id: string }>(`${base}/torrents/addMagnet`, { method: 'POST', headers: auth, body: form({ magnet: magnet(release.hash) }) });
			const info = () => ask<Info>(`${base}/torrents/info/${added.id}`, { headers: auth });
			const remove = () => ask(`${base}/torrents/delete/${added.id}`, { method: 'DELETE', headers: auth }).catch(() => null);
			try {
				let now = await info();
				for (let i = 0; i < 4 && now.status === 'magnet_conversion'; i++) {
					await new Promise((r) => setTimeout(r, 700));
					now = await info();
				}
				if (now.status === 'waiting_files_selection') {
					const file = pickFileOf(now.files ?? [], release, (f) => f.path, (f) => f.bytes, (f) => f.id === (release.fileIdx ?? -2) + 1);
					if (!file) {
						await remove();
						return null;
					}
					await ask(`${base}/torrents/selectFiles/${added.id}`, { method: 'POST', headers: auth, body: form({ files: String(file.id) }) });
					now = await info();
				}
				if (now.status !== 'downloaded' || !now.links?.length) {
					await remove();
					return null;
				}
				const open = await ask<{ download?: string }>(`${base}/unrestrict/link`, { method: 'POST', headers: auth, body: form({ link: now.links[0] }) });
				return open.download ?? null;
			} catch (e) {
				await remove();
				throw e;
			}
		}
	};
}

function torBox(key: string): Service {
	const base = BASE.torbox;
	const auth = { Authorization: `Bearer ${key}` };
	type Answer<T> = { success?: boolean; detail?: string; data?: T };
	type TorrentFile = { id: number; name: string; short_name?: string; size: number };
	return {
		async check() {
			const me = await ask<Answer<{ email?: string; plan?: number; premium_expires_at?: string }>>(`${base}/user/me`, { headers: auth });
			const plan = me.data?.plan ?? 0;
			return `${me.data?.email ?? 'Signed in'}, ${plan > 0 ? `paid plan until ${me.data?.premium_expires_at?.slice(0, 10) ?? '?'}` : 'free plan'}`;
		},
		async cachedOf(hashes) {
			const answer = await ask<Answer<{ hash: string }[] | Record<string, unknown> | null>>(`${base}/torrents/checkcached?format=list&list_files=false&hash=${hashes.join(',')}`, { headers: auth });
			const data = answer.data;
			const list = Array.isArray(data) ? data.map((d) => d.hash) : data ? Object.keys(data) : [];
			return new Set(list.map((h) => h.toLowerCase()));
		},
		async link(release) {
			const made = await ask<Answer<{ torrent_id: number }>>(`${base}/torrents/createtorrent`, { method: 'POST', headers: auth, body: form({ magnet: magnet(release.hash), allow_zip: 'false' }) });
			const id = made.data?.torrent_id;
			if (!id) return null;
			const listed = await ask<Answer<{ files?: TorrentFile[]; download_present?: boolean }>>(`${base}/torrents/mylist?id=${id}&bypass_cache=true`, { headers: auth });
			const files = listed.data?.files ?? [];
			const file = pickFileOf(files, release, (f) => f.short_name || f.name, (f) => f.size, (f, i) => i === release.fileIdx);
			if (!file) return null;
			const link = await ask<Answer<string>>(`${base}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${id}&file_id=${file.id}&zip_link=false`, { headers: auth });
			return typeof link.data === 'string' ? link.data : null;
		}
	};
}

function allDebrid(key: string): Service {
	const base = BASE.alldebrid;
	const auth = { Authorization: `Bearer ${key}` };
	type Answer<T> = { status?: string; data?: T; error?: { code?: string; message?: string } };
	type Node = { n: string; s?: number; l?: string; e?: Node[] };
	const flat = (nodes: Node[], into: Node[] = []): Node[] => {
		for (const node of nodes) node.e ? flat(node.e, into) : into.push(node);
		return into;
	};
	const sure = <T>(answer: Answer<T>): T => {
		if (answer.status !== 'success' || !answer.data) {
			const code = answer.error?.code ?? '';
			throw new DebridProblem(/AUTH|APIKEY/i.test(code) ? 'The debrid key was refused (check it in Settings → Services)' : answer.error?.message || 'AllDebrid said no');
		}
		return answer.data;
	};
	return {
		async check() {
			const me = sure(await ask<Answer<{ user?: { username?: string; isPremium?: boolean; premiumUntil?: number } }>>(`${base}/v4/user?agent=${AGENT}`, { headers: auth }));
			if (!me.user?.isPremium) throw new DebridProblem(`${me.user?.username ?? 'This account'} isn't premium on AllDebrid`);
			return `${me.user.username}, premium until ${me.user.premiumUntil ? new Date(me.user.premiumUntil * 1000).toISOString().slice(0, 10) : '?'}`;
		},
		async link(release) {
			const up = sure(await ask<Answer<{ magnets: { id: number; ready?: boolean; error?: unknown }[] }>>(`${base}/v4/magnet/upload?agent=${AGENT}`, { method: 'POST', headers: auth, body: form({ 'magnets[]': magnet(release.hash) }) }));
			const added = up.magnets?.[0];
			if (!added?.id) return null;
			const remove = () => ask(`${base}/v4/magnet/delete?agent=${AGENT}&id=${added.id}`, { headers: auth }).catch(() => null);
			if (!added.ready) {
				await remove();
				return null;
			}
			const listed = sure(await ask<Answer<{ magnets: { id: number; files?: Node[] }[] }>>(`${base}/v4/magnet/files?agent=${AGENT}&id[]=${added.id}`, { headers: auth }));
			const files = flat(listed.magnets?.[0]?.files ?? []).filter((f) => f.l);
			const file = pickFileOf(files, release, (f) => f.n, (f) => f.s ?? 0);
			if (!file?.l) return null;
			const open = sure(await ask<Answer<{ link?: string }>>(`${base}/v4/link/unlock?agent=${AGENT}&link=${encodeURIComponent(file.l)}`, { headers: auth }));
			return open.link ?? null;
		}
	};
}

function premiumize(key: string): Service {
	const base = BASE.premiumize;
	const withKey = (path: string) => `${base}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`;
	type Answer = { status?: string; message?: string };
	const sure = <T extends Answer>(answer: T): T => {
		if (answer.status !== 'success') throw new DebridProblem(/key|auth/i.test(answer.message ?? '') ? 'The debrid key was refused (check it in Settings → Services)' : answer.message || 'Premiumize said no');
		return answer;
	};
	return {
		async check() {
			const me = sure(await ask<Answer & { customer_id?: string | number; premium_until?: number | false }>(withKey('/account/info')));
			if (!me.premium_until) throw new DebridProblem("This account isn't premium on Premiumize");
			return `Account ${me.customer_id}, premium until ${new Date(me.premium_until * 1000).toISOString().slice(0, 10)}`;
		},
		async cachedOf(hashes) {
			const answer = sure(await ask<Answer & { response?: boolean[] }>(withKey(`/cache/check?${hashes.map((h) => `items[]=${h}`).join('&')}`)));
			return new Set(hashes.filter((_, i) => answer.response?.[i]));
		},
		async link(release) {
			const answer = sure(
				await ask<Answer & { content?: { path: string; size: number; link?: string; stream_link?: string; transcode_status?: string }[] }>(withKey('/transfer/directdl'), {
					method: 'POST',
					body: form({ src: magnet(release.hash) })
				})
			);
			const file = pickFileOf(answer.content ?? [], release, (f) => f.path, (f) => f.size);
			// (Premiumize's own browser-ready copy when it has made one: its sound is always AAC.)
			return (file?.transcode_status === 'finished' && file.stream_link) || file?.link || null;
		}
	};
}

function serviceFor(service: DebridService, key: string): Service {
	if (service === 'realdebrid') return realDebrid(key);
	if (service === 'torbox') return torBox(key);
	if (service === 'alldebrid') return allDebrid(key);
	return premiumize(key);
}

/** Settings → Services' Check: who the key belongs to, or why it can't be used. */
export async function checkDebridKey(service: DebridService, key: string): Promise<{ ok: boolean; message: string }> {
	try {
		return { ok: true, message: await serviceFor(service, key).check() };
	} catch (e) {
		return { ok: false, message: e instanceof DebridProblem ? e.message : `${serviceName(service)} couldn't be reached` };
	}
}

/* ------------------------------------------------ a copy's link */

const known = new Map<string, { at: number; url: string | null; why: string; name: string }>();
const asking = new Map<string, Promise<DebridAnswer>>();
export type DebridAnswer = { url: string | null; why: string; name: string };

/** How many releases are tried one by one where the service can't say for many at once. */
const TRY_MOST = 5;

/**
 * The direct link for a debrid copy (`why` says what went wrong when there's none; `name` is
 * the release played). Kept 3 hours when found, 30 minutes when nothing was ready.
 */
export function debridStream(shareKey: string, fresh = false): Promise<DebridAnswer> {
	const what = parseDebridShareKey(shareKey);
	const on = debridSetting();
	if (!what || !on) return Promise.resolve({ url: null, why: 'Debrid is off (Settings → Services)', name: '' });
	const cacheKey = `${on.service}|${shareKey}`;
	const kept = known.get(cacheKey);
	if (kept && !fresh && Date.now() - kept.at < (kept.url ? 180 : 30) * MINUTE) return Promise.resolve(kept);
	const under = asking.get(cacheKey);
	if (under) return under;
	const result = find(what, on.service, on.key)
		.then((answer) => {
			// (Not kept when the service couldn't be asked: the next try asks again.)
			if (answer.url || answer.why.startsWith('No ')) known.set(cacheKey, { ...answer, at: Date.now() });
			return answer;
		})
		.finally(() => asking.delete(cacheKey));
	asking.set(cacheKey, result);
	return result;
}

async function find(what: What & { quality: Wanted }, service: DebridService, key: string): Promise<DebridAnswer> {
	const releases = await torrentioReleases(what);
	if (releases === null) return { url: null, why: "Torrentio couldn't be asked (or TMDB has no IMDb id for this)", name: '' };
	const list = ranked(releases, what.quality, what.type);
	if (!list.length) return { url: null, why: `No ${what.quality === '2160p' ? '4K' : '1080p'} release with sound Catalog can play`, name: '' };
	return readyLink(list, service, key);
}

/**
 * The first of these releases (best first) the debrid service has ready, as a direct link. Also
 * used for a Stremio addon's torrents (addons.ts).
 */
export async function readyLink(list: Release[], service: DebridService, key: string): Promise<DebridAnswer> {
	const name = serviceName(service);
	const debrid = serviceFor(service, key);
	try {
		let tryList = list.slice(0, TRY_MOST);
		if (debrid.cachedOf) {
			const ready = await debrid.cachedOf(list.slice(0, 40).map((r) => r.hash));
			tryList = list.filter((r) => ready.has(r.hash)).slice(0, TRY_MOST);
			if (!tryList.length) return { url: null, why: `No release is ready on ${name} right now`, name: '' };
		}
		for (const release of tryList) {
			const url = await debrid.link(release).catch((e) => {
				if (e instanceof DebridProblem && /refused/.test(e.message)) throw e;
				return null;
			});
			if (url) return { url, why: '', name: release.filename || release.name };
		}
		return { url: null, why: `No release is ready on ${name} right now`, name: '' };
	} catch (e) {
		return { url: null, why: e instanceof DebridProblem ? e.message : `${name} couldn't be reached`, name: '' };
	}
}
