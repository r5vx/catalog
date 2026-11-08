// Prints the phone setup guide (phone-guide.html) to "Catalog phone setup.pdf" in Downloads.
// Uses headless Edge with its own throwaway profile, which it closes afterwards.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const code = /FIRE_TV_CODE = '(\d*)'/.exec(readFileSync(join(here, '../../src/lib/tvInstall.ts'), 'utf8'))?.[1] ?? '';
let html = readFileSync(join(here, 'phone-guide.html'), 'utf8').replace('{{CODE}}', code);
if (code) html = html.replace('<body>', '<body class="has-code">');

const work = mkdtempSync(join(tmpdir(), 'phone-guide-'));
const page = join(work, 'guide.html');
writeFileSync(page, html);
const out = process.argv[2] ?? join(homedir(), 'Downloads', 'Catalog phone setup.pdf');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const before = existsSync(out) ? statSync(out).mtimeMs : 0;
try {
	execFileSync(edge, ['--headless=new', '--disable-gpu', `--user-data-dir=${join(work, 'profile')}`, '--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60_000 });
	// Edge can hand the printing to another process and return first: wait for the new file.
	for (let i = 0; i < 60 && !(existsSync(out) && statSync(out).mtimeMs > before); i++) await new Promise((r) => setTimeout(r, 500));
	await new Promise((r) => setTimeout(r, 1000));
} finally {
	rmSync(work, { recursive: true, force: true });
}
if (!(existsSync(out) && statSync(out).mtimeMs > before)) throw new Error('Edge did not print the PDF');
console.log(`${out}${code ? ` (code ${code})` : ' (no code yet: laptop address)'}`);
