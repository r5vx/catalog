/**
 * Builds Catalog for Fire TV (android/ → dist-tv/Catalog-TV.apk), with the Android SDK's own
 * tools and no Gradle: compile the resources, compile the Java, turn it into Android's format,
 * pack, align and sign.
 *
 *   npm run tv
 *
 * Needs the Android SDK (platform 34 and build-tools) in %LOCALAPPDATA%\Android\Sdk, or wherever
 * ANDROID_HOME points, and a JDK. Only needed to build the app — nobody installing it needs any of it.
 *
 * The finished app is also copied to static/catalog-tv.apk, so Catalog on a computer serves it:
 * the Downloader app on the TV fetches it from http://<computer>:4173/catalog-tv.apk.
 *
 * The app is signed with android/catalog-tv.keystore, made on the first build. Keep that file:
 * an update signed with a different key won't install over the old app.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'android');
const work = join(root, 'build-tv');
const out = join(root, 'dist-tv');

const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const platformJar = join(sdk, 'platforms', 'android-34', 'android.jar');
if (!existsSync(platformJar)) {
	console.error(`No Android SDK platform 34 at ${sdk}. Install it with sdkmanager "platforms;android-34" "build-tools;34.0.0".`);
	process.exit(1);
}
const buildTools = join(
	sdk,
	'build-tools',
	readdirSync(join(sdk, 'build-tools')).sort().at(-1)
);
const tool = (name) => join(buildTools, process.platform === 'win32' && !name.includes('.') ? `${name}.exe` : name);

/** keytool isn't always on the PATH even when java is: find it next to the running JDK. */
function javaTool(name) {
	// java prints its settings to stderr.
	const settings = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
	const home = process.env.JAVA_HOME || /java\.home = (.+)/.exec(`${settings.stdout}${settings.stderr}`)?.[1] || '';
	const path = join(home.trim(), 'bin', process.platform === 'win32' ? `${name}.exe` : name);
	return existsSync(path) ? path : name;
}

function run(file, args, options = {}) {
	// .bat tools (d8, apksigner) need the shell on Windows.
	const shell = file.endsWith('.bat');
	execFileSync(shell ? `"${file}"` : file, shell ? args.map((a) => `"${a}"`) : args, { stdio: 'inherit', shell, ...options });
}

/* ------------------------------------------------------------ pictures */

function png(width, height, pixel) {
	const raw = Buffer.alloc(height * (1 + width * 4));
	let at = 0;
	for (let y = 0; y < height; y++) {
		raw[at++] = 0;
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = pixel(x, y);
			raw[at++] = r;
			raw[at++] = g;
			raw[at++] = b;
			raw[at++] = a;
		}
	}
	const chunk = (type, data) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const check = Buffer.alloc(4);
		check.writeUInt32BE(crc32(body) >>> 0);
		return Buffer.concat([length, body, check]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** The pink circle from the desktop icon, on Catalog's dark green, sized for the TV's app row. */
function banner() {
	const [w, h] = [320, 180];
	const [cx, cy, radius] = [w / 2, h / 2, 58];
	const bg = [0x11, 0x16, 0x14];
	const pink = [0xe9, 0x94, 0xc2];
	return png(w, h, (x, y) => {
		let inside = 0;
		for (let sy = 0; sy < 4; sy++)
			for (let sx = 0; sx < 4; sx++) {
				const dx = x + (sx + 0.5) / 4 - cx;
				const dy = y + (sy + 0.5) / 4 - cy;
				if (dx * dx + dy * dy <= radius * radius) inside++;
			}
		const t = inside / 16;
		return [0, 1, 2].map((i) => Math.round(bg[i] * (1 - t) + pink[i] * t)).concat(255);
	});
}

/* ------------------------------------------------------------ build */

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'res', 'drawable'), { recursive: true });
mkdirSync(join(work, 'res', 'values'), { recursive: true });
mkdirSync(join(work, 'gen'), { recursive: true });
mkdirSync(join(work, 'classes'), { recursive: true });
mkdirSync(join(work, 'dex'), { recursive: true });
mkdirSync(out, { recursive: true });

console.log('— Pictures —');
copyFileSync(join(root, 'static', 'icon-192.png'), join(work, 'res', 'drawable', 'icon.png'));
writeFileSync(join(work, 'res', 'drawable', 'banner.png'), banner());
copyFileSync(join(app, 'res', 'values', 'strings.xml'), join(work, 'res', 'values', 'strings.xml'));

console.log('— Resources —');
run(tool('aapt2'), ['compile', '--dir', join(work, 'res'), '-o', join(work, 'res.zip')]);
run(tool('aapt2'), [
	'link',
	'-o', join(work, 'base.apk'),
	'-I', platformJar,
	'--manifest', join(app, 'AndroidManifest.xml'),
	'-A', join(app, 'assets'),
	'--java', join(work, 'gen'),
	'--min-sdk-version', '22',
	'--target-sdk-version', '34',
	join(work, 'res.zip')
]);

console.log('— Java —');
const sources = [];
const collect = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) collect(path);
		else if (entry.name.endsWith('.java')) sources.push(path);
	}
};
collect(join(app, 'src'));
collect(join(work, 'gen'));
run('javac', [
	'-source', '8', '-target', '8', '-nowarn', '-Xlint:-options',
	'-encoding', 'UTF-8',
	'-bootclasspath', platformJar,
	'-classpath', platformJar,
	'-d', join(work, 'classes'),
	...sources
]);

console.log('— Android bytecode —');
const classes = [];
const collectClasses = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) collectClasses(path);
		else if (entry.name.endsWith('.class')) classes.push(path);
	}
};
collectClasses(join(work, 'classes'));
run(join(buildTools, 'd8.bat'), ['--min-api', '22', '--lib', platformJar, '--output', join(work, 'dex'), ...classes]);

console.log('— Packing —');
copyFileSync(join(work, 'base.apk'), join(work, 'unsigned.apk'));
// aapt adds files by the path it's given, so run it next to classes.dex.
run(tool('aapt'), ['add', join(work, 'unsigned.apk'), 'classes.dex'], { cwd: join(work, 'dex') });
run(tool('zipalign'), ['-f', '-p', '4', join(work, 'unsigned.apk'), join(work, 'aligned.apk')]);

console.log('— Signing —');
const keystore = join(app, 'catalog-tv.keystore');
if (!existsSync(keystore)) {
	run(javaTool('keytool'), [
		'-genkeypair', '-keystore', keystore, '-alias', 'catalog',
		'-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
		'-storepass', 'catalogtv', '-keypass', 'catalogtv',
		'-dname', 'CN=Catalog'
	]);
}
const apk = join(out, 'Catalog-TV.apk');
run(join(buildTools, 'apksigner.bat'), [
	'sign', '--ks', keystore, '--ks-pass', 'pass:catalogtv', '--key-pass', 'pass:catalogtv', '--out', apk, join(work, 'aligned.apk')
]);
run(join(buildTools, 'apksigner.bat'), ['verify', apk]);

copyFileSync(apk, join(root, 'static', 'catalog-tv.apk'));
rmSync(work, { recursive: true, force: true });
console.log(`\nDone: ${apk} (${Math.round(readFileSync(apk).length / 1024)} KB), also at static/catalog-tv.apk`);
