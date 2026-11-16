/**
 * Catalog's meeting point: a small server on Cloudflare (Workers + the D1 database) that Catalogs
 * in different houses talk through. No video ever passes through it, and nothing from a Catalog's
 * Settings (its TMDB key, its Febbox sign-in) is ever sent to it: only names, titles, progress and
 * small notes.
 *
 * Who may talk to it:
 *   - A Catalog becomes a "house" by registering with the join code (the JOIN_CODE secret, which the
 *     owner hands to family and friends). It gets a key back; only the key's SHA-256 is kept here.
 *   - Every other request carries "Authorization: Bearer <house>.<key>" and "X-Catalog-Profile: <n>"
 *     (which of the house's profiles is asking). A profile of a house belongs to one account.
 *   - Problem reports are read with the ADMIN_KEY secret (the owner's own Catalog has it).
 *
 * Everything is JSON. See cloud/README.md for each address.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The most one library row may hold (a long review is most of it); other synced rows stay at 4,000. */
const ENTRY_MOST = 24000;
/** Letters and digits that can't be mistaken for each other when read out or typed. */
const CLEAR = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SHARED_KINDS = ['skips', 'subtiming', 'sharpness'];
/** A watched title's key: the site and its own id there, "tmdb:movie:550" or "anilist:21". */
const SEEN_KEY = /^[a-z]+:[\w:-]+$/;
/** A poster from TMDB or AniList (nothing else is shown to friends). */
const POSTER = /^https:\/\/(image\.tmdb\.org|s4\.anilist\.co)\//;
/** The longest message. */
const MESSAGE_MOST = 500;
const ACCOUNT_ID = /^[A-Z0-9]{16}$/;
/** A profile's banner: a picture as a data: address (a GIF may move); the longest one kept. */
const BANNER = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const BANNER_MOST = 700_000;

/**
 * A name's look (src/lib/nameStyle.ts in Catalog): a font id, an effect and one or two colors.
 * Only its shape is checked, so Catalog can add fonts without a new server. Null when there's none.
 */
function lookOf(value) {
	let v = value;
	if (typeof v === 'string') {
		try {
			v = v ? JSON.parse(v) : null;
		} catch {
			return null;
		}
	}
	if (!v || typeof v !== 'object') return null;
	const font = typeof v.font === 'string' && /^[a-z0-9-]{0,30}$/.test(v.font) ? v.font : '';
	const effect = v.effect === 'gradient' || v.effect === 'glow' ? v.effect : 'solid';
	const colors = (Array.isArray(v.colors) ? v.colors : []).filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 2).map((c) => c.toLowerCase());
	return font || colors.length ? { font, effect, colors } : null;
}

const json = (body, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const bad = (status, message) => json({ error: message }, status);

function random(length, alphabet = CLEAR) {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (const b of bytes) out += alphabet[b % alphabet.length];
	return out;
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** Compared in the same time whatever they are, so the answer's timing says nothing about a key. */
function same(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Text of at most `max` characters, with nothing that isn't printable. */
const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const whole = (value, low, high) => (Number.isInteger(Number(value)) ? Math.min(high, Math.max(low, Number(value))) : low);

async function body(request, most = 64 * 1024) {
	const raw = await request.text();
	if (raw.length > most) throw new Problem(413, 'Too much sent at once');
	try {
		const parsed = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		throw new Problem(400, 'Not JSON');
	}
}

class Problem extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** Counts one more try by `who` today. False once past `most`. */
async function allowed(env, who, most) {
	const day = new Date().toISOString().slice(0, 10);
	const row = await env.DB.prepare('INSERT INTO tries (who, day, n) VALUES (?, ?, 1) ON CONFLICT (who, day) DO UPDATE SET n = n + 1 RETURNING n').bind(who, day).first();
	return (row?.n ?? 1) <= most;
}

const addressOf = (request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';

const OWNER_WRONG_MOST = 10;

/**
 * The owner's key (X-Catalog-Admin) for reading problem reports. Only wrong tries are counted, per
 * address: after 10 in a day that address gets no answer about the key until tomorrow, even
 * with the right one. Null when it's the owner, else the answer to send.
 */
async function notOwner(request, env) {
	const who = `admin:${addressOf(request)}`;
	const day = new Date().toISOString().slice(0, 10);
	const row = await env.DB.prepare('SELECT n FROM tries WHERE who = ? AND day = ?').bind(who, day).first();
	if ((row?.n ?? 0) >= OWNER_WRONG_MOST) return bad(429, 'Too many tries today');
	if (env.ADMIN_KEY && same(await sha256(request.headers.get('X-Catalog-Admin') ?? ''), await sha256(env.ADMIN_KEY))) return null;
	await allowed(env, who, OWNER_WRONG_MOST);
	return bad(403, 'Not the owner');
}

/** The house asking, from its key. Throws when it isn't one. */
async function houseOf(request, env) {
	const sent = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
	const dot = sent.indexOf('.');
	if (dot < 1) throw new Problem(401, 'Not signed in');
	const id = sent.slice(0, dot);
	const house = await env.DB.prepare('SELECT id, key_hash, name, seen FROM houses WHERE id = ?').bind(id).first();
	if (!house || !same(house.key_hash, await sha256(sent.slice(dot + 1)))) throw new Problem(401, 'Not signed in');
	if (Date.now() - house.seen > HOUR) await env.DB.prepare('UPDATE houses SET seen = ? WHERE id = ?').bind(Date.now(), id).run();
	return house;
}

/** The account of the profile asking; made the first time (named after the profile, or the house). */
async function accountOf(request, env, house, name = '') {
	const profile = whole(request.headers.get('X-Catalog-Profile'), 0, 99);
	const member = await env.DB.prepare('SELECT account FROM members WHERE house = ? AND profile = ?').bind(house.id, profile).first();
	if (member) {
		const account = await env.DB.prepare('SELECT a.id, a.name, a.google_sub, a.email, a.rev, v.rev AS avatar FROM accounts a LEFT JOIN avatars v ON v.account = a.id WHERE a.id = ?').bind(member.account).first();
		if (account) return { ...account, profile };
	}
	const id = random(16);
	// Named after the profile (Catalog sends its name along), else the computer.
	let profileName = '';
	try {
		profileName = decodeURIComponent(request.headers.get('X-Catalog-Name') ?? '');
	} catch {}
	const named = text(name, 30) || text(profileName, 30) || house.name || 'Someone';
	await env.DB.batch([
		env.DB.prepare('INSERT INTO accounts (id, name, created) VALUES (?, ?, ?)').bind(id, named, Date.now()),
		env.DB.prepare('INSERT INTO members (house, profile, account) VALUES (?, ?, ?) ON CONFLICT (house, profile) DO UPDATE SET account = excluded.account').bind(house.id, profile, id)
	]);
	return { id, name: named, google_sub: null, email: null, rev: 0, avatar: null, profile };
}

/** `avatar`: 0 with no picture, else a number that changes with each new one (GET /v1/avatar/<id>). */
const publicAccount = (account) => ({ id: account.id, name: account.name, google: Boolean(account.google_sub), email: account.email ?? null, avatar: account.avatar ?? 0 });

/** A picture as Catalog sends it: a small JPEG, PNG or WebP as a data address. */
const PICTURE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** A code that's used once: answers its row and deletes it, or null (wrong, used or run out). */
async function useCode(env, code, kind) {
	const row = await env.DB.prepare('DELETE FROM codes WHERE code = ? AND kind = ? AND expires > ? RETURNING account, house, profile').bind(text(code, 64).toUpperCase(), kind, Date.now()).first();
	return row ?? null;
}

/** Two accounts become friends (both ways), and any requests between them are answered by it. */
async function befriend(env, one, other, now) {
	await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(one, other, now),
		env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(other, one, now),
		env.DB.prepare('DELETE FROM friend_requests WHERE (from_account = ?1 AND to_account = ?2) OR (from_account = ?2 AND to_account = ?1)').bind(one, other)
	]);
}

/** Old leftovers go, now and then. */
async function tidy(env) {
	const now = Date.now();
	await env.DB.batch([
		env.DB.prepare('DELETE FROM codes WHERE expires < ?').bind(now),
		env.DB.prepare('DELETE FROM pairs WHERE expires < ?').bind(now),
		env.DB.prepare('DELETE FROM presence WHERE at < ?').bind(now - 6 * HOUR),
		// Requests nobody answered in 30 days.
		env.DB.prepare('DELETE FROM friend_requests WHERE at < ?').bind(now - 30 * DAY),
		env.DB.prepare('DELETE FROM room_members WHERE code IN (SELECT code FROM rooms WHERE updated < ?)').bind(now - 12 * HOUR),
		env.DB.prepare('DELETE FROM rooms WHERE updated < ?').bind(now - 12 * HOUR),
		// A room's chat goes with the room; whispers are kept 90 days.
		env.DB.prepare("DELETE FROM messages WHERE room != '' AND room NOT IN (SELECT code FROM rooms)"),
		env.DB.prepare('DELETE FROM messages WHERE at < ?').bind(now - 90 * DAY),
		env.DB.prepare('DELETE FROM reports WHERE created < ?').bind(now - 60 * DAY),
		env.DB.prepare('DELETE FROM tries WHERE day < ?').bind(new Date(now - 2 * DAY).toISOString().slice(0, 10))
	]);
}

/* ------------------------------------------------------------ signing in with Google */

const googleOn = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const page = (title, inner) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
			`<body style="font-family:system-ui,sans-serif;background:#111614;color:#eef2ef;display:grid;place-items:center;min-height:100vh;margin:0">` +
			`<main style="max-width:28rem;padding:2rem;text-align:center">${inner}</main>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } }
	);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Google sends the person back here. Nothing is joined yet: they're shown which computer asked, and say yes. */
async function googleBack(url, env) {
	if (!googleOn(env)) return page('Catalog', '<h1>Not set up</h1>');
	const state = text(url.searchParams.get('state'), 64);
	const pending = await env.DB.prepare("SELECT house, expires FROM codes WHERE code = ? AND kind = 'google'").bind(state).first();
	if (!pending || pending.expires < Date.now() || !url.searchParams.get('code')) return page('Catalog', '<h1>That sign-in ran out</h1><p>Start it again from Catalog.</p>');
	const answer = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code: url.searchParams.get('code'),
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			redirect_uri: `${url.origin}/v1/google/callback`,
			grant_type: 'authorization_code'
		})
	});
	const tokens = answer.ok ? await answer.json() : null;
	// The id token came straight from Google in answer to our own request, so its contents are Google's word.
	let who = null;
	try {
		who = JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
	} catch {}
	if (!who?.sub || who.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(who.iss ?? '')) {
		return page('Catalog', "<h1>Google didn't confirm that</h1><p>Start it again from Catalog.</p>");
	}
	const house = await env.DB.prepare('SELECT name FROM houses WHERE id = ?').bind(pending.house).first();
	// Waiting for the yes: who it is rides in the row, under a new kind, for five minutes.
	await env.DB.prepare("UPDATE codes SET kind = 'google-yes', account = ?, expires = ? WHERE code = ? AND kind = 'google'")
		.bind(JSON.stringify({ sub: who.sub, email: text(who.email, 120), name: text(who.name, 60) }), Date.now() + 5 * MINUTE, state)
		.run();
	return page(
		'Sign in to Catalog',
		`<h1>Sign in to Catalog?</h1><p>The Catalog on <strong>${escape(house?.name || 'a computer')}</strong> asked to sign in as <strong>${escape(who.email)}</strong>.</p>` +
			`<p style="opacity:.75">Only say yes if you started this from that Catalog just now. It will be able to see this account's Catalog library and progress.</p>` +
			`<form method="post" action="/v1/google/confirm"><input type="hidden" name="state" value="${escape(state)}">` +
			`<button style="font:inherit;font-weight:600;padding:.7rem 1.6rem;border-radius:999px;border:0;background:#e994c2;color:#111;cursor:pointer">Yes, sign in</button></form>`
	);
}

async function googleConfirm(request, env) {
	const form = await request.formData().catch(() => null);
	const state = text(form?.get('state'), 64);
	const row = await env.DB.prepare("DELETE FROM codes WHERE code = ? AND kind = 'google-yes' AND expires > ? RETURNING account, house, profile").bind(state, Date.now()).first();
	if (!row) return page('Catalog', '<h1>That sign-in ran out</h1><p>Start it again from Catalog.</p>');
	const who = JSON.parse(row.account);
	const known = await env.DB.prepare('SELECT id FROM accounts WHERE google_sub = ?').bind(who.sub).first();
	const member = await env.DB.prepare('SELECT account FROM members WHERE house = ? AND profile = ?').bind(row.house, row.profile).first();
	const mine = member ? await env.DB.prepare('SELECT id, google_sub FROM accounts WHERE id = ?').bind(member.account).first() : null;
	let account = known?.id;
	if (!account && mine && !mine.google_sub) {
		// First sign-in: the account this profile already had becomes the Google one (its friends stay).
		account = mine.id;
		await env.DB.prepare('UPDATE accounts SET google_sub = ?, email = ? WHERE id = ?').bind(who.sub, who.email, account).run();
	} else if (!account) {
		account = random(16);
		await env.DB.prepare('INSERT INTO accounts (id, name, google_sub, email, created) VALUES (?, ?, ?, ?, ?)').bind(account, who.name || who.email, who.sub, who.email, Date.now()).run();
	}
	await env.DB.prepare('INSERT INTO members (house, profile, account) VALUES (?, ?, ?) ON CONFLICT (house, profile) DO UPDATE SET account = excluded.account').bind(row.house, row.profile, account).run();
	return page('Signed in', '<h1>Signed in</h1><p>Go back to Catalog. You can close this page.</p>');
}

/* ------------------------------------------------------------ everything a house can ask */

async function answer(request, env, ctx) {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, '');
	const method = request.method;
	const is = (m, p) => method === m && path === p;

	if (Math.random() < 0.02) ctx.waitUntil(tidy(env).catch(() => {}));

	// `library`: this server keeps library rows (kind "entry", up to ENTRY_MOST characters each) and can list one kind.
	if (is('GET', '') || is('GET', '/v1/info')) return json({ ok: true, name: 'Catalog meeting point', google: googleOn(env), library: 1 });

	// A TV with only a short code: where its computer is. Open to anyone, so it's limited per address.
	const pairCode = path.match(/^\/v1\/pair\/(\d{6})$/);
	if (method === 'OPTIONS' && pairCode) return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
	if (method === 'GET' && pairCode) {
		const open = { 'Access-Control-Allow-Origin': '*' };
		if (!(await allowed(env, `pair:${addressOf(request)}`, 40))) return json({ error: 'Too many tries today' }, 429, open);
		const row = await env.DB.prepare('SELECT what FROM pairs WHERE code = ? AND expires > ?').bind(pairCode[1], Date.now()).first();
		return row ? json(JSON.parse(row.what), 200, open) : json({ error: 'No computer has that code right now' }, 404, open);
	}

	if (is('GET', '/v1/google/callback')) return googleBack(url, env);
	if (is('POST', '/v1/google/confirm')) return googleConfirm(request, env);

	// A new house: needs the join code, and an address can only make a few a day.
	if (is('POST', '/v1/houses')) {
		const sent = await body(request);
		if (!(await allowed(env, `join:${addressOf(request)}`, 12))) return bad(429, 'Too many tries today');
		if (!env.JOIN_CODE || !same(await sha256(text(sent.join, 80)), await sha256(env.JOIN_CODE))) return bad(403, "That isn't the join code");
		const id = random(12);
		const key = random(43, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
		await env.DB.prepare('INSERT INTO houses (id, key_hash, name, created, seen) VALUES (?, ?, ?, ?, ?)').bind(id, await sha256(key), text(sent.name, 40), Date.now(), Date.now()).run();
		return json({ house: id, key });
	}

	// The owner reading what Catalogs reported.
	if (path === '/v1/reports' && method === 'GET') {
		const refused = await notOwner(request, env);
		if (refused) return refused;
		const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
		const brief = url.searchParams.get('full') !== '1';
		const rows = await env.DB.prepare(`SELECT id, house, house_name AS houseName, kind, title, ${brief ? 'substr(body, 1, 400) AS body' : 'body'}, created FROM reports WHERE id < ? ORDER BY id DESC LIMIT ?`)
			.bind(before, brief ? 100 : 20)
			.all();
		return json({ reports: rows.results });
	}
	const reportId = path.match(/^\/v1\/reports\/(\d+)$/);
	if (reportId && (method === 'GET' || method === 'DELETE')) {
		const refused = await notOwner(request, env);
		if (refused) return refused;
		if (method === 'DELETE') {
			await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(Number(reportId[1])).run();
			return json({ ok: true });
		}
		const row = await env.DB.prepare('SELECT id, house, house_name AS houseName, kind, title, body, created FROM reports WHERE id = ?').bind(Number(reportId[1])).first();
		return row ? json(row) : bad(404, 'No such report');
	}

	const house = await houseOf(request, env);

	/* ---- who's asking */

	if (is('POST', '/v1/hello')) {
		const sent = await body(request);
		const account = await accountOf(request, env, house, sent.name);
		if (text(sent.house, 40) && text(sent.house, 40) !== house.name) await env.DB.prepare('UPDATE houses SET name = ? WHERE id = ?').bind(text(sent.house, 40), house.id).run();
		const others = await env.DB.prepare('SELECT count(*) AS n FROM members WHERE account = ?').bind(account.id).first();
		return json({ account: publicAccount(account), computers: others?.n ?? 1, google: googleOn(env) });
	}

	const account = await accountOf(request, env, house);

	// The name and picture friends see. Either can be sent alone; picture '' takes it away.
	if (is('PUT', '/v1/me')) {
		const sent = await body(request, 120 * 1024);
		const name = text(sent.name, 30);
		const picture = typeof sent.avatar === 'string' ? sent.avatar : null;
		if (!name && picture === null) return bad(400, 'A name, please');
		if (picture && (picture.length > 90_000 || !PICTURE.test(picture))) return bad(400, "That picture can't be used");
		if (name) await env.DB.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, account.id).run();
		if (picture === '') await env.DB.prepare('DELETE FROM avatars WHERE account = ?').bind(account.id).run();
		// (The number never goes back to one it had, even after the picture was taken away: Catalogs keep pictures by it.)
		if (picture) await env.DB.prepare('INSERT INTO avatars (account, image, rev) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET image = excluded.image, rev = excluded.rev').bind(account.id, picture, Math.floor(Date.now() / 1000)).run();
		const now = await env.DB.prepare('SELECT a.id, a.name, a.google_sub, a.email, v.rev AS avatar FROM accounts a LEFT JOIN avatars v ON v.account = a.id WHERE a.id = ?').bind(account.id).first();
		return json({ ok: true, account: publicAccount(now) });
	}

	// Someone's picture. Any Catalog that has joined may ask (the id is only learned from a friend list or a room).
	const pictureOf = path.match(/^\/v1\/avatar\/([A-Z0-9]{16})$/);
	if (pictureOf && method === 'GET') {
		const row = await env.DB.prepare('SELECT image FROM avatars WHERE account = ?').bind(pictureOf[1]).first();
		const parts = row ? PICTURE.exec(row.image) : null;
		if (!parts) return bad(404, 'No picture');
		const bytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
		return new Response(bytes, { headers: { 'Content-Type': `image/${parts[1]}`, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
	}

	// This profile leaves its account for a new, empty one (what was synced stays with the account).
	if (is('POST', '/v1/signout')) {
		await env.DB.prepare('DELETE FROM members WHERE house = ? AND profile = ?').bind(house.id, account.profile).run();
		// Nobody can ever get back to an account with no computer left and no Google sign-in: it goes,
		// or its friends would keep a name on their list that is never watching anything again.
		const left = await env.DB.prepare('SELECT count(*) AS n FROM members WHERE account = ?').bind(account.id).first();
		if (!left?.n && !account.google_sub) {
			await env.DB.batch(
				['DELETE FROM friends WHERE a = ?1 OR b = ?1', 'DELETE FROM seen WHERE account = ?1', 'DELETE FROM seen_info WHERE account = ?1', 'DELETE FROM profiles WHERE account = ?1', 'DELETE FROM looks WHERE account = ?1', 'DELETE FROM privacy WHERE account = ?1', 'DELETE FROM messages WHERE from_account = ?1 OR to_account = ?1', 'DELETE FROM message_reads WHERE account = ?1','DELETE FROM presence WHERE account = ?1', 'DELETE FROM avatars WHERE account = ?1', 'DELETE FROM sync_rows WHERE account = ?1', 'DELETE FROM codes WHERE account = ?1', 'DELETE FROM friend_codes WHERE account = ?1', 'DELETE FROM activity WHERE account = ?1', 'DELETE FROM friend_requests WHERE from_account = ?1 OR to_account = ?1', 'DELETE FROM accounts WHERE id = ?1'].map((sql) => env.DB.prepare(sql).bind(account.id))
			);
		}
		const fresh = await accountOf(request, env, house, account.name);
		return json({ account: publicAccount(fresh) });
	}

	/* ---- one account on several computers */

	if (is('POST', '/v1/link/code')) {
		const code = random(8);
		await env.DB.prepare("INSERT INTO codes (code, kind, account, house, profile, expires) VALUES (?, 'link', ?, ?, ?, ?)").bind(code, account.id, house.id, account.profile, Date.now() + 15 * MINUTE).run();
		return json({ code, minutes: 15 });
	}
	if (is('POST', '/v1/link/join')) {
		const sent = await body(request);
		if (!(await allowed(env, `code:${house.id}`, 40))) return bad(429, 'Too many tries today');
		const row = await useCode(env, sent.code, 'link');
		if (!row) return bad(404, "That code isn't right, or it ran out");
		await env.DB.prepare('UPDATE members SET account = ? WHERE house = ? AND profile = ?').bind(row.account, house.id, account.profile).run();
		const joined = await env.DB.prepare('SELECT id, name, google_sub, email FROM accounts WHERE id = ?').bind(row.account).first();
		return json({ account: publicAccount(joined) });
	}
	if (is('POST', '/v1/google/start')) {
		if (!googleOn(env)) return bad(404, "Signing in with Google isn't set up");
		const state = random(40);
		await env.DB.prepare("INSERT INTO codes (code, kind, account, house, profile, expires) VALUES (?, 'google', ?, ?, ?, ?)").bind(state, account.id, house.id, account.profile, Date.now() + 10 * MINUTE).run();
		const ask = new URL('https://accounts.google.com/o/oauth2/v2/auth');
		ask.search = new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID,
			redirect_uri: `${url.origin}/v1/google/callback`,
			response_type: 'code',
			scope: 'openid email profile',
			state,
			prompt: 'select_account'
		}).toString();
		return json({ url: ask.href });
	}

	/* ---- friends */

	// This person's own friend code: the same one every time, for good. `{ fresh: true }` makes a new
	// one (the old one stops working), for a code that was shared further than meant.
	if (is('POST', '/v1/friends/code')) {
		const sent = await body(request);
		const kept = sent.fresh === true ? null : await env.DB.prepare('SELECT code FROM friend_codes WHERE account = ?').bind(account.id).first();
		if (kept) return json({ code: kept.code, lasting: true });
		for (let tries = 0; tries < 5; tries++) {
			const code = random(8);
			const made = await env.DB.prepare('INSERT INTO friend_codes (account, code) VALUES (?, ?) ON CONFLICT (account) DO UPDATE SET code = excluded.code')
				.bind(account.id, code)
				.run()
				.catch(() => null);
			if (made) return json({ code, lasting: true });
		}
		return bad(503, 'Try again');
	}
	if (is('POST', '/v1/friends/add')) {
		const sent = await body(request);
		if (!(await allowed(env, `code:${house.id}`, 40))) return bad(429, 'Too many tries today');
		// Someone's lasting code first; a one-time code from an older Catalog after that.
		const lasting = await env.DB.prepare('SELECT account FROM friend_codes WHERE code = ?').bind(text(sent.code, 64).toUpperCase().replace(/[^A-Z0-9]/g, '')).first();
		const row = lasting ?? (await useCode(env, sent.code, 'friend'));
		if (!row) return bad(404, "That code isn't right, or it ran out");
		if (await env.DB.prepare('SELECT 1 FROM friends WHERE a = ? AND b = ?').bind(account.id, row.account).first()) return bad(400, "You're friends already");
		if (row.account === account.id) return bad(400, "That's your own code");
		const now = Date.now();
		await env.DB.batch([
			env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(account.id, row.account, now),
			env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(row.account, account.id, now)
		]);
		const friend = await env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(row.account).first();
		return json({ ok: true, name: friend?.name ?? '' });
	}
	/** What someone keeps from their friends (PUT /v1/privacy). */
	const privacyOf = async (who) => {
		const row = await env.DB.prepare('SELECT hide_profile, hide_friends FROM privacy WHERE account = ?').bind(who).first();
		return { hideProfile: Boolean(row?.hide_profile), hideFriends: Boolean(row?.hide_friends) };
	};

	if (is('GET', '/v1/friends')) {
		const [rows, asked, known] = await env.DB.batch([
			env.DB.prepare(
				'SELECT a.id, a.name, v.rev AS avatar, p.what, p.at, l.name_style FROM friends f JOIN accounts a ON a.id = f.b LEFT JOIN avatars v ON v.account = a.id LEFT JOIN presence p ON p.account = f.b AND p.at > ? LEFT JOIN looks l ON l.account = a.id WHERE f.a = ? ORDER BY a.name'
			).bind(Date.now() - 3 * MINUTE, account.id),
			// Asked to be friends with this account, not answered yet.
			env.DB.prepare('SELECT a.id, a.name, v.rev AS avatar FROM friend_requests r JOIN accounts a ON a.id = r.from_account LEFT JOIN avatars v ON v.account = a.id WHERE r.to_account = ? ORDER BY r.at DESC LIMIT 20').bind(account.id),
			// People this account's friends know and it doesn't yet: who knows them, and whether asked already.
			env.DB.prepare(
				'SELECT a.id, a.name, v.rev AS avatar, min(via.name) AS via, count(DISTINCT f1.b) AS mutual, ' +
					'EXISTS (SELECT 1 FROM friend_requests r WHERE r.from_account = ?1 AND r.to_account = a.id) AS requested ' +
					'FROM friends f1 JOIN friends f2 ON f2.a = f1.b JOIN accounts a ON a.id = f2.b JOIN accounts via ON via.id = f1.b LEFT JOIN avatars v ON v.account = a.id ' +
					'WHERE f1.a = ?1 AND f2.b != ?1 AND f2.b NOT IN (SELECT b FROM friends WHERE a = ?1) ' +
					// (Not through a friend who keeps their friends to themselves.)
					'AND f1.b NOT IN (SELECT account FROM privacy WHERE hide_friends = 1) ' +
					'AND f2.b NOT IN (SELECT from_account FROM friend_requests WHERE to_account = ?1) ' +
					'GROUP BY a.id ORDER BY mutual DESC, a.name LIMIT 12'
			).bind(account.id)
		]);
		return json({
			me: publicAccount(account),
			friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, watching: r.what ? JSON.parse(r.what) : null, at: r.at ?? null, nameStyle: lookOf(r.name_style) })),
			requests: asked.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0 })),
			suggestions: known.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, via: r.via, mutual: r.mutual, requested: Boolean(r.requested) }))
		});
	}

	// A friend's friends, to ask the ones this account doesn't know yet.
	const theirFriends = path.match(/^\/v1\/friends\/([A-Z0-9]{16})\/friends$/);
	if (theirFriends && method === 'GET') {
		const them = theirFriends[1];
		if (!(await env.DB.prepare('SELECT 1 FROM friends WHERE a = ? AND b = ?').bind(account.id, them).first())) return bad(403, 'Not a friend');
		if ((await privacyOf(them)).hideFriends) return json({ friends: [], hidden: true });
		const rows = await env.DB.prepare(
			'SELECT a.id, a.name, v.rev AS avatar, ' +
				'EXISTS (SELECT 1 FROM friends m WHERE m.a = ?1 AND m.b = a.id) AS friend, ' +
				'EXISTS (SELECT 1 FROM friend_requests r WHERE r.from_account = ?1 AND r.to_account = a.id) AS requested, ' +
				'EXISTS (SELECT 1 FROM friend_requests r WHERE r.from_account = a.id AND r.to_account = ?1) AS asked ' +
				'FROM friends f JOIN accounts a ON a.id = f.b LEFT JOIN avatars v ON v.account = a.id WHERE f.a = ?2 ORDER BY a.name LIMIT 100'
		)
			.bind(account.id, them)
			.all();
		return json({
			friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, me: r.id === account.id, friend: Boolean(r.friend), requested: Boolean(r.requested), asked: Boolean(r.asked) }))
		});
	}

	// Asking someone to be friends: only someone a friend knows (nobody can be found by guessing).
	// When they'd asked this account already, that's a yes from both: friends at once.
	if (is('POST', '/v1/friends/request')) {
		const sent = await body(request);
		const to = /^[A-Z0-9]{16}$/.test(sent.to ?? '') ? sent.to : '';
		if (!to || to === account.id) return bad(400, 'Ask whom?');
		if (!(await allowed(env, `request:${account.id}`, 30))) return bad(429, 'Enough asking for today');
		if (await env.DB.prepare('SELECT 1 FROM friends WHERE a = ? AND b = ?').bind(account.id, to).first()) return json({ ok: true, friends: true });
		const known = await env.DB.prepare('SELECT 1 FROM friends f1 JOIN friends f2 ON f2.a = f1.b WHERE f1.a = ? AND f2.b = ? LIMIT 1').bind(account.id, to).first();
		if (!known) return bad(403, "Only someone a friend knows can be asked");
		const now = Date.now();
		if (await env.DB.prepare('SELECT 1 FROM friend_requests WHERE from_account = ? AND to_account = ?').bind(to, account.id).first()) {
			await befriend(env, account.id, to, now);
			return json({ ok: true, friends: true });
		}
		await env.DB.prepare('INSERT OR IGNORE INTO friend_requests (from_account, to_account, at) VALUES (?, ?, ?)').bind(account.id, to, now).run();
		return json({ ok: true, friends: false });
	}
	// Taking back a request this account made.
	if (is('POST', '/v1/friends/unrequest')) {
		const sent = await body(request);
		await env.DB.prepare('DELETE FROM friend_requests WHERE from_account = ? AND to_account = ?').bind(account.id, text(sent.to, 16)).run();
		return json({ ok: true });
	}
	// Yes or no to someone who asked.
	if (is('POST', '/v1/friends/answer')) {
		const sent = await body(request);
		const from = text(sent.from, 16);
		const asked = await env.DB.prepare('SELECT 1 FROM friend_requests WHERE from_account = ? AND to_account = ?').bind(from, account.id).first();
		if (!asked) return bad(404, 'No such request');
		if (sent.yes === true) await befriend(env, account.id, from, Date.now());
		else await env.DB.prepare('DELETE FROM friend_requests WHERE from_account = ? AND to_account = ?').bind(from, account.id).run();
		return json({ ok: true });
	}

	// What this account watched lately, for its friends' feed: its newest 20, replaced whole.
	if (is('PUT', '/v1/activity')) {
		const sent = await body(request, 64 * 1024);
		const items = (Array.isArray(sent.items) ? sent.items : [])
			.slice(0, 20)
			.map((i) => ({
				key: text(i?.key, 40),
				title: text(i?.title, 120),
				year: text(String(i?.year ?? ''), 4),
				type: i?.type === 'tv' ? 'tv' : 'movie',
				poster: /^https:\/\/(image\.tmdb\.org|s4\.anilist\.co)\//.test(i?.poster ?? '') ? text(i.poster, 200) : '',
				rating: Number.isFinite(Number(i?.rating)) && i.rating !== null ? Math.max(0, Math.min(10, Number(i.rating))) : null,
				at: whole(i?.at, 0, Date.now() + DAY),
				// A show's episode watched last (newer Catalogs; 0 when none).
				season: whole(i?.season, 0, 999),
				episode: whole(i?.episode, 0, 9999)
			}))
			.filter((i) => SEEN_KEY.test(i.key) && i.title && i.at > 0);
		await env.DB.prepare('INSERT INTO activity (account, items, updated) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET items = excluded.items, updated = excluded.updated')
			.bind(account.id, JSON.stringify(items), Date.now())
			.run();
		return json({ ok: true, kept: items.length });
	}
	if (is('GET', '/v1/activity')) {
		const rows = await env.DB.prepare(
			'SELECT a.id, a.name, v.rev AS avatar, t.items FROM friends f JOIN accounts a ON a.id = f.b JOIN activity t ON t.account = f.b LEFT JOIN avatars v ON v.account = a.id WHERE f.a = ? AND f.b NOT IN (SELECT account FROM privacy WHERE hide_profile = 1)'
		)
			.bind(account.id)
			.all();
		return json({ friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, items: JSON.parse(r.items) })) });
	}
	const friendId = path.match(/^\/v1\/friends\/([A-Z0-9]{16})$/);
	if (friendId && method === 'DELETE') {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(account.id, friendId[1]),
			env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(friendId[1], account.id)
		]);
		return json({ ok: true });
	}

	// What this account is watching now, for its friends. Sent every minute or so while something plays.
	if (path === '/v1/presence' && method === 'PUT') {
		const sent = await body(request);
		const what = {
			title: text(sent.title, 120),
			type: sent.type === 'tv' ? 'tv' : 'movie',
			year: text(String(sent.year ?? ''), 4),
			season: whole(sent.season, 0, 999),
			episode: whole(sent.episode, 0, 9999),
			poster: /^https:\/\/image\.tmdb\.org\//.test(sent.poster ?? '') ? text(sent.poster, 200) : '',
			// The watch-together room they're in, when they let friends watch along.
			room: /^[A-Z0-9]{6}$/.test(sent.room ?? '') ? sent.room : ''
		};
		if (!what.title) return bad(400, 'Watching what?');
		await env.DB.prepare('INSERT INTO presence (account, what, at) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET what = excluded.what, at = excluded.at').bind(account.id, JSON.stringify(what), Date.now()).run();
		return json({ ok: true });
	}
	if (path === '/v1/presence' && method === 'DELETE') {
		await env.DB.prepare('DELETE FROM presence WHERE account = ?').bind(account.id).run();
		return json({ ok: true });
	}

	// What this account has watched, for "friends who've seen this". Sent in parts of up to 300.
	if (is('PUT', '/v1/seen')) {
		const sent = await body(request, 256 * 1024);
		const items = (Array.isArray(sent.add) ? sent.add : [])
			.slice(0, 300)
			.map((i) => ({
				key: text(i?.key, 40),
				title: text(i?.title, 120),
				rating: Number.isFinite(Number(i?.rating)) && i.rating !== null ? Number(i.rating) : null,
				// (Newer Catalogs send these too, for the friend's library and profile.)
				year: text(String(i?.year ?? ''), 4),
				type: i?.type === 'tv' || i?.type === 'movie' ? i.type : '',
				poster: POSTER.test(i?.poster ?? '') ? text(i.poster, 200) : '',
				status: text(i?.status, 20)
			}))
			.filter((i) => SEEN_KEY.test(i.key));
		if (sent.reset === true) await env.DB.batch([env.DB.prepare('DELETE FROM seen WHERE account = ?').bind(account.id), env.DB.prepare('DELETE FROM seen_info WHERE account = ?').bind(account.id)]);
		for (let at = 0; at < items.length; at += 25) {
			const part = items.slice(at, at + 25);
			await env.DB.prepare(`INSERT INTO seen (account, tkey, title, rating) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')} ON CONFLICT (account, tkey) DO UPDATE SET title = excluded.title, rating = excluded.rating`)
				.bind(...part.flatMap((i) => [account.id, i.key, i.title, i.rating]))
				.run();
			// (In parts of 16: 6 values each, and D1 takes at most 100 in one query. 25 at once failed
			// "too many SQL variables" for anyone with more than 16 titles, 4.4.0 to 2026-11-15.)
			const extra = part.filter((i) => i.year || i.type || i.poster || i.status);
			for (let from = 0; from < extra.length; from += 16) {
				const more = extra.slice(from, from + 16);
				await env.DB.prepare(
					`INSERT INTO seen_info (account, tkey, year, type, poster, status) VALUES ${more.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')} ` +
						'ON CONFLICT (account, tkey) DO UPDATE SET year = excluded.year, type = excluded.type, poster = excluded.poster, status = excluded.status'
				)
					.bind(...more.flatMap((i) => [account.id, i.key, i.year, i.type, i.poster, i.status]))
					.run();
			}
		}
		const gone = (Array.isArray(sent.remove) ? sent.remove : []).slice(0, 20).map((k) => text(k, 40));
		for (const key of gone) await env.DB.batch([env.DB.prepare('DELETE FROM seen WHERE account = ? AND tkey = ?').bind(account.id, key), env.DB.prepare('DELETE FROM seen_info WHERE account = ? AND tkey = ?').bind(account.id, key)]);
		return json({ ok: true, kept: items.length });
	}
	if (is('GET', '/v1/seen')) {
		// Which friends have watched a title: by its key ("tmdb:movie:550"), or, for a friend who has
		// it from the other site (an anime from AniList here, TMDB there), by the same name.
		const key = text(url.searchParams.get('key'), 40);
		const title = text(url.searchParams.get('title'), 120);
		const site = key.split(':')[0];
		const rows = await env.DB.prepare(
			'SELECT a.id, a.name, v.rev AS avatar, max(s.rating) AS rating FROM seen s JOIN friends f ON f.b = s.account JOIN accounts a ON a.id = s.account LEFT JOIN avatars v ON v.account = a.id ' +
				"WHERE f.a = ?1 AND s.account NOT IN (SELECT account FROM privacy WHERE hide_profile = 1) AND (s.tkey = ?2 OR (?3 != '' AND s.title = ?3 COLLATE NOCASE AND s.tkey NOT LIKE ?4)) GROUP BY a.id ORDER BY a.name"
		)
			.bind(account.id, key, title, `${site}:%`)
			.all();
		return json({ friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, rating: r.rating ?? null })) });
	}

	/* ---- profiles: what a person says about themselves, their best rated, their library */

	// What this account keeps from its friends (Settings → Online): its profile, its friends.
	if (is('PUT', '/v1/privacy')) {
		const sent = await body(request);
		await env.DB.prepare(
			'INSERT INTO privacy (account, hide_profile, hide_friends) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET hide_profile = excluded.hide_profile, hide_friends = excluded.hide_friends'
		)
			.bind(account.id, sent.hideProfile === true ? 1 : 0, sent.hideFriends === true ? 1 : 0)
			.run();
		return json({ ok: true });
	}

	/** This account itself, or one of its friends (since when, or 0 for itself); null for anyone else. */
	const knownAs = async (them) => {
		if (them === account.id) return { since: 0 };
		const row = await env.DB.prepare('SELECT since FROM friends WHERE a = ? AND b = ?').bind(account.id, them).first();
		return row ? { since: row.since } : null;
	};
	const favoriteFrom = (i) => ({
		key: text(i?.key, 40),
		title: text(i?.title, 120),
		year: text(String(i?.year ?? ''), 4),
		type: i?.type === 'tv' ? 'tv' : 'movie',
		poster: POSTER.test(i?.poster ?? '') ? text(i.poster, 200) : ''
	});

	// This account's own profile: a line or two about itself, up to eight favorites, and a color.
	// (Since 2026-11-15 also `nameStyle` and `banner`: a picture as a data: address, '' takes it
	// away, left out keeps it. Older Catalogs send neither, and nothing of the look changes.)
	if (is('PUT', '/v1/profile')) {
		const sent = await body(request, BANNER_MOST + 40 * 1024);
		const favorites = (Array.isArray(sent.favorites) ? sent.favorites : [])
			.map(favoriteFrom)
			.filter((i) => SEEN_KEY.test(i.key) && i.title)
			.slice(0, 8);
		const color = /^#[0-9a-f]{6}$/i.test(sent.color ?? '') ? sent.color.toLowerCase() : '';
		const banner = typeof sent.banner === 'string' ? sent.banner : null;
		if (banner && (banner.length > BANNER_MOST || !BANNER.test(banner))) return bad(400, "That picture can't be used");
		const writes = [
			env.DB.prepare(
				'INSERT INTO profiles (account, bio, favorites, color, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account) DO UPDATE SET bio = excluded.bio, favorites = excluded.favorites, color = excluded.color, updated = excluded.updated'
			).bind(account.id, text(sent.bio, 300), JSON.stringify(favorites), color, Date.now())
		];
		if ('nameStyle' in sent) {
			const look = lookOf(sent.nameStyle);
			writes.push(
				env.DB.prepare('INSERT INTO looks (account, name_style) VALUES (?, ?) ON CONFLICT (account) DO UPDATE SET name_style = excluded.name_style').bind(account.id, look ? JSON.stringify(look) : '')
			);
		}
		if (banner === '') writes.push(env.DB.prepare('UPDATE looks SET banner = NULL, banner_rev = 0 WHERE account = ?').bind(account.id));
		// (The number is the time in seconds, so it never goes back to one a Catalog kept a picture by.)
		if (banner)
			writes.push(
				env.DB.prepare('INSERT INTO looks (account, banner, banner_rev) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET banner = excluded.banner, banner_rev = excluded.banner_rev').bind(
					account.id,
					banner,
					Math.floor(Date.now() / 1000)
				)
			);
		await env.DB.batch(writes);
		return json({ ok: true });
	}

	// Someone's banner: only for themselves and their friends.
	const bannerOf = path.match(/^\/v1\/banner\/([A-Z0-9]{16})$/);
	if (bannerOf && method === 'GET') {
		if (!(await knownAs(bannerOf[1]))) return bad(403, 'Not a friend');
		const row = await env.DB.prepare('SELECT banner FROM looks WHERE account = ?').bind(bannerOf[1]).first();
		const parts = row?.banner ? BANNER.exec(row.banner) : null;
		if (!parts) return bad(404, 'No banner');
		const bytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
		return new Response(bytes, { headers: { 'Content-Type': `image/${parts[1]}`, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
	}

	const person = path.match(/^\/v1\/people\/([A-Z0-9]{16})\/(profile|library)$/);
	if (person && method === 'GET') {
		const them = person[1];
		const known = await knownAs(them);
		if (!known) return bad(403, 'Not a friend');
		const kept = await privacyOf(them);
		const hidden = them !== account.id && kept.hideProfile;
		if (hidden && person[2] === 'library') return bad(403, 'They keep their library to themselves');
		if (person[2] === 'profile') {
			const [who, about, counts, top, lately, now, mutual] = await env.DB.batch([
				env.DB.prepare(
					'SELECT a.id, a.name, a.created, v.rev AS avatar, l.name_style, l.banner_rev FROM accounts a LEFT JOIN avatars v ON v.account = a.id LEFT JOIN looks l ON l.account = a.id WHERE a.id = ?'
				).bind(them),
				env.DB.prepare('SELECT bio, favorites, color FROM profiles WHERE account = ?').bind(them),
				env.DB.prepare(
					"SELECT count(*) AS total, sum(CASE WHEN i.type = 'movie' THEN 1 ELSE 0 END) AS films, sum(CASE WHEN i.type = 'tv' THEN 1 ELSE 0 END) AS shows, sum(CASE WHEN s.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated " +
						'FROM seen s LEFT JOIN seen_info i ON i.account = s.account AND i.tkey = s.tkey WHERE s.account = ?'
				).bind(them),
				env.DB.prepare(
					'SELECT s.tkey AS key, s.title, s.rating, i.year, i.type, i.poster FROM seen s LEFT JOIN seen_info i ON i.account = s.account AND i.tkey = s.tkey WHERE s.account = ? AND s.rating IS NOT NULL ORDER BY s.rating DESC, s.title LIMIT 12'
				).bind(them),
				env.DB.prepare('SELECT items FROM activity WHERE account = ?').bind(them),
				env.DB.prepare('SELECT what FROM presence WHERE account = ? AND at > ?').bind(them, Date.now() - 3 * MINUTE),
				env.DB.prepare('SELECT count(*) AS n FROM friends f1 JOIN friends f2 ON f2.b = f1.b WHERE f1.a = ? AND f2.a = ?').bind(account.id, them)
			]);
			const row = who.results[0];
			if (!row) return bad(404, 'No such person');
			const said = about.results[0];
			const count = counts.results[0] ?? {};
			let favorites = [];
			let recent = [];
			try {
				favorites = JSON.parse(said?.favorites ?? '[]');
			} catch {}
			try {
				recent = JSON.parse(lately.results[0]?.items ?? '[]').slice(0, 10);
			} catch {}
			// Hidden from friends: who they are, and nothing of what they watch.
			if (hidden)
				return json({
					id: row.id,
					name: row.name,
					avatar: row.avatar ?? 0,
					joined: row.created,
					me: false,
					friendsSince: known.since || null,
					bio: '',
					color: said?.color ?? '',
					nameStyle: lookOf(row.name_style),
					banner: row.banner_rev ?? 0,
					favorites: [],
					counts: { total: 0, films: 0, shows: 0, rated: 0 },
					top: [],
					recent: [],
					watching: null,
					mutual: mutual.results[0]?.n ?? 0,
					hidden: true
				});
			return json({
				id: row.id,
				name: row.name,
				avatar: row.avatar ?? 0,
				joined: row.created,
				me: them === account.id,
				...(them === account.id ? { privacy: kept } : {}),
				friendsSince: known.since || null,
				bio: said?.bio ?? '',
				color: said?.color ?? '',
				nameStyle: lookOf(row.name_style),
				banner: row.banner_rev ?? 0,
				favorites,
				counts: { total: count.total ?? 0, films: count.films ?? 0, shows: count.shows ?? 0, rated: count.rated ?? 0 },
				top: top.results.map((r) => ({ key: r.key, title: r.title, rating: r.rating, year: r.year ?? '', type: r.type || '', poster: r.poster ?? '' })),
				recent,
				watching: now.results[0] ? JSON.parse(now.results[0].what) : null,
				mutual: them === account.id ? 0 : (mutual.results[0]?.n ?? 0)
			});
		}
		// Their library: everything they've watched, a page at a time.
		const sort = url.searchParams.get('sort');
		const order = sort === 'title' ? 's.title COLLATE NOCASE' : sort === 'year' ? "i.year DESC, s.title COLLATE NOCASE" : 's.rating IS NULL, s.rating DESC, s.title COLLATE NOCASE';
		const type = url.searchParams.get('type');
		const kind = type === 'tv' || type === 'movie' ? type : '';
		const find = text(url.searchParams.get('q'), 60);
		const offset = whole(url.searchParams.get('offset'), 0, 100000);
		let where = 's.account = ?';
		const params = [them];
		if (kind) {
			where += ' AND i.type = ?';
			params.push(kind);
		}
		if (find) {
			where += ' AND s.title LIKE ?';
			params.push(`%${find.replace(/[%_]/g, '')}%`);
		}
		const [rows, total] = await env.DB.batch([
			env.DB.prepare(`SELECT s.tkey AS key, s.title, s.rating, i.year, i.type, i.poster, i.status FROM seen s LEFT JOIN seen_info i ON i.account = s.account AND i.tkey = s.tkey WHERE ${where} ORDER BY ${order} LIMIT 120 OFFSET ${offset}`).bind(...params),
			env.DB.prepare(`SELECT count(*) AS n FROM seen s LEFT JOIN seen_info i ON i.account = s.account AND i.tkey = s.tkey WHERE ${where}`).bind(...params)
		]);
		return json({
			total: total.results[0]?.n ?? 0,
			items: rows.results.map((r) => ({ key: r.key, title: r.title, rating: r.rating, year: r.year ?? '', type: r.type || '', poster: r.poster ?? '', status: r.status ?? '' }))
		});
	}

	/* ---- messages: whispers between friends, and a room's chat */

	/** Rooms this account is in now (seen there in the last two minutes). */
	const myRooms = async () =>
		(await env.DB.prepare('SELECT code FROM room_members WHERE account = ? AND at > ?').bind(account.id, Date.now() - 2 * MINUTE).all()).results.map((r) => r.code);
	const messageOut = (r) => ({ id: r.id, from: r.from_account, name: r.name ?? '', avatar: r.avatar ?? 0, to: r.to_account, room: r.room, text: r.body, at: r.at });
	const MESSAGE_FIELDS = 'm.id, m.from_account, m.to_account, m.room, m.body, m.at, a.name, v.rev AS avatar FROM messages m JOIN accounts a ON a.id = m.from_account LEFT JOIN avatars v ON v.account = m.from_account';
	/** Whispers not read yet, from everyone. */
	const unreadCount = async () =>
		(
			await env.DB.prepare('SELECT count(*) AS n FROM messages m LEFT JOIN message_reads r ON r.account = ?1 AND r.other = m.from_account WHERE m.to_account = ?1 AND m.id > COALESCE(r.last, 0)')
				.bind(account.id)
				.first()
		)?.n ?? 0;
	/** Where things stand: the newest message id (a Catalog starting up shows nothing old as new). */
	const newestMessage = async () => (await env.DB.prepare('SELECT max(id) AS id FROM messages').first())?.id ?? 0;
	/**
	 * What came for this account after message `after`: whispers to it, and lines in the rooms it's
	 * in, from others. (`after` 0 is everything: no message had been sent when it last looked.)
	 */
	const newMessages = async (after, rooms) => {
		const marks = rooms.map((_, n) => `?${n + 3}`).join(', ');
		const rows = await env.DB.prepare(
			`SELECT ${MESSAGE_FIELDS} WHERE m.id > ?1 AND m.from_account != ?2 AND (m.to_account = ?2${rooms.length ? ` OR m.room IN (${marks})` : ''}) ORDER BY m.id LIMIT 50`
		)
			.bind(after, account.id, ...rooms)
			.all();
		const list = rows.results.map(messageOut);
		return { messages: list, last: list.length ? list[list.length - 1].id : after };
	};

	if (is('POST', '/v1/messages')) {
		const sent = await body(request, 8 * 1024);
		const said = text(sent.text, MESSAGE_MOST);
		if (!said) return bad(400, 'Say what?');
		const to = ACCOUNT_ID.test(sent.to ?? '') ? sent.to : '';
		const roomCode = /^[A-Z0-9]{6}$/.test(sent.room ?? '') ? sent.room : '';
		if (!to && !roomCode) return bad(400, 'To whom?');
		if (to && !(to !== account.id && (await knownAs(to)))) return bad(403, 'Only friends can be sent messages');
		if (roomCode && !(await env.DB.prepare('SELECT 1 FROM room_members WHERE code = ? AND account = ?').bind(roomCode, account.id).first())) return bad(403, 'Join the room first');
		if (!(await allowed(env, `message:${account.id}`, 600))) return bad(429, 'Enough messages for today');
		const now = Date.now();
		const row = await env.DB.prepare('INSERT INTO messages (from_account, to_account, room, body, at) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(account.id, to, to ? '' : roomCode, said, now).first();
		// (Writing to someone counts as having read what they'd sent.)
		if (to) await env.DB.prepare('INSERT INTO message_reads (account, other, last) VALUES (?, ?, ?) ON CONFLICT (account, other) DO UPDATE SET last = max(last, excluded.last)').bind(account.id, to, row.id).run();
		return json({ ok: true, message: { id: row.id, from: account.id, name: account.name, avatar: account.avatar ?? 0, to, room: to ? '' : roomCode, text: said, at: now } });
	}
	if (is('GET', '/v1/messages')) {
		// No `after` (or an empty one): a first look, only where things stand.
		const asked = url.searchParams.get('after');
		if (!asked) return json({ messages: [], last: await newestMessage(), unread: await unreadCount() });
		const found = await newMessages(whole(asked, 0, Number.MAX_SAFE_INTEGER), await myRooms());
		return json({ ...found, unread: await unreadCount() });
	}
	// Everyone this account has whispered with (and every friend), newest first, with what's unread.
	if (is('GET', '/v1/messages/threads')) {
		const rows = await env.DB.prepare(
			'SELECT a.id, a.name, v.rev AS avatar, ' +
				'(SELECT max(m.id) FROM messages m WHERE (m.from_account = ?1 AND m.to_account = a.id) OR (m.from_account = a.id AND m.to_account = ?1)) AS lastId, ' +
				'(SELECT count(*) FROM messages m WHERE m.from_account = a.id AND m.to_account = ?1 AND m.id > COALESCE((SELECT last FROM message_reads r WHERE r.account = ?1 AND r.other = a.id), 0)) AS unread ' +
				'FROM friends f JOIN accounts a ON a.id = f.b LEFT JOIN avatars v ON v.account = a.id WHERE f.a = ?1'
		)
			.bind(account.id)
			.all();
		const ids = rows.results.map((r) => r.lastId).filter(Boolean);
		const last = new Map();
		if (ids.length) {
			const found = await env.DB.prepare(`SELECT id, from_account, body, at FROM messages WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
			for (const m of found.results) last.set(m.id, m);
		}
		const threads = rows.results
			.map((r) => {
				const m = last.get(r.lastId);
				return { id: r.id, name: r.name, avatar: r.avatar ?? 0, unread: r.unread ?? 0, last: m ? { text: m.body, at: m.at, mine: m.from_account === account.id } : null };
			})
			.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0) || a.name.localeCompare(b.name));
		return json({ threads, unread: threads.reduce((n, t) => n + t.unread, 0) });
	}
	const withWhom = path.match(/^\/v1\/messages\/with\/([A-Z0-9]{16})$/);
	if (withWhom && method === 'GET') {
		const them = withWhom[1];
		if (them === account.id || !(await knownAs(them))) return bad(403, 'Not a friend');
		const before = whole(url.searchParams.get('before'), 0, Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER;
		const rows = await env.DB.prepare(
			`SELECT ${MESSAGE_FIELDS} WHERE m.id < ?3 AND ((m.from_account = ?1 AND m.to_account = ?2) OR (m.from_account = ?2 AND m.to_account = ?1)) ORDER BY m.id DESC LIMIT 60`
		)
			.bind(account.id, them, before)
			.all();
		return json({ messages: rows.results.map(messageOut).reverse(), more: rows.results.length === 60 });
	}
	if (is('POST', '/v1/messages/read')) {
		const sent = await body(request);
		const other = ACCOUNT_ID.test(sent.with ?? '') ? sent.with : '';
		const upto = whole(sent.upto, 0, Number.MAX_SAFE_INTEGER);
		if (!other || !upto) return bad(400, 'Read what?');
		await env.DB.prepare('INSERT INTO message_reads (account, other, last) VALUES (?, ?, ?) ON CONFLICT (account, other) DO UPDATE SET last = max(last, excluded.last)').bind(account.id, other, upto).run();
		return json({ ok: true, unread: await unreadCount() });
	}

	/* ---- watching together */

	const roomOf = async (code) => env.DB.prepare('SELECT code, host, state, rev, updated FROM rooms WHERE code = ?').bind(code).first();
	const inRoom = async (code) => Boolean(await env.DB.prepare('SELECT 1 FROM room_members WHERE code = ? AND account = ?').bind(code, account.id).first());
	/** Who's in a room now (seen in the last two minutes). */
	const peopleIn = async (code) => {
		const people = await env.DB.prepare('SELECT m.account, m.name, m.at, v.rev AS avatar FROM room_members m LEFT JOIN avatars v ON v.account = m.account WHERE m.code = ? AND m.at > ? ORDER BY m.name').bind(code, Date.now() - 2 * MINUTE).all();
		return people.results.map((p) => ({ id: p.account, name: p.name, avatar: p.avatar ?? 0, me: p.account === account.id }));
	};
	/**
	 * With `?msg=<id>` (newer Catalogs): the room's chat and whispers after that message ride along
	 * with the answer, so a screen in a room asks nothing more for them. `msg=` (empty: just joined,
	 * or nothing known yet): the room's last 30 lines, and where things stand.
	 */
	const chatFor = async (code) => {
		const asked = url.searchParams.get('msg');
		if (asked === null) return {};
		if (asked !== '') return { chat: await newMessages(whole(asked, 0, Number.MAX_SAFE_INTEGER), [code]) };
		const [history, newest] = await env.DB.batch([
			env.DB.prepare(`SELECT ${MESSAGE_FIELDS} WHERE m.room = ? ORDER BY m.id DESC LIMIT 30`).bind(code),
			env.DB.prepare('SELECT max(id) AS id FROM messages')
		]);
		return { chat: { messages: [], history: history.results.map(messageOut).reverse(), last: newest.results[0]?.id ?? 0 } };
	};
	const roomAnswer = async (room) =>
		json({ code: room.code, host: room.host === account.id, state: JSON.parse(room.state), rev: room.rev, now: Date.now(), people: await peopleIn(room.code), ...(await chatFor(room.code)) });
	/** What's playing and where: `at` is this server's clock when it was said, so each house works out "now". */
	const stateFrom = (sent, by) => ({
		title: text(sent.title, 120),
		type: sent.type === 'tv' ? 'tv' : 'movie',
		year: text(String(sent.year ?? ''), 4),
		season: whole(sent.season, 0, 999),
		episode: whole(sent.episode, 0, 9999),
		playing: sent.playing === true,
		position: Math.max(0, Math.min(86400, Number(sent.position) || 0)),
		// Paused by the player itself, not the person (changing to a sharper copy, say): why, in a few words.
		waiting: sent.playing === true ? '' : text(sent.waiting, 60),
		at: Date.now(),
		by
	});
	if (is('POST', '/v1/rooms')) {
		const sent = await body(request);
		const code = random(6);
		const now = Date.now();
		await env.DB.batch([
			env.DB.prepare('INSERT INTO rooms (code, host, state, rev, updated) VALUES (?, ?, ?, 1, ?)').bind(code, account.id, JSON.stringify(stateFrom(sent, account.name)), now),
			env.DB.prepare('INSERT INTO room_members (code, account, name, at) VALUES (?, ?, ?, ?)').bind(code, account.id, account.name, now)
		]);
		return roomAnswer(await roomOf(code));
	}
	const room = path.match(/^\/v1\/rooms\/([A-Z0-9]{6})(\/join|\/state|\/leave)?$/);
	if (room) {
		const code = room[1];
		const found = await roomOf(code);
		if (!found) return bad(404, 'No such room (it may have ended)');
		if (room[2] === '/join' && method === 'POST') {
			if (!(await allowed(env, `code:${house.id}`, 40))) return bad(429, 'Too many tries today');
			await env.DB.prepare('INSERT INTO room_members (code, account, name, at) VALUES (?, ?, ?, ?) ON CONFLICT (code, account) DO UPDATE SET name = excluded.name, at = excluded.at').bind(code, account.id, account.name, Date.now()).run();
			return roomAnswer(found);
		}
		if (!(await inRoom(code))) return bad(403, 'Join the room first');
		if (room[2] === '/leave' && method === 'POST') {
			await env.DB.prepare('DELETE FROM room_members WHERE code = ? AND account = ?').bind(code, account.id).run();
			return json({ ok: true });
		}
		if (room[2] === '/state' && method === 'PUT') {
			const sent = await body(request);
			await env.DB.batch([
				env.DB.prepare('UPDATE rooms SET state = ?, rev = rev + 1, updated = ? WHERE code = ?').bind(JSON.stringify(stateFrom(sent, account.name)), Date.now(), code),
				env.DB.prepare('UPDATE room_members SET at = ? WHERE code = ? AND account = ?').bind(Date.now(), code, account.id)
			]);
			return roomAnswer(await roomOf(code));
		}
		if (!room[2] && method === 'GET') {
			const now = Date.now();
			// Still here: written only once it's 20 s old, so asking every second or two costs few writes.
			// (It was 1 ask in 12 by chance: someone alone, asking every 8 s, could miss two minutes and drop off the room.)
			await env.DB.prepare('UPDATE room_members SET at = ? WHERE code = ? AND account = ? AND at < ?').bind(now, code, account.id, now - 20 * 1000).run();
			if (Number(url.searchParams.get('rev')) === found.rev) {
				// Nothing new playing, but maybe someone came or went: `people` is who the asker has (ids,
				// comma-separated). The rev only moves with what's playing, so a host never saw who joined.
				const known = url.searchParams.get('people');
				const chat = await chatFor(code);
				if (known === null) return json({ same: true, rev: found.rev, now, ...chat });
				const people = await peopleIn(code);
				const ids = people.map((p) => p.id).sort().join(',');
				return ids === known.split(',').filter(Boolean).sort().join(',') ? json({ same: true, rev: found.rev, now, ...chat }) : json({ same: true, rev: found.rev, now, people, ...chat });
			}
			return roomAnswer(found);
		}
	}

	/* ---- problem reports */

	if (is('POST', '/v1/reports')) {
		const sent = await body(request, 200 * 1024);
		if (!(await allowed(env, `report:${house.id}`, 40))) return bad(429, 'Enough reports for today');
		const what = typeof sent.body === 'string' ? sent.body : JSON.stringify(sent.body ?? {});
		await env.DB.prepare('INSERT INTO reports (house, house_name, kind, title, body, created) VALUES (?, ?, ?, ?, ?, ?)').bind(house.id, house.name, text(sent.kind, 30) || 'other', text(sent.title, 160), what.slice(0, 150_000), Date.now()).run();
		return json({ ok: true });
	}

	/* ---- work shared between houses */

	const shared = path.match(/^\/v1\/shared\/([a-z]+)$/);
	if (shared && SHARED_KINDS.includes(shared[1])) {
		if (method === 'GET') {
			const row = await env.DB.prepare('SELECT value, updated FROM shared WHERE kind = ? AND skey = ?').bind(shared[1], text(url.searchParams.get('key'), 200)).first();
			return json(row ? { value: JSON.parse(row.value), updated: row.updated } : { value: null });
		}
		if (method === 'PUT') {
			const sent = await body(request);
			const key = text(sent.key, 200);
			const value = JSON.stringify(sent.value ?? null);
			if (!key || value.length > 8000) return bad(400, 'Too big, or no key');
			if (!(await allowed(env, `shared:${house.id}`, 3000))) return bad(429, 'Enough for today');
			await env.DB.prepare('INSERT INTO shared (kind, skey, value, house, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, skey) DO UPDATE SET value = excluded.value, house = excluded.house, updated = excluded.updated')
				.bind(shared[1], key, value, house.id, Date.now())
				.run();
			return json({ ok: true });
		}
	}

	/* ---- a TV finding its computer by a short code */

	if (is('PUT', '/v1/pair')) {
		const sent = await body(request);
		const addresses = (Array.isArray(sent.addresses) ? sent.addresses : []).map((a) => text(a, 60)).filter((a) => /^https?:\/\/[\w.\-:[\]]+$/.test(a)).slice(0, 6);
		if (!addresses.length) return bad(400, 'No address');
		if (!(await allowed(env, `pairs:${house.id}`, 200))) return bad(429, 'Enough for today');
		await env.DB.prepare('DELETE FROM pairs WHERE house = ?').bind(house.id).run();
		for (let tries = 0; tries < 5; tries++) {
			const code = random(6, '0123456789');
			const made = await env.DB.prepare('INSERT OR IGNORE INTO pairs (code, house, what, expires) VALUES (?, ?, ?, ?)').bind(code, house.id, JSON.stringify({ name: text(sent.name, 40), addresses }), Date.now() + 15 * MINUTE).run();
			if (made.meta.changes) return json({ code, minutes: 15 });
		}
		return bad(503, 'Try again');
	}

	/* ---- an account's library and progress, in step between its computers */

	if (path === '/v1/sync' && method === 'GET') {
		const since = Number(url.searchParams.get('since')) || 0;
		// ?kind=entry: only that kind (the library), so a big library doesn't come with all the progress too.
		const kind = text(url.searchParams.get('kind'), 20);
		const rows = /^[a-z]+$/.test(kind)
			? await env.DB.prepare('SELECT kind, skey AS key, value, updated, rev FROM sync_rows WHERE account = ? AND kind = ? AND rev > ? ORDER BY rev LIMIT 1000').bind(account.id, kind, since).all()
			: await env.DB.prepare('SELECT kind, skey AS key, value, updated, rev FROM sync_rows WHERE account = ? AND rev > ? ORDER BY rev LIMIT 1000').bind(account.id, since).all();
		let list = rows.results;
		const more = list.length === 1000;
		// Rows sent together share one rev: a page never ends partway through one (the next page
		// asks for revs after this page's last, so the rest of it would be skipped).
		if (more) {
			const last = list[list.length - 1].rev;
			const whole = list.filter((r) => r.rev !== last);
			if (whole.length) list = whole;
		}
		return json({ rows: list.map((r) => ({ kind: r.kind, key: r.key, value: JSON.parse(r.value), updated: r.updated, rev: r.rev })), rev: list.length ? list[list.length - 1].rev : since, more });
	}
	if (path === '/v1/sync' && method === 'PUT') {
		const sent = await body(request, 900 * 1024);
		const rows = (Array.isArray(sent.rows) ? sent.rows : [])
			.slice(0, 400)
			.map((r) => ({ kind: text(r?.kind, 20), key: text(r?.key, 300), value: JSON.stringify(r?.value ?? null), updated: Number(r?.updated) || 0 }))
			.filter((r) => /^[a-z]+$/.test(r.kind) && r.key && r.value.length <= (r.kind === 'entry' ? ENTRY_MOST : 4000) && r.updated > 0 && r.updated < Date.now() + DAY);
		if (!rows.length) return json({ ok: true, rev: account.rev });
		const next = await env.DB.prepare('UPDATE accounts SET rev = rev + 1 WHERE id = ? RETURNING rev').bind(account.id).first();
		for (let at = 0; at < rows.length; at += 16) {
			const part = rows.slice(at, at + 16);
			// Only a newer change replaces what's kept: two computers changing the same thing, the later one wins.
			await env.DB.prepare(
				`INSERT INTO sync_rows (account, kind, skey, value, updated, rev) VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')} ` +
					'ON CONFLICT (account, kind, skey) DO UPDATE SET value = excluded.value, updated = excluded.updated, rev = excluded.rev WHERE excluded.updated > sync_rows.updated'
			)
				.bind(...part.flatMap((r) => [account.id, r.kind, r.key, r.value, r.updated, next.rev]))
				.run();
		}
		return json({ ok: true, rev: next.rev });
	}

	return bad(404, 'No such address');
}

export default {
	async fetch(request, env, ctx) {
		try {
			return await answer(request, env, ctx);
		} catch (problem) {
			if (problem instanceof Problem) return bad(problem.status, problem.message);
			console.error(problem);
			return bad(500, 'Something went wrong here');
		}
	}
};
