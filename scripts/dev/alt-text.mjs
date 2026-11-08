// Writes the alternate wording (Settings → Personalization → Code) into src/lib/altText.ts,
// encoded, from scripts/dev/alt-text.local.json. That file is the only readable copy and is kept
// out of the repository (.gitignore), so the wording isn't readable on GitHub.
//   node scripts/dev/alt-text.mjs           encode the .json into altText.ts
//   node scripts/dev/alt-text.mjs --decode  write the .json back out from altText.ts
import { readFileSync, writeFileSync } from 'node:fs';

const JSON_FILE = new URL('./alt-text.local.json', import.meta.url);
const TS_FILE = new URL('../../src/lib/altText.ts', import.meta.url);
const KEY = 'catalog';

const xor = (bytes) => bytes.map((b, i) => b ^ KEY.charCodeAt(i % KEY.length));

if (process.argv.includes('--decode')) {
	const ts = readFileSync(TS_FILE, 'utf8');
	const data = ts.match(/const DATA =\s*'([^']*)'/)[1];
	const text = Buffer.from(xor(Buffer.from(data, 'base64'))).toString('utf8');
	writeFileSync(JSON_FILE, JSON.stringify(JSON.parse(text), null, '\t'));
	console.log('Wrote scripts/dev/alt-text.local.json');
} else {
	const text = JSON.stringify(JSON.parse(readFileSync(JSON_FILE, 'utf8')));
	const data = Buffer.from(xor(Buffer.from(text, 'utf8'))).toString('base64');
	const ts = readFileSync(TS_FILE, 'utf8').replace(/const DATA =\s*'[^']*'/, `const DATA =\n\t'${data}'`);
	writeFileSync(TS_FILE, ts);
	console.log(`Encoded ${text.length} characters into src/lib/altText.ts`);
}
