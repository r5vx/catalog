// Tries src/lib/server/adb.ts against a pretend Fire TV on this computer (no real TV needed):
// the pretend TV checks each message's sum and flipped command, decodes the public key Catalog
// sends in Android's own layout (checking -1/n and R² mod n the way Android uses them), checks the
// signed puzzle with that key exactly as Android does (PKCS#1 v1.5 over a SHA-1 wrapping), plays
// "Allow" being pressed, then takes the copied file and the install command.
//   node scripts/dev/firetv-adb-test.mjs
import net, { createServer } from 'node:net';
import { createPublicKey, publicDecrypt, constants, randomBytes } from 'node:crypto';
import { AdbConnection, AdbError, newAdbKey, packet, sha1 } from '../../src/lib/server/adb.ts';

let failed = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

const C = { CNXN: 0x4e584e43, AUTH: 0x48545541, OPEN: 0x4e45504f, OKAY: 0x59414b4f, CLSE: 0x45534c43, WRTE: 0x45545257 };
const PREFIX = Buffer.from('3021300906052b0e03021a05000414', 'hex');
const toBig = (buf) => BigInt(`0x${Buffer.from(buf).reverse().toString('hex')}`);
const toB64Url = (n) => {
	let hex = n.toString(16);
	if (hex.length % 2) hex = `0${hex}`;
	return Buffer.from(hex, 'hex').toString('base64url');
};

/** Android's key layout back into a key; also checks the two numbers worked out from the modulus. */
function decodeKey(data) {
	const text = data.toString('utf8').replace(/\0+$/, '');
	const [b64, ...name] = text.split(' ');
	const raw = Buffer.from(b64, 'base64');
	const words = raw.readUInt32LE(0);
	const n0inv = raw.readUInt32LE(4);
	const n = toBig(raw.subarray(8, 8 + words * 4));
	const rr = toBig(raw.subarray(8 + words * 4, 8 + words * 8));
	const e = raw.readInt32LE(8 + words * 8);
	const two32 = 1n << 32n;
	const goodInv = ((n % two32) * BigInt(n0inv)) % two32 === two32 - 1n;
	const goodRr = rr === (1n << BigInt(words * 64)) % n;
	return { key: createPublicKey({ key: { kty: 'RSA', n: toB64Url(n), e: toB64Url(BigInt(e)) }, format: 'jwk' }), words, goodInv, goodRr, e, name: name.join(' '), length: raw.length };
}

/** A pretend Fire TV. `allow`: whether Allow gets pressed. */
function pretendTv({ allow = true } = {}) {
	const trusted = [];
	const seen = { headersOk: true, key: null, file: null, path: '', commands: [], signatureChecks: [] };
	const server = createServer((socket) => {
		let buffer = Buffer.alloc(0);
		let token = randomBytes(20);
		const streams = new Map();
		let nextRemote = 100;
		const send = (cmd, a0, a1, data) => socket.write(packet(cmd, a0, a1, data));
		socket.on('error', () => {});
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 24) {
				const length = buffer.readUInt32LE(12);
				if (buffer.length < 24 + length) break;
				const cmd = buffer.readUInt32LE(0), a0 = buffer.readUInt32LE(4), a1 = buffer.readUInt32LE(8);
				const data = buffer.subarray(24, 24 + length);
				let sum = 0;
				for (const b of data) sum = (sum + b) >>> 0;
				if (sum !== buffer.readUInt32LE(16) || ((cmd ^ 0xffffffff) >>> 0) !== buffer.readUInt32LE(20)) seen.headersOk = false;
				buffer = buffer.subarray(24 + length);
				handle(cmd, a0, a1, data);
			}
		});
		function handle(cmd, a0, a1, data) {
			if (cmd === C.CNXN) return send(C.AUTH, 1, 0, token);
			if (cmd === C.AUTH && a0 === 2) {
				const good = trusted.some((key) => {
					try {
						return publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, data).equals(Buffer.concat([PREFIX, token]));
					} catch {
						return false;
					}
				});
				seen.signatureChecks.push(good);
				if (good) return send(C.CNXN, 0x01000001, 4096, Buffer.from('device::ro.product.name=mantis;ro.product.model=AFTMM;ro.product.device=mantis;\0'));
				token = randomBytes(20);
				return send(C.AUTH, 1, 0, token);
			}
			if (cmd === C.AUTH && a0 === 3) {
				seen.key = decodeKey(data);
				if (!allow) return;
				// Allow pressed on the TV, after a moment.
				setTimeout(() => {
					trusted.push(seen.key.key);
					send(C.CNXN, 0x01000001, 4096, Buffer.from('device::ro.product.model=AFTMM;\0'));
				}, 300);
				return;
			}
			if (cmd === C.OPEN) {
				const service = data.toString('utf8').replace(/\0+$/, '');
				const remote = nextRemote++;
				streams.set(remote, { local: a0, service, got: Buffer.alloc(0) });
				send(C.OKAY, remote, a0);
				if (service.startsWith('shell:')) {
					const command = service.slice(6);
					seen.commands.push(command);
					const out = command.startsWith('pm install') ? 'Success\n' : command.startsWith('am start') ? 'Starting: Intent { cmp=app.catalog.tv/.MainActivity }\n' : '';
					if (out) send(C.WRTE, remote, a0, Buffer.from(out));
					else send(C.CLSE, remote, a0);
					streams.get(remote).closeAfterOkay = Boolean(out);
				}
				return;
			}
			if (cmd === C.OKAY) {
				const stream = streams.get(a1);
				if (stream?.closeAfterOkay) {
					stream.closeAfterOkay = false;
					send(C.CLSE, a1, stream.local);
				}
				return;
			}
			if (cmd === C.WRTE) {
				const stream = streams.get(a1);
				send(C.OKAY, a1, a0);
				if (!stream || stream.service !== 'sync:') return;
				stream.got = Buffer.concat([stream.got, data]);
				// SEND path,mode ; DATA n bytes ... ; DONE mtime ; then QUIT.
				let at = 0;
				const parts = [];
				let path = '';
				let done = false;
				let quit = false;
				while (stream.got.length - at >= 8) {
					const id = stream.got.subarray(at, at + 4).toString('ascii');
					const n = stream.got.readUInt32LE(at + 4);
					if (id === 'DONE') {
						done = true;
						at += 8;
						continue;
					}
					if (id === 'QUIT') {
						quit = true;
						at += 8;
						continue;
					}
					if (stream.got.length - at < 8 + n) break;
					const body = stream.got.subarray(at + 8, at + 8 + n);
					if (id === 'SEND') path = body.toString('utf8');
					if (id === 'DATA') parts.push(body);
					at += 8 + n;
				}
				if (done && !stream.answered) {
					stream.answered = true;
					seen.path = path;
					seen.file = Buffer.concat(parts);
					send(C.WRTE, a1, stream.local, Buffer.from('OKAY\0\0\0\0', 'latin1'));
				}
				if (quit) send(C.CLSE, a1, stream.local);
			}
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, close: () => server.close() })));
}

// --serve <port> <apk>: a pretend TV for a running Catalog (CATALOG_FIRETV_TEST_PORT=<port>) to install on;
// says whether the file it got is that apk, and which commands it ran, then stops.
if (process.argv[2] === '--serve') {
	const { readFileSync } = await import('node:fs');
	const want = readFileSync(process.argv[4]);
	const tv = await pretendTv();
	const { createServer: relay } = await import('node:net');
	// (On the asked port, passed through to the pretend TV's own.)
	relay((socket) => {
		const { Socket } = net;
		const inner = new Socket();
		inner.connect(tv.port, '127.0.0.1');
		socket.pipe(inner).pipe(socket);
		socket.on('error', () => inner.destroy());
		inner.on('error', () => socket.destroy());
	}).listen(Number(process.argv[3]), '127.0.0.1', () => console.log(`pretend Fire TV on ${process.argv[3]}`));
	const timer = setInterval(() => {
		if (!tv.seen.commands.some((c) => c.startsWith('am start'))) return;
		clearInterval(timer);
		console.log('key decoded right:', tv.seen.key?.goodInv && tv.seen.key?.goodRr);
		console.log('file is the TV app:', Boolean(tv.seen.file && sha1(tv.seen.file) === sha1(want)), tv.seen.file?.length, 'bytes');
		console.log('commands:', tv.seen.commands.join(' | '));
		setTimeout(() => process.exit(0), 500);
	}, 200);
	setTimeout(() => {
		console.log('nothing installed within 2 minutes');
		process.exit(1);
	}, 120_000);
} else {
	await runTests();
}

async function runTests() {
const key = newAdbKey();
const apk = randomBytes(37_530 + 70_000); // a little more than the real app, to need many pieces
const tv = await pretendTv();
const steps = [];

// First time: the TV doesn't know this computer, asks, Allow is pressed.
const first = await AdbConnection.connect('127.0.0.1', tv.port, key, (step) => steps.push(step.status), 5000);
check('connected after Allow', Boolean(first) && steps.includes('allow'), steps.join(','));
check("the TV's banner is read", /AFTMM/.test(first.banner), first.banner);
check('pieces no bigger than the TV said (4096)', first.maxData === 4096);
check('the key in Android\'s layout: 64 words, 524 bytes, exponent 65537', tv.seen.key?.words === 64 && tv.seen.key.length === 524 && tv.seen.key.e === 65537);
check('-1/n mod 2^32 is right', tv.seen.key?.goodInv === true);
check('R² mod n is right', tv.seen.key?.goodRr === true);
check('the key carries a name', /^catalog@/.test(tv.seen.key?.name ?? ''), tv.seen.key?.name);
let percent = 0;
await first.push(apk, '/data/local/tmp/catalog-tv.apk', (sent) => (percent = Math.round((sent / apk.length) * 100)));
check('the file arrives whole', tv.seen.file && sha1(tv.seen.file) === sha1(apk), `${tv.seen.file?.length} of ${apk.length}`);
check('with its path and mode', tv.seen.path === '/data/local/tmp/catalog-tv.apk,420', tv.seen.path);
check('the progress reaches 100', percent === 100, String(percent));
const installed = await first.shell('pm install -r /data/local/tmp/catalog-tv.apk');
check('install says Success', installed.includes('Success'), JSON.stringify(installed));
const removed = await first.shell('rm -f /data/local/tmp/catalog-tv.apk');
check('a command with nothing printed ends', removed === '');
const opened = await first.shell('am start -n app.catalog.tv/.MainActivity');
check('Catalog is opened', opened.includes('MainActivity'));
first.close();

// Second time: the TV knows this computer's key, so the signed puzzle is enough (no asking).
const again = [];
const second = await AdbConnection.connect('127.0.0.1', tv.port, key, (step) => again.push(step.status), 5000);
check('known computer: in without asking', Boolean(second) && !again.includes('allow'), again.join(','));
check("Android's own check of the signature passes", tv.seen.signatureChecks.at(-1) === true, JSON.stringify(tv.seen.signatureChecks));
second.close();
check('every message had the right sum and flipped command', tv.seen.headersOk);
tv.close();

// Allow never pressed.
const stubborn = await pretendTv({ allow: false });
try {
	await AdbConnection.connect('127.0.0.1', stubborn.port, key, () => {}, 1000);
	check('no Allow: refused', false);
} catch (error) {
	check('no Allow: says so', error instanceof AdbError && error.kind === 'not-allowed', String(error.message));
}
stubborn.close();

// ADB debugging off (nothing on the port).
try {
	await AdbConnection.connect('127.0.0.1', 1, key, () => {}, 1000);
	check('debugging off: refused', false);
} catch (error) {
	check('debugging off: says so', error instanceof AdbError && error.kind === 'refused', `${error.kind}: ${error.message}`);
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
}
