/**
 * Packs Catalog for Roku (roku/ → dist-roku/Catalog-Roku.zip): the zip a Roku in developer mode
 * installs (roku/README.md says how).
 *
 *   npm run roku
 *
 * Nothing to compile: a Roku app is its files, zipped with the manifest at the top. The zip is
 * also copied to static/catalog-roku.zip, so Catalog on a computer serves it at
 * http://<computer>:4173/catalog-roku.zip.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'roku');
const out = join(root, 'dist-roku');

/** Every file under `dir`, as paths inside the zip ("components/HomeScreen.xml"). */
function filesIn(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return filesIn(path);
		// The notes stay out of the app itself.
		if (name === 'README.md') return [];
		return [relative(app, path).split('\\').join('/')];
	});
}

/** A plain zip: each file deflated, then the list of them at the end. */
function zip(names) {
	const parts = [];
	const list = [];
	let at = 0;
	for (const name of names) {
		const body = readFileSync(join(app, name));
		const packed = deflateRawSync(body);
		const check = crc32(body) >>> 0;
		const nameBytes = Buffer.from(name, 'utf8');
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0);
		head.writeUInt16LE(20, 4);
		head.writeUInt16LE(0x0800, 6);
		head.writeUInt16LE(8, 8);
		head.writeUInt32LE(check, 14);
		head.writeUInt32LE(packed.length, 18);
		head.writeUInt32LE(body.length, 22);
		head.writeUInt16LE(nameBytes.length, 26);
		parts.push(head, nameBytes, packed);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(0x0800, 8);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt32LE(check, 16);
		entry.writeUInt32LE(packed.length, 20);
		entry.writeUInt32LE(body.length, 24);
		entry.writeUInt16LE(nameBytes.length, 28);
		entry.writeUInt32LE(at, 42);
		list.push(entry, nameBytes);
		at += head.length + nameBytes.length + packed.length;
	}
	const listBytes = Buffer.concat(list);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(names.length, 8);
	end.writeUInt16LE(names.length, 10);
	end.writeUInt32LE(listBytes.length, 12);
	end.writeUInt32LE(at, 16);
	return Buffer.concat([...parts, listBytes, end]);
}

const names = filesIn(app).sort((a, b) => (a === 'manifest' ? -1 : b === 'manifest' ? 1 : a.localeCompare(b)));
mkdirSync(out, { recursive: true });
const file = join(out, 'Catalog-Roku.zip');
writeFileSync(file, zip(names));
copyFileSync(file, join(root, 'static', 'catalog-roku.zip'));
console.log(`Packed ${names.length} files into ${relative(root, file)} (also static/catalog-roku.zip).`);
