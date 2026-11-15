/**
 * Putting the Catalog app on a Fire TV from Settings → TV and phones, like the Roku's: no
 * Downloader, nothing to press on the TV after the first time (owner, 2026-11-15: "like how we
 * have on roku able to update it from the computer").
 *
 * It uses the Fire TV's developer connection (ADB, src/lib/server/adb.ts), which has to be turned
 * on once on each TV: Settings → My Fire TV → Developer options → ADB debugging. The first install
 * from this computer makes the TV ask "Allow USB debugging?"; with "Always allow from this
 * computer" ticked it never asks again. This computer's key for it is kept in `settings`
 * (`fireTvKey`), which is never exported.
 *
 * Fire TVs are found from the ones that have opened Catalog (their requests carry "CatalogTV/"),
 * and by looking for the developer connection's port (5555) on the home network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Socket } from 'node:net';
import { AdbConnection, AdbError, newAdbKey, type Step } from './adb';
import { readSettings, updateSettings } from './settings';
import { homeAddresses, isHomeAddress } from './rokuInstall';

/** The developer connection's port (CATALOG_FIRETV_TEST_PORT: a pretend TV on this computer, scripts/dev/firetv-adb-test.mjs --serve). */
const ADB_PORT = Number(process.env.CATALOG_FIRETV_TEST_PORT) || 5555;
const APK_PATH = '/data/local/tmp/catalog-tv.apk';
const APP = 'app.catalog.tv/.MainActivity';

export type FoundFireTv = {
	address: string;
	/** Its name when Catalog has installed on it before ("Fire TV Stick 4K"), else ''. */
	name: string;
	/** When it last opened Catalog (ms), or null when it was only found by its port. */
	seen: number | null;
	/** Its developer connection answers (ADB debugging is on). */
	open: boolean;
};

type Known = Record<string, { seen?: number; name?: string }>;

function known(): Known {
	try {
		return JSON.parse(readSettings().fireTvKnown ?? '{}') as Known;
	} catch {
		return {};
	}
}

const noted = new Map<string, number>();

/**
 * A Fire TV opened Catalog from this address (hooks.server.ts). Written down at most once an hour
 * per TV, so Settings can list it later. The Roku's own app isn't a Fire TV.
 */
export function noteFireTv(address: string, agent: string): void {
	const clean = address.replace(/^::ffff:/, '');
	if (/Roku/i.test(agent) || !isHomeAddress(clean)) return;
	if (Date.now() - (noted.get(clean) ?? 0) < 60 * 60_000) return;
	noted.set(clean, Date.now());
	const all = known();
	all[clean] = { ...all[clean], seen: Date.now() };
	// (Forty at most: the oldest go.)
	const kept = Object.fromEntries(
		Object.entries(all)
			.sort((a, b) => (b[1].seen ?? 0) - (a[1].seen ?? 0))
			.slice(0, 40)
	);
	updateSettings({ fireTvKnown: JSON.stringify(kept) });
}

/** Whether something answers on the developer connection's port. */
function portOpen(address: string, wait: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new Socket();
		const done = (open: boolean) => {
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(wait, () => done(false));
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
		socket.connect(ADB_PORT, address);
	});
}

/** One address (typed in): whether its developer connection answers. */
export async function fireTvAt(address: string): Promise<FoundFireTv> {
	const info = known()[address];
	return { address, name: info?.name ?? '', seen: info?.seen ?? null, open: await portOpen(address, 2500) };
}

/**
 * The Fire TVs: every one that has opened Catalog in the last 60 days, and anything on the home
 * network with the developer connection's port open (a TV that never opened Catalog, the first time).
 */
export async function findFireTvs(): Promise<FoundFireTv[]> {
	const info = known();
	const since = Date.now() - 60 * 86_400_000;
	const candidates = new Set<string>();
	for (const own of homeAddresses()) {
		const base = own.split('.').slice(0, 3).join('.');
		for (let last = 1; last < 255; last++) if (`${base}.${last}` !== own) candidates.add(`${base}.${last}`);
	}
	for (const [address, one] of Object.entries(info)) if ((one.seen ?? 0) > since || one.name) candidates.add(address);
	const list = [...candidates];
	const open = new Set<string>();
	for (let i = 0; i < list.length; i += 64) {
		const batch = list.slice(i, i + 64);
		const answers = await Promise.all(batch.map((address) => portOpen(address, 900)));
		batch.forEach((address, n) => answers[n] && open.add(address));
	}
	return list
		.filter((address) => open.has(address) || (info[address]?.seen ?? 0) > since || Boolean(info[address]?.name))
		.map((address) => ({ address, name: info[address]?.name ?? '', seen: info[address]?.seen ?? null, open: open.has(address) }))
		.sort((a, b) => Number(b.open) - Number(a.open) || (b.seen ?? 0) - (a.seen ?? 0));
}

/** The TV app, as `npm run tv` builds it: in the build's client folder, or the project's static/. */
function apk(): Buffer | null {
	const candidates = [join(dirname(process.argv[1] ?? ''), 'client', 'catalog-tv.apk'), join(process.cwd(), 'static', 'catalog-tv.apk')];
	const path = candidates.find((p) => existsSync(p));
	return path ? readFileSync(path) : null;
}

/** This computer's key for the TVs' developer connection: made the first time. */
function adbKey(): string {
	const kept = readSettings().fireTvKey;
	if (kept) return kept;
	const made = newAdbKey();
	updateSettings({ fireTvKey: made });
	return made;
}

/** A Fire TV model code as its name (the common ones; others show as "Fire TV"). */
const MODELS: Record<string, string> = {
	AFTMM: 'Fire TV Stick 4K',
	AFTKA: 'Fire TV Stick 4K Max',
	AFTKM: 'Fire TV Stick 4K (2nd gen)',
	AFTKRT: 'Fire TV Stick 4K Max (2nd gen)',
	AFTSSS: 'Fire TV Stick (3rd gen)',
	AFTSS: 'Fire TV Stick Lite',
	AFTT: 'Fire TV Stick (2nd gen)',
	AFTR: 'Fire TV Cube',
	AFTGAZL: 'Fire TV Cube (3rd gen)',
	AFTA: 'Fire TV Cube (1st gen)'
};

function nameFrom(banner: string): string {
	const model = /ro\.product\.model=([^;]+)/.exec(banner)?.[1]?.trim() ?? '';
	return MODELS[model] ?? (model ? `Fire TV (${model})` : 'Fire TV');
}

export type InstallJob = { status: Step['status'] | 'done' | 'error'; percent: number; message: string };
const jobs = new Map<string, InstallJob>();

/** What a failure means, in words for the page. */
function explain(error: unknown): string {
	if (error instanceof AdbError) {
		if (error.kind === 'refused') return "That TV isn't letting computers in yet. On the TV: Settings → My Fire TV → Developer options → ADB debugging → ON.";
		if (error.kind === 'unreachable') return "Couldn't reach that TV. Make sure it's on and on the same Wi-Fi as this computer.";
		if (error.kind === 'not-allowed') return 'The TV didn\'t allow it. Try again and press Allow on the TV (tick "Always allow from this computer" so it won\'t ask again).';
		if (error.kind === 'tls') return 'This TV only offers wireless debugging with a pairing code, which Catalog can\'t use. Turn on ADB debugging instead.';
		return error.message;
	}
	return String((error as Error)?.message ?? error);
}

/** Starts installing on one Fire TV; the job's id, to ask how it's going (`installJob`). */
export function startFireTvInstall(address: string): string {
	const id = `${address}|${Date.now()}`;
	const job: InstallJob = { status: 'connecting', percent: 0, message: '' };
	jobs.set(id, job);
	setTimeout(() => jobs.delete(id), 30 * 60_000).unref?.();
	void (async () => {
		const file = apk();
		if (!file) {
			Object.assign(job, { status: 'error', message: "The TV app isn't in this copy of Catalog." });
			return;
		}
		let connection: AdbConnection | null = null;
		try {
			connection = await AdbConnection.connect(address, ADB_PORT, adbKey(), (step) => Object.assign(job, step));
			const name = nameFrom(connection.banner);
			Object.assign(job, { status: 'sending', percent: 0 });
			await connection.push(file, APK_PATH, (sent) => (job.percent = Math.round((sent / file.length) * 100)));
			Object.assign(job, { status: 'installing', percent: 100 });
			const said = await connection.shell(`pm install -r ${APK_PATH}`, 120_000);
			await connection.shell(`rm -f ${APK_PATH}`).catch(() => '');
			if (!/Success/.test(said)) {
				const why = /\[(INSTALL_[A-Z_]+)/.exec(said)?.[1] ?? said.trim().split('\n').pop() ?? '';
				throw new Error(why === 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' ? 'A different copy of the Catalog app is on that TV. Uninstall it on the TV first, then try again.' : `The TV didn't install it${why ? ` (${why})` : ''}.`);
			}
			Object.assign(job, { status: 'opening' });
			await connection.shell(`am start -n ${APP}`, 20_000).catch(() => '');
			const all = known();
			all[address] = { ...all[address], name };
			updateSettings({ fireTvKnown: JSON.stringify(all) });
			Object.assign(job, { status: 'done', message: `Installed on ${name}. Catalog is opening on the TV.` });
		} catch (error) {
			Object.assign(job, { status: 'error', message: explain(error) });
		} finally {
			connection?.close();
		}
	})();
	return id;
}

export const installJob = (id: string): InstallJob | null => jobs.get(id) ?? null;
