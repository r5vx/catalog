/**
 * AllAnime (api.allanime.day): anime by its own show IDs, searched by name. Japanese audio
 * with English subtitles and English dubs, up to 1080p.
 *
 * The API (api.allanime.day/api, GraphQL) returns NEED_CAPTCHA for episode-source queries.
 * The desktop app then shows AllAnime's Turnstile check in a small window
 * (electron/turnstileSolver.cjs) for the person at the computer to tick, and the token it
 * gives is passed in the retry request as extensions.captcha = { token, provider: "turnstile" }.
 * A token counts once, so each ask that needs one gets its own.
 *
 * Searches and show details work without a token and never open the check.
 *
 * The video servers only answer their own player (various embedded domains), so the video
 * comes through Catalog's relay.
 *
 * Desktop app only (the check needs its window). Every stage is written to
 * %TEMP%\catalog-turnstile.log, next to the window's own lines.
 */
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { electronSolveTurnstile } from '../electron-fetch';
import { trustVideoHost } from '../relayHosts';
import { noteSourceAnswer } from '../sourceAnswers';
import type { FileOption } from '../showbox';

const API = 'https://api.allanime.day/api';
const SITE = 'https://allmanga.to';
const FALLBACK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export interface AllanimeShow {
	id: string;
	name: string;
	type: string;
	sub: number;
	dub: number;
	start: string | null;
}

export type AllanimeKind = 'sub' | 'dub';

export function allanimeShareKey(showId: string, episode: number, kind: AllanimeKind): string {
	return `allanime:${showId}:${episode}:${kind}`;
}

export function parseAllanimeShareKey(shareKey: string): { showId: string; episode: number; kind: AllanimeKind } | null {
	const m = /^allanime:([A-Za-z0-9]+):(\d+):(sub|dub)$/.exec(shareKey);
	return m ? { showId: m[1], episode: Number(m[2]), kind: m[3] as AllanimeKind } : null;
}

function saved<T>(key: string, maxAge: number): T | undefined {
	const hit = getOrderCache(key);
	return hit && Date.now() - hit.at < maxAge ? (hit.value as T) : undefined;
}

/* ------------------------------------------------ log */

const LOG = join(tmpdir(), 'catalog-turnstile.log');

function log(msg: string): void {
	try {
		appendFileSync(LOG, `${new Date().toISOString()} [allanime] ${msg}\n`);
	} catch {
		/* the log is only a help */
	}
}

/* ------------------------------------------------ API */

/**
 * Why an ask has no answer: `check` = answered NEED_CAPTCHA, `not-done` = the check wasn't
 * finished on the computer, `turned-down` = the person ticked it and Cloudflare said no,
 * `refused` = still NEED_CAPTCHA with a token, `unreachable` = no usable answer at all.
 */
type Problem = '' | 'check' | 'not-done' | 'turned-down' | 'refused' | 'unreachable';

interface Answer<T> {
	data: T | null;
	problem: Problem;
	streamUrl?: string;
}

interface Captcha {
	token: string;
	provider: string;
}

/** Cookies the API sets, sent back like its own page would, so a passed check that it remembers counts. */
const cookies = new Map<string, string>();

async function ask<T>(query: string, variables: Record<string, unknown>, captcha?: Captcha): Promise<Answer<T>> {
	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': FALLBACK_UA,
			Origin: SITE,
			Referer: `${SITE}/`
		};
		if (cookies.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
		const payload: Record<string, unknown> = { query, variables };
		if (captcha) payload.extensions = { captcha };

		const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000) });
		for (const line of resp.headers.getSetCookie()) {
			const pair = /^([^=;\s]+)=([^;]*)/.exec(line);
			if (!pair) continue;
			if (!cookies.has(pair[1])) log(`the API set a cookie: ${pair[1]}`);
			cookies.set(pair[1], pair[2]);
		}
		if (!resp.ok) {
			const body = (await resp.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
			log(`HTTP ${resp.status}${captcha ? ' (token sent)' : ''}: ${body}`);
			return { data: null, problem: 'unreachable' };
		}

		const json = (await resp.json()) as { data?: T; errors?: { message: string }[] };
		const errors = (json.errors ?? []).map((e) => e.message);
		if (errors.includes('NEED_CAPTCHA') || errors.includes('AA_CRYPTO_MISSING')) {
			if (errors.includes('AA_CRYPTO_MISSING')) log('the API returned AA_CRYPTO_MISSING; opening AllManga episode page for human check');
			return { data: null, problem: 'check' };
		}
		if (errors.length) log(`the API answered with errors${captcha ? ' (token sent)' : ''}: ${errors.join('; ').slice(0, 300)}`);
		return json.data ? { data: json.data, problem: '' } : { data: null, problem: 'unreachable' };
	} catch (error) {
		log(`ask failed${captcha ? ' (token sent)' : ''}: ${error instanceof Error ? error.message : String(error)}`);
		return { data: null, problem: 'unreachable' };
	}
}

/** Searches and show details: never open the check. */
async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	const answer = await ask<T>(query, variables);
	if (answer.problem === 'check') log('a search or show ask was answered NEED_CAPTCHA; the check is only opened for an episode');
	return answer.data;
}

/* ------------------------------------------------ the check */

/** How long the person has to tick the box. */
const CHECK_WAIT = 2 * MINUTE;

let turn: Promise<unknown> = Promise.resolve();
let lastPassed = 0;

const since = (at: number) => `${Math.round((Date.now() - at) / 1000)} s`;

/**
 * An ask that may need the check. One window at a time, and one token per ask: asks that
 * arrive together wait their turn rather than share a token, which counts only once.
 */
async function askWithCheck<T>(
	what: string,
	query: string,
	variables: Record<string, unknown>,
	episodeUrl?: string
): Promise<Answer<T>> {
	const asked = Date.now();
	const first = await ask<T>(query, variables);
	if (first.problem !== 'check') {
		if (lastPassed && !first.problem) log(`${what}: answered without a token, ${since(lastPassed)} after the last passed check`);
		return first;
	}
	log(`${what}: check required${lastPassed ? `, ${since(lastPassed)} after the last passed check` : ''}`);

	const mine = turn.then(async (): Promise<Answer<T>> => {
		// A check passed while this ask waited its turn: see whether it still counts before asking the person again.
		if (lastPassed > asked) {
			const again = await ask<T>(query, variables);
			if (again.problem !== 'check') {
				log(`${what}: answered without its own token after another ask's check passed`);
				return again;
			}
			log(`${what}: check required again right after another ask's check passed`);
		}
		const result = await electronSolveTurnstile(episodeUrl || API, CHECK_WAIT);
		if (result.solved && result.episodeData) {
			lastPassed = Date.now();
			log(`${what}: episode sourceUrls captured directly from MKissa API`);
			return { data: result.episodeData as T, problem: '' };
		}
		if (result.solved && result.streamUrl) {
			lastPassed = Date.now();
			return { data: null, problem: '', streamUrl: result.streamUrl };
		}
		if (!result.solved || !result.token) {
			log(`${what}: the check was not finished (${result.error || 'no token'})`);
			return { data: null, problem: result.error?.startsWith('turned down') ? 'turned-down' : 'not-done' };
		}
		const checked = await ask<T>(query, variables, { token: result.token, provider: result.provider });
		if (checked.problem === 'check') {
			log(`${what}: token sent, answered NEED_CAPTCHA again: the token was refused`);
			return { data: null, problem: 'refused' };
		}
		if (!checked.problem) {
			lastPassed = Date.now();
			log(`${what}: token sent and accepted`);
		}
		return checked;
	});
	turn = mine.catch(() => null);
	return mine;
}

/* ------------------------------------------------ search */

const SEARCH_QUERY = `query($search:SearchInput,$limit:Int,$page:Int,$translationType:VaildTranslationTypeEnumType!,$countryOrigin:VaildCountryOriginEnumType){shows(search:$search,limit:$limit,page:$page,translationType:$translationType,countryOrigin:$countryOrigin){edges{_id name availableEpisodes __typename}}}`;

export async function searchAllanime(query: string): Promise<AllanimeShow[]> {
	const key = `allanime-search|${query.toLowerCase()}`;
	const known = saved<AllanimeShow[]>(key, 24 * HOUR);
	if (known) return known;

	type Edge = { _id: string; name: string; availableEpisodes: { sub: number; dub: number } };
	const data = await graphql<{ shows: { edges: Edge[] } }>(SEARCH_QUERY, {
		search: { allowAdult: false, allowUnknown: false, query: query.replace(/ /g, '+') },
		limit: 40,
		page: 1,
		translationType: 'sub',
		countryOrigin: 'ALL'
	});
	if (!data) return [];
	const shows = data.shows.edges.map((e) => ({
		id: e._id,
		name: e.name,
		type: 'TV',
		sub: e.availableEpisodes.sub,
		dub: e.availableEpisodes.dub,
		start: null as string | null
	}));
	saveOrderCache(key, shows, Date.now());
	return shows;
}

/* ------------------------------------------------ show details */

const SHOW_QUERY = `query($showId:String!){show(_id:$showId){_id name availableEpisodesDetail airedStart type}}`;

export async function allanimeShowDetails(showId: string): Promise<{ sub: number; dub: number; start: string | null; type: string } | null> {
	const key = `allanime-show|${showId}`;
	const known = saved<{ sub: number; dub: number; start: string | null; type: string }>(key, 12 * HOUR);
	if (known) return known;

	type Detail = { sub: string[]; dub: string[] };
	type Start = { year: number; month: number; date: number } | null;
	const data = await graphql<{ show: { availableEpisodesDetail: Detail; airedStart: Start; type: string } }>(SHOW_QUERY, { showId });
	if (!data?.show) return null;
	const { availableEpisodesDetail: eps, airedStart, type } = data.show;
	const sub = eps.sub?.length ?? 0;
	const dub = eps.dub?.length ?? 0;
	let start: string | null = null;
	if (airedStart?.year) {
		const y = String(airedStart.year);
		const m = String(airedStart.month ?? 1).padStart(2, '0');
		const d = String(airedStart.date ?? 1).padStart(2, '0');
		start = `${y}-${m}-${d}`;
	}
	const result = { sub, dub, start, type: type || 'TV' };
	saveOrderCache(key, result, Date.now());
	return result;
}

/* ------------------------------------------------ episode sources */

const EPISODE_QUERY = `query($showId:String!,$translationType:VaildTranslationTypeEnumType!,$episodeString:String!){episode(showId:$showId,translationType:$translationType,episodeString:$episodeString){episodeString sourceUrls}}`;

interface SourceUrl {
	sourceUrl: string;
	sourceName: string;
	type: string;
	className: string;
	streamerId: string;
}

function decryptSourceUrl(enc: string): string {
	if (!enc.startsWith('--')) return enc;
	const hex = enc.slice(2);
	let out = '';
	for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16) >> 3 ^ 56);
	return out;
}

async function resolveClockUrl(clockUrl: string): Promise<string | null> {
	try {
		const resp = await fetch(clockUrl, {
			headers: { 'User-Agent': FALLBACK_UA, Referer: `${SITE}/` },
			signal: AbortSignal.timeout(10_000)
		});
		if (!resp.ok) {
			log(`video link ask: HTTP ${resp.status} from ${clockUrl.slice(0, 120)}`);
			return null;
		}
		const json = await resp.json() as { links?: { link: string; hls?: boolean; mp4?: boolean; resolutionStr?: string }[] };
		if (!json.links?.length) {
			log(`video link ask: no links from ${clockUrl.slice(0, 120)}`);
			return null;
		}
		const hls = json.links.find((l) => l.hls) ?? json.links.find((l) => /\.m3u8/i.test(l.link)) ?? json.links[0];
		return hls?.link || null;
	} catch (error) {
		log(`video link ask failed for ${clockUrl.slice(0, 120)}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

async function resolveSources(sources: SourceUrl[]): Promise<string | null> {
	log(`${sources.length} servers listed: ${sources.map((s) => `${s.sourceName} [${decryptSourceUrl(s.sourceUrl).slice(0, 60)}]`).join(', ').slice(0, 900)}`);
	for (const src of sources) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/allanime|clock|apivtwo/i.test(decoded)) {
			const full = decoded.startsWith('http')
				? decoded
				: decoded.startsWith('/')
					? `https://allanime.day${decoded}`
					: `https://${decoded}`;
			const url = await resolveClockUrl(full);
			if (url) return url;
		}
	}
	for (const src of sources) {
		const decoded = decryptSourceUrl(src.sourceUrl);
		if (/\.(m3u8|mp4)(\?|$)/i.test(decoded)) return decoded.startsWith('http') ? decoded : `https://${decoded}`;
	}
	return null;
}

/* ------------------------------------------------ stream */

/** What AllAnime's video servers expect to be asked with (no Origin header so direct MP4 CDNs accept GET/Range). */
export const ALLANIME_HEADERS = { 'User-Agent': FALLBACK_UA, Referer: 'https://mkissa.to/' };

/** The video's playlist, or why there is none (`why` is said in the player). */
export interface AllanimeFound {
	url: string;
	why: string;
}

const WHY: Record<Exclude<Problem, '' | 'check'>, string> = {
	'not-done': "AllAnime's check wasn't ticked on the computer running Catalog",
	'turned-down': 'Cloudflare turned down the check on the computer running Catalog',
	refused: "AllAnime didn't accept the check; try again",
	unreachable: "AllAnime isn't answering right now"
};

/** A found video is kept 30 minutes, a real "nothing" 6 hours, an unfinished or refused check 2 minutes. */
const urlCache = new Map<string, { until: number; found: AllanimeFound }>();
const asking = new Map<string, Promise<AllanimeFound>>();

export function allanimeStream(shareKey: string, fresh = false): Promise<AllanimeFound> {
	const parsed = parseAllanimeShareKey(shareKey);
	if (!parsed) return Promise.resolve({ url: '', why: '' });
	const kept = urlCache.get(shareKey);
	if (kept && !fresh && Date.now() < kept.until) return Promise.resolve(kept.found);
	const under = asking.get(shareKey);
	if (under) return under;
	const keep = (found: AllanimeFound, time: number): AllanimeFound => {
		if (time) urlCache.set(shareKey, { until: Date.now() + time, found });
		else urlCache.delete(shareKey);
		return found;
	};
	const result = (async (): Promise<AllanimeFound> => {
		type EpData = { episode: { sourceUrls: SourceUrl[] } | null };
		const what = `${parsed.showId} episode ${parsed.episode} ${parsed.kind}`;
		const { data, problem, streamUrl } = await askWithCheck<EpData>(
			what,
			EPISODE_QUERY,
			{
				showId: parsed.showId,
				translationType: parsed.kind,
				episodeString: String(parsed.episode)
			},
			`https://mkissa.to/anime/${parsed.showId}/p-${parsed.episode}-${parsed.kind}`
		);
		if (streamUrl) {
			log(`${what}: video captured from AllManga page on ${streamUrl.replace(/^(https?:\/\/[^/]+).*/, '$1')}`);
			trustVideoHost(streamUrl, 'allanime');
			return keep({ url: streamUrl, why: '' }, 30 * MINUTE);
		}
		if (problem === 'not-done' || problem === 'turned-down' || problem === 'refused') return keep({ url: '', why: WHY[problem] }, 2 * MINUTE);
		if (problem) return keep({ url: '', why: WHY.unreachable }, 0);
		const sources = data?.episode?.sourceUrls ?? [];
		if (sources.length) {
			const url = await resolveSources(sources);
			if (url) {
				log(`${what}: video found on ${url.replace(/^(https?:\/\/[^/]+).*/, '$1')}`);
				trustVideoHost(url, 'allanime');
				return keep({ url, why: '' }, 30 * MINUTE);
			}
			log(`${what}: ${sources.length} servers listed, none gave a video link`);
		} else {
			log(`${what}: answered, with no servers listed (${data?.episode ? 'an empty episode' : 'no episode'})`);
		}
		noteSourceAnswer('AllAnime', { type: 'tv', id: 0, season: 0, episode: 0 }, false);
		return keep({ url: '', why: 'AllAnime has nothing for this right now' }, 6 * 60 * MINUTE);
	})().finally(() => asking.delete(shareKey));
	asking.set(shareKey, result);
	return result;
}

/* ------------------------------------------------ copies */

export function allanimeCopies(showId: string, episode: number, has: { sub: boolean; dub: boolean }): FileOption[] {
	const list: FileOption[] = [];
	if (has.sub) {
		list.push({
			fid: -20,
			quality: '1080p',
			name: 'AllAnime · Japanese audio',
			size: '',
			source: 'AllAnime',
			audio: 'Japanese',
			burnedIn: true,
			shareKey: allanimeShareKey(showId, episode, 'sub')
		});
	}
	if (has.dub) {
		list.push({
			fid: -21,
			quality: '1080p',
			name: 'AllAnime · English dub',
			size: '',
			source: 'AllAnime',
			audio: 'English',
			shareKey: allanimeShareKey(showId, episode, 'dub')
		});
	}
	return list;
}
