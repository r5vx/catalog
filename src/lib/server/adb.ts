/**
 * Just enough of Android's developer connection (ADB, over the network on port 5555) to put the
 * Catalog app on a Fire TV from the computer, with nothing to install on the computer
 * (src/lib/server/fireTvInstall.ts uses it). No outside code: the protocol is small.
 *
 * How it goes:
 *   1. Catalog says hello (CNXN). The TV answers with a 20-byte puzzle (AUTH token).
 *   2. Catalog signs it with its own key. A TV that already trusts this computer says hello back.
 *   3. Otherwise Catalog sends its public key, and the TV asks on screen "Allow USB debugging?"
 *      (with "Always allow from this computer"). Pressing Allow lets it in.
 *   4. The app file is copied to the TV (the "sync" service), installed with `pm install -r`,
 *      deleted again, and Catalog is opened.
 *
 * Every message is a 24-byte header (six little-endian numbers: command, two arguments, length,
 * a sum of the bytes, and the command flipped) followed by its data.
 *
 * Kept free of other Catalog files, so a test can load it on its own (scripts/dev/firetv-adb-test.mjs).
 */
import { createHash, constants, createPrivateKey, createPublicKey, generateKeyPairSync, privateEncrypt } from 'node:crypto';
import { Socket } from 'node:net';
import { hostname } from 'node:os';

const A_CNXN = 0x4e584e43;
const A_AUTH = 0x48545541;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_CLSE = 0x45534c43;
const A_WRTE = 0x45545257;
const A_STLS = 0x534c5453;
const AUTH_TOKEN = 1;
const AUTH_SIGNATURE = 2;
const AUTH_RSAPUBLICKEY = 3;
const VERSION = 0x01000001;
const MAX_DATA = 256 * 1024;
/** What a SHA-1 signature wraps the hash in: the TV checks the puzzle as if it were a SHA-1 hash. */
const SHA1_PREFIX = Buffer.from('3021300906052b0e03021a05000414', 'hex');
const SYNC_CHUNK = 64 * 1024;

export type Packet = { command: number; arg0: number; arg1: number; data: Buffer };

/** What happens along the way, for the page to show. */
export type Step = { status: 'connecting' | 'allow' | 'sending' | 'installing' | 'opening'; percent?: number };

export class AdbError extends Error {
	kind: 'refused' | 'unreachable' | 'not-allowed' | 'failed' | 'tls';
	constructor(message: string, kind: AdbError['kind']) {
		super(message);
		this.kind = kind;
	}
}

/* ------------------------------------------------------------ the key */

/** A new key for this computer (kept by the caller; the TV remembers it once Allow is pressed with "Always allow"). */
export function newAdbKey(): string {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
	return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

const fromBase64Url = (text: string) => BigInt(`0x${Buffer.from(text, 'base64url').toString('hex') || '0'}`);

function modInverse(a: bigint, m: bigint): bigint {
	let [oldR, r] = [((a % m) + m) % m, m];
	let [oldS, s] = [1n, 0n];
	while (r !== 0n) {
		const q = oldR / r;
		[oldR, r] = [r, oldR - q * r];
		[oldS, s] = [s, oldS - q * s];
	}
	return ((oldS % m) + m) % m;
}

/**
 * The public key the way Android wants it (its old "mincrypt" layout), base64, then a name:
 * the number of 32-bit words, -1/n mod 2^32, the modulus and R² mod n as little-endian words,
 * and the exponent.
 */
export function androidPublicKey(privatePem: string, name = `catalog@${hostname()}`): Buffer {
	const jwk = createPublicKey(createPrivateKey(privatePem)).export({ format: 'jwk' }) as { n: string; e: string };
	const n = fromBase64Url(jwk.n);
	const e = Number(fromBase64Url(jwk.e));
	const words = 64;
	const out = Buffer.alloc(4 + 4 + words * 4 + words * 4 + 4);
	const two32 = 1n << 32n;
	out.writeUInt32LE(words, 0);
	const n0 = n % two32;
	out.writeUInt32LE(Number((two32 - modInverse(n0, two32)) % two32), 4);
	const rr = (1n << BigInt(words * 32 * 2)) % n;
	for (let i = 0; i < words; i++) {
		out.writeUInt32LE(Number((n >> BigInt(i * 32)) % two32), 8 + i * 4);
		out.writeUInt32LE(Number((rr >> BigInt(i * 32)) % two32), 8 + words * 4 + i * 4);
	}
	out.writeInt32LE(e, 8 + words * 8);
	return Buffer.from(`${out.toString('base64')} ${name}\0`, 'utf8');
}

/** The TV's puzzle, signed the way it checks it (RSA PKCS#1 v1.5 over a SHA-1 wrapping). */
export function signToken(privatePem: string, token: Buffer): Buffer {
	return privateEncrypt({ key: privatePem, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1_PREFIX, token]));
}

/* ------------------------------------------------------------ messages */

export function packet(command: number, arg0: number, arg1: number, data: Buffer = Buffer.alloc(0)): Buffer {
	const header = Buffer.alloc(24);
	let sum = 0;
	for (const byte of data) sum = (sum + byte) >>> 0;
	header.writeUInt32LE(command, 0);
	header.writeUInt32LE(arg0 >>> 0, 4);
	header.writeUInt32LE(arg1 >>> 0, 8);
	header.writeUInt32LE(data.length, 12);
	header.writeUInt32LE(sum, 16);
	header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
	return Buffer.concat([header, data]);
}

/** Reads whole messages from a socket, one at a time. */
export class PacketReader {
	private buffer = Buffer.alloc(0);
	private ready: Packet[] = [];
	private waiting: { resolve: (p: Packet) => void; reject: (e: Error) => void } | null = null;
	private ended: Error | null = null;

	constructor(socket: Socket) {
		socket.on('data', (chunk: Buffer) => {
			this.buffer = Buffer.concat([this.buffer, chunk]);
			while (this.buffer.length >= 24) {
				const length = this.buffer.readUInt32LE(12);
				if (this.buffer.length < 24 + length) break;
				const p = { command: this.buffer.readUInt32LE(0), arg0: this.buffer.readUInt32LE(4), arg1: this.buffer.readUInt32LE(8), data: this.buffer.subarray(24, 24 + length) };
				this.buffer = this.buffer.subarray(24 + length);
				if (this.waiting) {
					const w = this.waiting;
					this.waiting = null;
					w.resolve(p);
				} else this.ready.push(p);
			}
		});
		const end = (error: Error) => {
			this.ended = error;
			this.waiting?.reject(error);
			this.waiting = null;
		};
		socket.on('close', () => end(new AdbError('The TV closed the connection', 'not-allowed')));
		socket.on('error', (error: NodeJS.ErrnoException) =>
			end(error.code === 'ECONNREFUSED' ? new AdbError('refused', 'refused') : new AdbError(error.message, 'unreachable'))
		);
	}

	/** The next message, or an error after `ms` (or when the connection ends). */
	next(ms: number): Promise<Packet> {
		const p = this.ready.shift();
		if (p) return Promise.resolve(p);
		if (this.ended) return Promise.reject(this.ended);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting = null;
				reject(new AdbError('timeout', 'unreachable'));
			}, ms);
			this.waiting = {
				resolve: (packet) => {
					clearTimeout(timer);
					resolve(packet);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				}
			};
		});
	}
}

/* ------------------------------------------------------------ a connection */

export class AdbConnection {
	private nextId = 1;
	maxData = 4096;
	banner = '';

	private socket: Socket;
	private reader: PacketReader;

	private constructor(socket: Socket, reader: PacketReader) {
		this.socket = socket;
		this.reader = reader;
	}

	/**
	 * Connects and signs in with `privatePem`. `onStep('allow')` is called when the TV is asking
	 * "Allow USB debugging?" on its screen; `allowFor` is how long to wait for that.
	 */
	static async connect(host: string, port: number, privatePem: string, onStep: (step: Step) => void = () => {}, allowFor = 90_000): Promise<AdbConnection> {
		const socket = new Socket();
		const reader = new PacketReader(socket);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new AdbError('timeout', 'unreachable'));
			}, 5000);
			socket.once('connect', () => {
				clearTimeout(timer);
				resolve();
			});
			socket.once('error', (error: NodeJS.ErrnoException) => {
				clearTimeout(timer);
				reject(error.code === 'ECONNREFUSED' ? new AdbError('refused', 'refused') : new AdbError(error.message, 'unreachable'));
			});
			socket.connect(port, host);
		});
		socket.setNoDelay(true);
		const connection = new AdbConnection(socket, reader);
		try {
			socket.write(packet(A_CNXN, VERSION, MAX_DATA, Buffer.from('host::\0')));
			let signed = false;
			let keySent = false;
			for (;;) {
				const p = await reader.next(keySent ? allowFor : 10_000).catch((error) => {
					throw keySent && error instanceof AdbError && error.message === 'timeout' ? new AdbError('Allow was not pressed on the TV', 'not-allowed') : error;
				});
				if (p.command === A_CNXN) {
					connection.maxData = Math.min(p.arg1 || 4096, MAX_DATA);
					connection.banner = p.data.toString('utf8').replace(/\0+$/, '');
					return connection;
				}
				if (p.command === A_STLS) throw new AdbError('The TV wants a paired, encrypted connection', 'tls');
				if (p.command !== A_AUTH || p.arg0 !== AUTH_TOKEN) continue;
				if (!signed) {
					signed = true;
					socket.write(packet(A_AUTH, AUTH_SIGNATURE, 0, signToken(privatePem, p.data)));
				} else if (!keySent) {
					// Not known yet: the key goes over, and the TV asks on screen.
					keySent = true;
					socket.write(packet(A_AUTH, AUTH_RSAPUBLICKEY, 0, androidPublicKey(privatePem)));
					onStep({ status: 'allow' });
				}
			}
		} catch (error) {
			socket.destroy();
			throw error;
		}
	}

	close(): void {
		this.socket.destroy();
	}

	/** Opens a service ("sync:", "shell:…"); the stream's two ids. */
	private async open(service: string): Promise<{ local: number; remote: number }> {
		const local = this.nextId++;
		this.socket.write(packet(A_OPEN, local, 0, Buffer.from(`${service}\0`)));
		for (;;) {
			const p = await this.reader.next(15_000);
			if (p.command === A_OKAY && p.arg1 === local) return { local, remote: p.arg0 };
			if (p.command === A_CLSE && p.arg1 === local) throw new AdbError(`The TV refused ${service.split(':')[0]}`, 'failed');
		}
	}

	/** Sends data on a stream, in pieces the TV takes, each waited for. What the TV says meanwhile is kept in `heard`. */
	private async write(stream: { local: number; remote: number }, data: Buffer, heard: Buffer[], onSent?: (sent: number) => void): Promise<void> {
		for (let at = 0; at < data.length; at += this.maxData) {
			const piece = data.subarray(at, at + this.maxData);
			this.socket.write(packet(A_WRTE, stream.local, stream.remote, piece));
			for (;;) {
				const p = await this.reader.next(30_000);
				if (p.arg1 !== stream.local) continue;
				if (p.command === A_OKAY) break;
				if (p.command === A_WRTE) {
					heard.push(p.data);
					this.socket.write(packet(A_OKAY, stream.local, stream.remote));
				}
				if (p.command === A_CLSE) throw new AdbError('The TV stopped the copy', 'failed');
			}
			onSent?.(Math.min(data.length, at + piece.length));
		}
	}

	/** Reads a stream until `enough` says so or the TV closes it. */
	private async readUntil(stream: { local: number; remote: number }, heard: Buffer[], enough: (all: Buffer) => boolean, ms = 60_000): Promise<Buffer> {
		for (;;) {
			const all = Buffer.concat(heard);
			if (enough(all)) return all;
			const p = await this.reader.next(ms);
			if (p.arg1 !== stream.local) continue;
			if (p.command === A_WRTE) {
				heard.push(p.data);
				this.socket.write(packet(A_OKAY, stream.local, stream.remote));
			} else if (p.command === A_CLSE) {
				this.socket.write(packet(A_CLSE, stream.local, stream.remote));
				return Buffer.concat(heard);
			}
		}
	}

	/** Runs a shell command on the TV and gives back what it printed. */
	async shell(command: string, ms = 60_000): Promise<string> {
		const stream = await this.open(`shell:${command}`);
		const out = await this.readUntil(stream, [], () => false, ms);
		return out.toString('utf8');
	}

	/** Copies a file to the TV (the sync service: SEND, DATA pieces, DONE; the TV answers OKAY or FAIL). */
	async push(data: Buffer, path: string, onSent?: (sent: number) => void): Promise<void> {
		const stream = await this.open('sync:');
		const heard: Buffer[] = [];
		const word = (id: string, n: number, body: Buffer = Buffer.alloc(0)) => {
			const head = Buffer.alloc(8);
			head.write(id, 0, 'ascii');
			head.writeUInt32LE(n >>> 0, 4);
			return Buffer.concat([head, body]);
		};
		const target = Buffer.from(`${path},${0o644}`, 'utf8');
		const parts = [word('SEND', target.length, target)];
		for (let at = 0; at < data.length; at += SYNC_CHUNK) {
			const piece = data.subarray(at, at + SYNC_CHUNK);
			parts.push(word('DATA', piece.length, piece));
		}
		parts.push(word('DONE', Math.floor(Date.now() / 1000)));
		const all = Buffer.concat(parts);
		// (What's sent is a little more than the file: the percentage follows the file's share.)
		await this.write(stream, all, heard, (sent) => onSent?.(Math.min(data.length, Math.round((sent / all.length) * data.length))));
		const answer = await this.readUntil(stream, heard, (got) => got.length >= 8, 30_000);
		const id = answer.subarray(0, 4).toString('ascii');
		if (id !== 'OKAY') {
			const length = answer.length >= 8 ? answer.readUInt32LE(4) : 0;
			throw new AdbError(`The TV couldn't take the file: ${answer.subarray(8, 8 + length).toString('utf8') || id}`, 'failed');
		}
		this.socket.write(packet(A_WRTE, stream.local, stream.remote, word('QUIT', 0)));
	}
}

/** The sha1 of some bytes, for tests and logs. */
export const sha1 = (data: Buffer) => createHash('sha1').update(data).digest('hex');
