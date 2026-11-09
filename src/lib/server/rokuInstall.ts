import { createHash, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * Putting Catalog on a Roku from Settings → TV, instead of the Roku's own developer page in a
 * browser. A Roku only takes apps from outside its store in developer mode: its remote turns that
 * on and sets a password (the owner types it into Catalog each time; it's never kept). Then:
 *   - Rokus on the home network answer an SSDP search ("roku:ecp") with their address;
 *   - each one's device-info (port 8060, no password) says its name and whether developer mode is on;
 *   - the zip goes to http://<roku>/plugin_install (user "rokudev", digest sign-in), as the
 *     developer page's own form sends it;
 *   - then Catalog opens on the TV (ECP /launch/dev).
 * Installing again replaces the old copy and keeps what it saved (the computer it found).
 */

export type FoundRoku = { address: string; name: string; model: string; developerMode: boolean };

const SSDP = { host: '239.255.255.250', port: 1900 };
const SEARCH_MS = 2500;

/** Only addresses on the home network (the Roku's own page is never reached outside it). */
export function isHomeAddress(address: string): boolean {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	if (m.slice(1).some((n) => Number(n) > 255)) return false;
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim() ?? '';

/** One Roku's name, model and developer mode, from its device-info. Null when it isn't a Roku. */
export async function rokuInfo(address: string): Promise<FoundRoku | null> {
	try {
		const resp = await fetch(`http://${address}:8060/query/device-info`, { signal: AbortSignal.timeout(3000) });
		if (!resp.ok) return null;
		const xml = await resp.text();
		if (!xml.includes('<device-info')) return null;
		return {
			address,
			name: tag(xml, 'user-device-name') || tag(xml, 'friendly-device-name') || tag(xml, 'default-device-name') || 'Roku',
			model: tag(xml, 'friendly-model-name') || tag(xml, 'model-name'),
			developerMode: tag(xml, 'developer-enabled') === 'true'
		};
	} catch {
		return null;
	}
}

/** The Rokus on the home network (asks for 2.5 s). */
export async function findRokus(): Promise<FoundRoku[]> {
	const addresses = await new Promise<Set<string>>((resolve) => {
		const found = new Set<string>();
		const socket = createSocket({ type: 'udp4', reuseAddr: true });
		const done = () => {
			try {
				socket.close();
			} catch {}
			resolve(found);
		};
		socket.on('message', (message) => {
			const location = /^location:\s*http:\/\/([\d.]+):8060/im.exec(message.toString())?.[1];
			if (location && isHomeAddress(location)) found.add(location);
		});
		socket.on('error', done);
		socket.bind(0, () => {
			const ask = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHost: ${SSDP.host}:${SSDP.port}\r\nMan: "ssdp:discover"\r\nST: roku:ecp\r\nMX: 2\r\n\r\n`);
			// Asked twice: one UDP packet can be lost on Wi-Fi.
			socket.send(ask, SSDP.port, SSDP.host);
			setTimeout(() => socket.send(ask, SSDP.port, SSDP.host), 700);
		});
		setTimeout(done, SEARCH_MS);
	});
	const rokus = await Promise.all([...addresses].map(rokuInfo));
	return rokus.filter((r): r is FoundRoku => r !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** The Roku app's zip, as built by `npm run roku`: in the build's client folder, or the project's static/. */
function rokuZip(): Buffer | null {
	const candidates = [join(dirname(process.argv[1] ?? ''), 'client', 'catalog-roku.zip'), join(process.cwd(), 'static', 'catalog-roku.zip')];
	const path = candidates.find((p) => existsSync(p));
	return path ? readFileSync(path) : null;
}

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/** The Authorization header answering a digest challenge (the Roku's developer page uses one). */
function digestHeader(challenge: string, method: string, uri: string, user: string, password: string): string {
	const part = (name: string) => new RegExp(`${name}="?([^",]+)"?`, 'i').exec(challenge)?.[1] ?? '';
	const realm = part('realm');
	const nonce = part('nonce');
	const qop = part('qop').split(',')[0]?.trim();
	const cnonce = randomBytes(8).toString('hex');
	const nc = '00000001';
	const ha1 = md5(`${user}:${realm}:${password}`);
	const ha2 = md5(`${method}:${uri}`);
	const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
	const fields = [`username="${user}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`, `response="${response}"`];
	if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
	const opaque = part('opaque');
	if (opaque) fields.push(`opaque="${opaque}"`);
	return `Digest ${fields.join(', ')}`;
}

/** What the Roku's page said, in a few words: its messages (newer Rokus) or its red/plain text (older ones). */
function rokuSaid(html: string): string {
	const messages = [...html.matchAll(/"text"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
	if (messages.length) return messages.join(' ');
	const font = [...html.matchAll(/<font[^>]*>([^<]+)<\/font>/gi)].map((m) => m[1].trim()).filter(Boolean);
	return font.join(' ');
}

export type InstallAnswer = { ok: boolean; message: string };

/** Only for trying it against a pretend Roku on this computer: the real developer page is on port 80. */
const testPort = Number(process.env.CATALOG_ROKU_TEST_PORT) || 0;

/** The developer page's install form, as one finished body (a known length, never sent in chunks). */
function installForm(zip: Buffer): { body: Buffer; type: string } {
	const boundary = `----CatalogRoku${randomBytes(12).toString('hex')}`;
	const line = '\r\n';
	const head =
		`--${boundary}${line}Content-Disposition: form-data; name="mysubmit"${line}${line}Install${line}` +
		`--${boundary}${line}Content-Disposition: form-data; name="archive"; filename="catalog-roku.zip"${line}Content-Type: application/zip${line}${line}`;
	const body = Buffer.concat([Buffer.from(head), zip, Buffer.from(`${line}--${boundary}--${line}`)]);
	return { body, type: `multipart/form-data; boundary=${boundary}` };
}

type RokuReply = { status: number; headers: IncomingHttpHeaders; text: string };

/**
 * One request to the Roku's developer page, on a connection of its own.
 *
 * - A new connection every time (`agent: false`, "Connection: close"). Node reuses connections by
 *   default, so the upload went down the connection the sign-in question had used; the Roku had
 *   already finished with that one and hung up: "stopped answering partway (ECONNRESET)" on every
 *   try (owner, 2026-11-08).
 * - Loosely written replies are accepted (`insecureHTTPParser`): fetch turns away any reply a small
 *   built-in web server gets slightly wrong.
 * - If the Roku answers and then hangs up before the upload is all sent, its answer still counts.
 */
function rokuRequest(url: string, method: 'GET' | 'POST', headers: Record<string, string | number>, body: Buffer | null, timeout: number): Promise<RokuReply> {
	return new Promise((resolve, reject) => {
		let reply: RokuReply | null = null;
		const req = httpRequest(url, { method, headers: { ...headers, Connection: 'close' }, agent: false, insecureHTTPParser: true, timeout }, (res) => {
			const parts: Buffer[] = [];
			reply = { status: res.statusCode ?? 0, headers: res.headers, text: '' };
			const finish = () => resolve({ ...reply!, text: Buffer.concat(parts).toString('utf8') });
			res.on('data', (part: Buffer) => parts.push(part));
			res.on('end', finish);
			res.on('error', finish);
		});
		req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
		req.on('error', (error) => (reply ? resolve(reply) : reject(error)));
		req.end(body ?? undefined);
	});
}

/** Why a request to the Roku failed, in words. */
function whyUnreachable(error: unknown): string {
	const code = String((error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code ?? (error as { name?: string })?.name ?? '');
	if (code === 'ECONNREFUSED') return "The Roku turned the connection down. Developer mode may have switched off: turn it on again with the remote, then try.";
	if (/TIMEOUT|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|TimeoutError/i.test(code)) return "Couldn't reach the Roku. Is it on, and on the same Wi-Fi as this computer?";
	return `The Roku stopped answering partway (${code || 'no reason given'}). Try again.`;
}

/**
 * Installs Catalog on the Roku at `address` with its developer password, then opens it.
 *
 * Steps, each on a new connection: ask the sign-in question with an empty request; check the
 * password with a small signed request (so a wrong one is said plainly, not lost in a hang-up
 * mid-upload); ask a fresh question; send the app once, signed in, with a known length. A hang-up
 * during the upload is tried once more. It used to say "Couldn't reach the Roku" for everything,
 * then "stopped answering partway (ECONNRESET)" every time (both owner, 2026-11-08; see
 * rokuRequest).
 */
export async function installOnRoku(address: string, password: string): Promise<InstallAnswer> {
	const port = testPort || 80;
	if (!isHomeAddress(address) && !(testPort && address === '127.0.0.1')) return { ok: false, message: "That isn't an address on this home network." };
	const zip = rokuZip();
	if (!zip) return { ok: false, message: "The Roku app isn't in this copy of Catalog." };
	const uri = '/plugin_install';
	const url = `http://${address}${port === 80 ? '' : `:${port}`}${uri}`;
	const form = installForm(zip);
	const challengeOf = (reply: RokuReply) => {
		const value = reply.headers['www-authenticate'];
		return reply.status === 401 ? String(Array.isArray(value) ? value[0] : (value ?? '')) : '';
	};
	/** The Roku's sign-in question (empty when it asks none). */
	const askChallenge = async () => challengeOf(await rokuRequest(url, 'GET', {}, null, 10_000));
	const signed = (challenge: string, method: 'GET' | 'POST'): Record<string, string> =>
		/digest/i.test(challenge) ? { Authorization: digestHeader(challenge, method, uri, 'rokudev', password) } : {};
	const send = (challenge: string) =>
		rokuRequest(url, 'POST', { 'Content-Type': form.type, 'Content-Length': form.body.length, ...signed(challenge, 'POST') }, form.body, 90_000);
	try {
		let challenge = '';
		try {
			challenge = await askChallenge();
		} catch (error) {
			return { ok: false, message: whyUnreachable(error) };
		}
		if (challenge) {
			const check = await rokuRequest(url, 'GET', signed(challenge, 'GET'), null, 10_000);
			if (check.status === 401) return { ok: false, message: "The Roku didn't accept that password." };
			challenge = await askChallenge();
		}
		let resp: RokuReply;
		try {
			resp = await send(challenge);
		} catch (error) {
			if ((error as { code?: string })?.code !== 'ECONNRESET') throw error;
			resp = await send(await askChallenge());
		}
		// (A Roku that wanted a fresh challenge for the upload itself: answered once more.)
		const again = challengeOf(resp);
		if (/digest/i.test(again)) resp = await send(again);
		if (resp.status === 401) return { ok: false, message: "The Roku didn't accept that password." };
		const said = rokuSaid(resp.text);
		if (resp.status < 200 || resp.status >= 300) return { ok: false, message: said || `The Roku answered ${resp.status}.` };
		if (/install success|identical to previous version/i.test(said)) {
			await fetch(`http://${address}:8060/launch/dev`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => null);
			return { ok: true, message: /identical/i.test(said) ? 'Catalog was already up to date on this Roku. Opening it.' : 'Installed. Catalog is opening on the TV.' };
		}
		return { ok: false, message: said || "The Roku didn't say whether it installed." };
	} catch (error) {
		return { ok: false, message: whyUnreachable(error) };
	}
}
