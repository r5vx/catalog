/**
 * YouTube on phones: YouTube's own mobile website (m.youtube.com), whole — home feed,
 * subscriptions, comments, Shorts, library, the account — served to the phone through Catalog's
 * computer, with Catalog's no-ads script in it (android/assets/youtube-tv.js, the one the computer's
 * YouTube window and the Fire TV use).
 *
 * A phone can't put a script into youtube.com itself, so this is a second small web server beside
 * Catalog's (Catalog's port + 1, 4174 for the desktop app): it asks YouTube for each page as the
 * phone would (the phone's own browser name, so YouTube sends the phone layout), puts the scripts at
 * the top of each page, and passes everything else through. The page's requests to googlevideo.com
 * (the video) and YouTube's other hosts come back here as /__h/<host>/… (youtubePhonePage.js), so
 * the computer fetches them. The video has to come through the computer anyway: YouTube ties each
 * video address to the internet address that asked for it.
 *
 * Each person's own account: the phone's Catalog profile (its catalog_profile cookie, which comes
 * along here too) picks whose. The owner's is the computer's YouTube window's (`persist:youtube`);
 * everyone else signs in for their phone on Catalog's YouTube page on the computer, into a storage
 * of their own (electron/youtubeSignIn.cjs). main.cjs hands over each one's cookies and every
 * change to them. They stay here; the phone never holds them. Google's sign-in can't happen
 * through another address, so Sign in / Sign out on a phone say to do that on the computer, and
 * YouTube's cookie renewal is left to the computer (two places renewing one sign-in could end it).
 *
 * Proven off screen (2026-11-07, headless Edge as an iPhone, guest): home, search, a video with
 * comments, no ad, playing 1.5 s after the tap, also from the plain http address a phone uses.
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';
import { listProfiles, profileExists } from './db/queries';
import { pinIsSet, sessionToken } from './settings';
import pageScript from './youtubePhonePage.js?raw';
import adsScript from '../../../android/assets/youtube-tv.js?raw';

const YOUTUBE = 'm.youtube.com';
/** Hosts the phone's page may reach through here (and no others: this is not an open door). */
const THROUGH = /(^|\.)(googlevideo\.com|youtube\.com|youtube-nocookie\.com|googleapis\.com|google\.com|doubleclick\.net|gstatic\.com)$/;
/** Catalog's own cookies, which the phone also sends here (same computer name): never passed on. */
const OURS = /^(catalog_|SAPISID$)/;
/** Secure address port for this (Tailscale serve: `--https=8443`). */
export const SECURE_PORT = 8443;

const catalogPort = () => Number(process.env.PORT) || 4173;
/** This server's port, or 0 when it isn't run (the dev server without CATALOG_YT_PORT). */
export function youtubePhonePort(): number {
	if (process.env.CATALOG_YT_PORT) return Number(process.env.CATALOG_YT_PORT);
	return process.env.PORT ? Number(process.env.PORT) + 1 : 0;
}

/**
 * Where a phone opens YouTube, from the address it reached Catalog at (the request's own Host:
 * SvelteKit's url can be a fixed ORIGIN instead).
 */
export function youtubePhoneLink(request: Request, url: URL): string | null {
	const port = youtubePhonePort();
	if (!port) return null;
	const host = request.headers.get('host') ?? url.host;
	const name = host.replace(/:\d+$/, '');
	const secure = request.headers.get('x-forwarded-proto') === 'https' || url.protocol === 'https:' || /\.ts\.net$/.test(name);
	if (secure) return `https://${name}:${SECURE_PORT}/`;
	return `http://${name}:${port}/`;
}

/* ------------------------------------------------------------------ cookies */

type Group = 'youtube' | 'google';
const groupOf = (host: string): Group | null =>
	/(^|\.)youtube\.com$/.test(host) ? 'youtube' : /(^|\.)google\.com$/.test(host) ? 'google' : null;

type Jars = {
	/** From the person's YouTube storage on the computer (main.cjs), as they are there. */
	fromComputer: Record<Group, Map<string, string>>;
	/** Set by YouTube's answers to their phone (a guest's visitor cookies, preferences). */
	fromAnswers: Record<Group, Map<string, string>>;
};
const people = new Map<number, Jars>();
function person(profile: number): Jars {
	let jars = people.get(profile);
	if (!jars) {
		jars = { fromComputer: { youtube: new Map(), google: new Map() }, fromAnswers: { youtube: new Map(), google: new Map() } };
		people.set(profile, jars);
	}
	return jars;
}
const KEPT = join(dataDir, 'youtube-phone.json');

try {
	if (existsSync(KEPT)) {
		const kept = JSON.parse(readFileSync(KEPT, 'utf8'));
		// (Before profiles had their own: one set, the owner's.)
		const byProfile: Record<string, Record<Group, Record<string, string>>> = kept.profiles ?? { 0: kept };
		for (const [profile, groups] of Object.entries(byProfile)) {
			for (const group of ['youtube', 'google'] as const) {
				for (const [k, v] of Object.entries(groups?.[group] ?? {})) person(Number(profile)).fromAnswers[group].set(k, String(v));
			}
		}
	}
} catch {}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function keepSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			const profiles: Record<string, Record<Group, Record<string, string>>> = {};
			for (const [profile, jars] of people) {
				profiles[profile] = { youtube: Object.fromEntries(jars.fromAnswers.youtube), google: Object.fromEntries(jars.fromAnswers.google) };
			}
			writeFileSync(KEPT, JSON.stringify({ profiles }));
		} catch {}
	}, 5000);
	saveTimer.unref?.();
}

const jar = (profile: number, group: Group) => new Map([...person(profile).fromAnswers[group], ...person(profile).fromComputer[group]]);
const signedIn = (profile: number) => person(profile).fromComputer.youtube.has('SID') || person(profile).fromComputer.youtube.has('__Secure-3PSID');

/** A sign-in or sign-out going on for someone, and how the last one ended. */
const busy = new Map<number, 'signin' | 'signout'>();
const lastResult = new Map<number, string>();

/** Whose phones are signed in to YouTube (Catalog's YouTube page on the computer). */
export const youtubePhoneAccounts = () =>
	listProfiles().map((p) => ({ id: p.id, name: p.name, signedIn: signedIn(p.id), busy: busy.get(p.id) ?? null, last: lastResult.get(p.id) ?? null }));

/** Signs someone in (Google's page opens in the computer's own Edge) or out, for their phones. */
export function youtubePhoneAccount(profile: number, action: 'signin' | 'signout') {
	if (busy.has(profile) || typeof process.send !== 'function') return;
	busy.set(profile, action);
	lastResult.delete(profile);
	process.send({ type: action === 'signin' ? 'youtube-signin' : 'youtube-signout', profile });
}

/** The profile a phone's request is for (its Catalog cookie), the owner's when it has none. */
function profileOf(req: http.IncomingMessage): number {
	const value = String(req.headers.cookie ?? '').match(/(?:^|;\s*)catalog_profile=(\d+)/)?.[1];
	const id = value === undefined ? 0 : Number(value);
	return Number.isInteger(id) && profileExists(id) ? id : 0;
}

function takeComputerCookies(profile: number, list: { name: string; value: string; domain?: string }[]) {
	const { fromComputer, fromAnswers } = person(profile);
	fromComputer.youtube.clear();
	fromComputer.google.clear();
	for (const c of list) {
		const group = groupOf(String(c.domain ?? '').replace(/^\./, ''));
		if (!group) continue;
		fromComputer[group].set(c.name, c.value);
		fromAnswers[group].delete(c.name);
	}
	keepSoon();
}

function noteSetCookies(profile: number, host: string, setCookies: string[]) {
	const { fromComputer, fromAnswers } = person(profile);
	for (const line of setCookies) {
		const [pair, ...attrs] = line.split(';');
		const at = pair.indexOf('=');
		if (at <= 0) continue;
		const name = pair.slice(0, at).trim();
		const value = pair.slice(at + 1).trim();
		const domain = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a))?.slice(7).replace(/^\./, '') ?? host;
		const group = groupOf(domain);
		if (!group) continue;
		// The computer's sign-in is the computer's to change.
		if (fromComputer[group].has(name)) continue;
		const gone = attrs.some((a) => /^\s*max-age=0/i.test(a)) ||
			attrs.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) < Date.now());
		if (gone) fromAnswers[group].delete(name);
		else fromAnswers[group].set(name, value);
	}
	keepSoon();
}

/** What a signed-in YouTube page sends with its API requests, worked out here (the page's own
 * would be for Catalog's address, and it never sees the real cookie). */
function authorization(cookies: Map<string, string>): string | null {
	const sapisid = cookies.get('SAPISID') ?? cookies.get('__Secure-3PAPISID');
	if (!sapisid) return null;
	const time = Math.floor(Date.now() / 1000);
	const hash = (value: string) =>
		`${time}_${createHash('sha1').update(`${time} ${value} https://${YOUTUBE}`).digest('hex')}`;
	const parts = [`SAPISIDHASH ${hash(sapisid)}`];
	const first = cookies.get('__Secure-1PAPISID');
	const third = cookies.get('__Secure-3PAPISID');
	if (first) parts.push(`SAPISID1PHASH ${hash(first)}`);
	if (third) parts.push(`SAPISID3PHASH ${hash(third)}`);
	return parts.join(' ');
}

/* ------------------------------------------------------------------ pages */

const stats = { pages: 0, requests: 0, failed: 0, lastError: '' };
export const youtubePhoneStatus = () => ({
	port: youtubePhonePort(),
	signedIn: listProfiles().filter((p) => signedIn(p.id)).map((p) => p.id),
	...stats
});

/** YouTube's scripts and styles, already changed for an address, kept so the phone gets them at once. */
const kept = new Map<string, { type: string; body: Buffer; gz: Buffer }>();
let keptBytes = 0;
function keepFile(key: string, type: string, body: Buffer, gz: Buffer) {
	kept.set(key, { type, body, gz });
	keptBytes += body.length + gz.length;
	for (const [k, v] of kept) {
		if (keptBytes < 150 * 1024 * 1024) break;
		kept.delete(k);
		keptBytes -= v.body.length + v.gz.length;
	}
}

function decode(raw: Buffer, encoding: string): Buffer {
	if (/br/.test(encoding)) return zlib.brotliDecompressSync(raw);
	if (/gzip/.test(encoding)) return zlib.gunzipSync(raw);
	if (/deflate/.test(encoding)) return zlib.inflateSync(raw);
	return raw;
}

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function note(res: http.ServerResponse, title: string, words: string, back: string) {
	res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
	res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f0f;color:#f1f1f1;
font:16px/1.5 -apple-system,system-ui,sans-serif}main{max-width:22rem;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 20px;color:#aaa}a{display:inline-block;padding:10px 18px;border-radius:99px;background:#e994c2;color:#141414;
text-decoration:none;font-weight:600}</style></head><body><main><h1>${title}</h1><p>${words}</p><a href="${back}">Back to YouTube</a></main></body></html>`);
}

const SIGN_IN = /^\/(signin|logout)\b|^\/__h\/accounts\.google\.com\/(ServiceLogin|signin|AccountChooser|AddSession|Logout|SignOutOptions|v3\/signin)/i;

async function answer(req: http.IncomingMessage, res: http.ServerResponse) {
	const host = req.headers.host ?? `127.0.0.1:${youtubePhonePort()}`;
	const secure = req.headers['x-forwarded-proto'] === 'https' || host.endsWith(`:${SECURE_PORT}`) || /\.ts\.net(:\d+)?$/.test(host);
	const own = `${secure ? 'https' : 'http'}://${host}`;
	const name = host.replace(/:\d+$/, '');
	const catalog = secure ? `https://${name}` : `http://${name}:${catalogPort()}`;
	const path = req.url ?? '/';
	const profile = profileOf(req);

	// Catalog's PIN covers YouTube too (the phone's Catalog cookie comes along: same computer name).
	if (pinIsSet()) {
		const cookies = String(req.headers.cookie ?? '');
		const auth = cookies.match(/(?:^|;\s*)catalog_auth=([^;]*)/)?.[1];
		if (auth !== sessionToken()) {
			res.writeHead(303, { location: `${catalog}/login?next=${encodeURIComponent('/youtube')}` });
			return res.end();
		}
	}

	if (/^\/(__h\/[^/]+\/)?sw\.js/.test(path)) {
		res.writeHead(404);
		return res.end();
	}
	// The sign-in renewal is the computer's window's job.
	if (/^\/__h\/accounts\.google\.com\/RotateCookies/i.test(path)) {
		res.writeHead(204);
		return res.end();
	}
	if (SIGN_IN.test(path)) {
		const out = signedIn(profile) || /logout|Logout|SignOut/.test(path);
		const who = listProfiles().find((p) => p.id === profile)?.name ?? '';
		const beside = who ? ` beside ${escapeHtml(who)}` : '';
		return note(
			res,
			out ? 'Change account on the computer' : 'Sign in on the computer',
			out
				? `On the computer, open YouTube in Catalog and press Sign out${beside} under Phones, then Sign in.`
				: `On the computer, open YouTube in Catalog and press Sign in${beside} under Phones.`,
			'/'
		);
	}

	let target: URL;
	const through = path.match(/^\/__h\/([^/?#]+)(.*)$/);
	if (through) {
		if (!THROUGH.test(through[1].replace(/:\d+$/, ''))) {
			res.writeHead(403);
			return res.end();
		}
		target = new URL(`https://${through[1]}${through[2] || '/'}`);
	} else {
		target = new URL(`https://${YOUTUBE}${path}`);
	}

	const isStatic = req.method === 'GET' && !through && /^\/(s|static|yts)\//.test(target.pathname);
	const wantsGzip = /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
	const keyed = `${own} ${target.href}`;
	const ready = isStatic ? kept.get(keyed) : undefined;
	if (ready) {
		res.writeHead(200, {
			'content-type': ready.type,
			'cache-control': 'public, max-age=86400',
			...(wantsGzip ? { 'content-encoding': 'gzip' } : {})
		});
		return res.end(wantsGzip ? ready.gz : ready.body);
	}

	stats.requests++;
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(req.headers)) {
		if (v === undefined) continue;
		if (/^(host|connection|keep-alive|content-length|cookie|origin|referer|te|priority|upgrade-insecure-requests|accept-encoding|x-forwarded-.*|forwarded|tailscale-.*|sec-fetch-.*|via)$/i.test(k)) continue;
		headers[k] = Array.isArray(v) ? v.join(', ') : v;
	}
	// The encodings the phone itself can read (anything not changed here passes as it comes).
	headers['accept-encoding'] = String(req.headers['accept-encoding'] ?? 'gzip').split(',').map((s) => s.trim())
		.filter((e) => /^(gzip|deflate|br)\b/.test(e)).join(', ') || 'identity';
	const group = groupOf(target.hostname);
	if (group) {
		const cookies = jar(profile, group);
		// Cookies YouTube's page set for itself on this address.
		for (const part of String(req.headers.cookie ?? '').split(/;\s*/)) {
			const at = part.indexOf('=');
			if (at > 0 && !OURS.test(part.slice(0, at)) && !cookies.has(part.slice(0, at))) cookies.set(part.slice(0, at), part.slice(at + 1));
		}
		if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
		if (group === 'youtube' && target.pathname.startsWith('/youtubei/')) {
			const auth = authorization(cookies);
			if (auth) {
				headers.authorization = auth;
				headers['x-goog-authuser'] = '0';
				headers['x-origin'] = `https://${YOUTUBE}`;
			}
		}
	}
	if (req.headers.origin) headers.origin = `https://${YOUTUBE}`;
	if (req.headers.referer) {
		try {
			const from = new URL(String(req.headers.referer));
			headers.referer = `https://${YOUTUBE}${from.pathname.startsWith('/__h/') ? '/' : from.pathname + from.search}`;
		} catch {
			headers.referer = `https://${YOUTUBE}/`;
		}
	}

	const upstream = https.request(target, {
		method: req.method,
		headers,
		// YouTube's answers carry more header than Node takes by default (16 KB).
		maxHeaderSize: 256 * 1024,
		timeout: 30_000
	});
	upstream.on('timeout', () => upstream.destroy(new Error('YouTube took too long')));
	upstream.on('error', (e) => {
		stats.failed++;
		stats.lastError = `${target.hostname}: ${e.message}`;
		if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
		res.end();
	});
	req.on('aborted', () => upstream.destroy());
	res.on('close', () => upstream.destroy());

	upstream.on('response', (up) => {
		const setCookies = up.headers['set-cookie'];
		if (setCookies?.length) noteSetCookies(profile, target.hostname, setCookies);

		const type = String(up.headers['content-type'] ?? '');
		const out: Record<string, string | string[]> = {};
		for (const [k, v] of Object.entries(up.headers)) {
			if (v === undefined) continue;
			if (/^(content-length|content-security-policy.*|x-frame-options|strict-transport-security|alt-svc|set-cookie|report-to|nel|cross-origin-.*|permissions-policy|transfer-encoding|connection|keep-alive|access-control-.*|origin-trial|reporting-endpoints|x-xss-protection|connection-allowlist.*)$/i.test(k)) continue;
			out[k] = v;
		}
		const location = up.headers.location;
		if (location) {
			out.location = location.replace(/^https:\/\/([^/]+)/, (all, h: string) =>
				h === YOUTUBE ? own : THROUGH.test(h) ? `${own}/__h/${h}` : all
			);
		}

		const isText = /text\/html|javascript|json|text\/css|mpegurl/i.test(type) && req.method !== 'HEAD';
		if (!isText) {
			res.writeHead(up.statusCode ?? 502, out);
			up.pipe(res);
			return;
		}

		const chunks: Buffer[] = [];
		up.on('data', (c: Buffer) => chunks.push(c));
		up.on('end', () => {
			let text: string;
			try {
				text = decode(Buffer.concat(chunks), String(up.headers['content-encoding'] ?? '')).toString('utf8');
			} catch (e) {
				stats.failed++;
				stats.lastError = `decode ${target.pathname}: ${(e as Error).message}`;
				res.writeHead(502);
				return res.end();
			}
			delete out['content-encoding'];
			text = text
				.replaceAll(`https://${YOUTUBE}`, own)
				.replaceAll(`https:\\/\\/${YOUTUBE}`, own.replaceAll('/', '\\/'))
				// Google's sign-in address (YouTube's Sign in), so it lands on the note above.
				.replaceAll('https://accounts.google.com/', `${own}/__h/accounts.google.com/`)
				.replaceAll('https:\\/\\/accounts.google.com\\/', `${own.replaceAll('/', '\\/')}\\/__h\\/accounts.google.com\\/`);
			if (/mpegurl/i.test(type)) {
				text = text.replace(/https:\/\/([a-z0-9.-]+\.(?:googlevideo|youtube)\.com)/gi, `${own}/__h/$1`);
			}
			if (/text\/html/i.test(type)) {
				stats.pages++;
				const setup = `window.__catalogPhone=${JSON.stringify({ catalog: `${catalog}/` })};`;
				text = text.replace(/<head[^>]*>/i, (head) =>
					`${head}<script>${setup}${pageScript}</script><script>${adsScript}</script>`
				);
				// The page's own scripts look for this cookie before they send the account's requests
				// (which get the real one added here); it holds nothing.
				out['set-cookie'] = signedIn(profile) ? 'SAPISID=catalog; Path=/; SameSite=Lax' : 'SAPISID=; Path=/; Max-Age=0';
				out['cache-control'] = 'no-store';
			}
			const body = Buffer.from(text, 'utf8');
			const send = (gz: Buffer | null) => {
				if (gz) out['content-encoding'] = 'gzip';
				res.writeHead(up.statusCode ?? 200, out);
				res.end(gz ?? body);
			};
			if (body.length < 1024 || (!wantsGzip && !(isStatic && up.statusCode === 200))) return send(null);
			zlib.gzip(body, { level: 6 }, (err, gz) => {
				if (err) return send(null);
				if (isStatic && up.statusCode === 200) keepFile(keyed, type, body, gz);
				send(wantsGzip ? gz : null);
			});
		});
		up.on('error', () => res.end());
	});

	if (req.method === 'GET' || req.method === 'HEAD') upstream.end();
	else req.pipe(upstream);
}

/** Started once, beside Catalog's own server (hooks.server.ts). */
export function startYouTubeForPhones() {
	const port = youtubePhonePort();
	const flag = globalThis as unknown as { __catalogYouTubePhone?: boolean };
	if (!port || flag.__catalogYouTubePhone) return;
	flag.__catalogYouTubePhone = true;

	if (typeof process.send === 'function') {
		process.on('message', (message: { type?: string; profile?: number; cookies?: { name: string; value: string; domain?: string }[] }) => {
			if (message?.type === 'youtube-cookies' && Array.isArray(message.cookies)) takeComputerCookies(Number(message.profile) || 0, message.cookies);
			if (message?.type === 'youtube-account-done') {
				busy.delete(Number(message.profile) || 0);
				lastResult.set(Number(message.profile) || 0, String((message as { result?: string }).result ?? ''));
			}
		});
		try {
			process.send({ type: 'youtube-cookies-ask', profiles: listProfiles().map((p) => p.id) });
		} catch {}
	}

	const server = http.createServer((req, res) => {
		answer(req, res).catch((e) => {
			stats.failed++;
			stats.lastError = String(e?.message ?? e);
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});
	server.on('error', (e) => {
		stats.lastError = `listen ${port}: ${(e as Error).message}`;
		console.error('[youtube-phone]', stats.lastError);
	});
	server.listen(port, process.env.HOST || '0.0.0.0');
}
