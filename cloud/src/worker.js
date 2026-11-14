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

/** Old leftovers go, now and then. */
async function tidy(env) {
	const now = Date.now();
	await env.DB.batch([
		env.DB.prepare('DELETE FROM codes WHERE expires < ?').bind(now),
		env.DB.prepare('DELETE FROM pairs WHERE expires < ?').bind(now),
		env.DB.prepare('DELETE FROM presence WHERE at < ?').bind(now - 6 * HOUR),
		env.DB.prepare('DELETE FROM room_members WHERE code IN (SELECT code FROM rooms WHERE updated < ?)').bind(now - 12 * HOUR),
		env.DB.prepare('DELETE FROM rooms WHERE updated < ?').bind(now - 12 * HOUR),
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
		if (!env.ADMIN_KEY || !same(await sha256(request.headers.get('X-Catalog-Admin') ?? ''), await sha256(env.ADMIN_KEY))) return bad(403, 'Not the owner');
		const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
		const brief = url.searchParams.get('full') !== '1';
		const rows = await env.DB.prepare(`SELECT id, house, house_name AS houseName, kind, title, ${brief ? 'substr(body, 1, 400) AS body' : 'body'}, created FROM reports WHERE id < ? ORDER BY id DESC LIMIT ?`)
			.bind(before, brief ? 100 : 20)
			.all();
		return json({ reports: rows.results });
	}
	const reportId = path.match(/^\/v1\/reports\/(\d+)$/);
	if (reportId && (method === 'GET' || method === 'DELETE')) {
		if (!env.ADMIN_KEY || !same(await sha256(request.headers.get('X-Catalog-Admin') ?? ''), await sha256(env.ADMIN_KEY))) return bad(403, 'Not the owner');
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
				['DELETE FROM friends WHERE a = ?1 OR b = ?1', 'DELETE FROM seen WHERE account = ?1', 'DELETE FROM presence WHERE account = ?1', 'DELETE FROM avatars WHERE account = ?1', 'DELETE FROM sync_rows WHERE account = ?1', 'DELETE FROM codes WHERE account = ?1', 'DELETE FROM accounts WHERE id = ?1'].map((sql) => env.DB.prepare(sql).bind(account.id))
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

	if (is('POST', '/v1/friends/code')) {
		const code = random(8);
		await env.DB.prepare("INSERT INTO codes (code, kind, account, expires) VALUES (?, 'friend', ?, ?)").bind(code, account.id, Date.now() + DAY).run();
		return json({ code, hours: 24 });
	}
	if (is('POST', '/v1/friends/add')) {
		const sent = await body(request);
		if (!(await allowed(env, `code:${house.id}`, 40))) return bad(429, 'Too many tries today');
		const row = await useCode(env, sent.code, 'friend');
		if (!row) return bad(404, "That code isn't right, or it ran out");
		if (row.account === account.id) return bad(400, "That's your own code");
		const now = Date.now();
		await env.DB.batch([
			env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(account.id, row.account, now),
			env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, since) VALUES (?, ?, ?)').bind(row.account, account.id, now)
		]);
		const friend = await env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(row.account).first();
		return json({ ok: true, name: friend?.name ?? '' });
	}
	if (is('GET', '/v1/friends')) {
		const rows = await env.DB.prepare(
			'SELECT a.id, a.name, v.rev AS avatar, p.what, p.at FROM friends f JOIN accounts a ON a.id = f.b LEFT JOIN avatars v ON v.account = a.id LEFT JOIN presence p ON p.account = f.b AND p.at > ? WHERE f.a = ? ORDER BY a.name'
		)
			.bind(Date.now() - 3 * MINUTE, account.id)
			.all();
		return json({ me: publicAccount(account), friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, watching: r.what ? JSON.parse(r.what) : null, at: r.at ?? null })) });
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
		const items = (Array.isArray(sent.add) ? sent.add : []).slice(0, 300).map((i) => ({ key: text(i?.key, 40), title: text(i?.title, 120), rating: Number.isFinite(Number(i?.rating)) && i.rating !== null ? Number(i.rating) : null })).filter((i) => SEEN_KEY.test(i.key));
		if (sent.reset === true) await env.DB.prepare('DELETE FROM seen WHERE account = ?').bind(account.id).run();
		for (let at = 0; at < items.length; at += 25) {
			const part = items.slice(at, at + 25);
			await env.DB.prepare(`INSERT INTO seen (account, tkey, title, rating) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')} ON CONFLICT (account, tkey) DO UPDATE SET title = excluded.title, rating = excluded.rating`)
				.bind(...part.flatMap((i) => [account.id, i.key, i.title, i.rating]))
				.run();
		}
		const gone = (Array.isArray(sent.remove) ? sent.remove : []).slice(0, 20).map((k) => text(k, 40));
		for (const key of gone) await env.DB.prepare('DELETE FROM seen WHERE account = ? AND tkey = ?').bind(account.id, key).run();
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
				"WHERE f.a = ?1 AND (s.tkey = ?2 OR (?3 != '' AND s.title = ?3 COLLATE NOCASE AND s.tkey NOT LIKE ?4)) GROUP BY a.id ORDER BY a.name"
		)
			.bind(account.id, key, title, `${site}:%`)
			.all();
		return json({ friends: rows.results.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar ?? 0, rating: r.rating ?? null })) });
	}

	/* ---- watching together */

	const roomOf = async (code) => env.DB.prepare('SELECT code, host, state, rev, updated FROM rooms WHERE code = ?').bind(code).first();
	const inRoom = async (code) => Boolean(await env.DB.prepare('SELECT 1 FROM room_members WHERE code = ? AND account = ?').bind(code, account.id).first());
	const roomAnswer = async (room) => {
		const people = await env.DB.prepare('SELECT m.account, m.name, m.at, v.rev AS avatar FROM room_members m LEFT JOIN avatars v ON v.account = m.account WHERE m.code = ? AND m.at > ? ORDER BY m.name').bind(room.code, Date.now() - 2 * MINUTE).all();
		return json({ code: room.code, host: room.host === account.id, state: JSON.parse(room.state), rev: room.rev, now: Date.now(), people: people.results.map((p) => ({ id: p.account, name: p.name, avatar: p.avatar ?? 0, me: p.account === account.id })) });
	};
	/** What's playing and where: `at` is this server's clock when it was said, so each house works out "now". */
	const stateFrom = (sent, by) => ({
		title: text(sent.title, 120),
		type: sent.type === 'tv' ? 'tv' : 'movie',
		year: text(String(sent.year ?? ''), 4),
		season: whole(sent.season, 0, 999),
		episode: whole(sent.episode, 0, 9999),
		playing: sent.playing === true,
		position: Math.max(0, Math.min(86400, Number(sent.position) || 0)),
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
			// (Still here: noted at most every 20 s, so asking every second or two costs no writes.)
			if (Math.random() < 0.08) await env.DB.prepare('UPDATE room_members SET at = ? WHERE code = ? AND account = ?').bind(Date.now(), code, account.id).run();
			if (Number(url.searchParams.get('rev')) === found.rev) return json({ same: true, rev: found.rev, now: Date.now() });
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
