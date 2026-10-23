/**
 * Moving Catalog from "all users" to just this Windows account (Settings → Updates).
 *
 * Installed for all users, Catalog lives in Program Files, where Windows asks permission before
 * anything replaces it, so updates can't install by themselves (mom's laptop, 2026-10-22). The
 * installer can't fix that on its own: installing "only for me" leaves an all-users copy where
 * it is, and two installed copies is how the library got corrupted once. So, in order:
 *
 *   1. the latest installer is downloaded and checked against latest.yml, with Catalog still open;
 *   2. Catalog closes, and a helper (PowerShell, out of sight) waits for it to be gone;
 *   3. one Windows permission prompt: the all-users copy's own uninstaller removes it, keeping
 *      the library (the same command the installer uses), and Windows Firewall lets the new copy
 *      take connections on home networks (the TVs find the laptop that way; the old permission
 *      was for the old copy's file);
 *   4. only if the old copy is really gone, the installer puts it in for this account, quietly,
 *      and starts it.
 * Saying no to the prompt, or the old copy staying, changes nothing: the old one starts again.
 * The library, profiles, TVs and settings live in %APPDATA%\Catalog, which neither touches.
 * Each step is written to update.log.
 */
const { net } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LATEST = 'https://github.com/r5vx/catalog/releases/latest/download/';

/** Where a "just me" install goes (electron-builder: $LocalAppData\Programs\<name>). */
const newExePath = () =>
	path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Catalog', 'Catalog.exe');

/** Run with Windows' permission: removes the all-users copy and lets the new one through the firewall. */
const ELEVATED = `param([string]$Dir, [string]$NewExe)
$uninstaller = Get-ChildItem -LiteralPath $Dir -Filter 'Uninstall*.exe' | Select-Object -First 1
if ($uninstaller) { Start-Process -FilePath $uninstaller.FullName -ArgumentList ('/S /KEEP_APP_DATA /allusers _?=' + $Dir) -Wait }
if (Test-Path -LiteralPath (Join-Path $Dir 'Catalog.exe')) { exit 1 }
Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
netsh advfirewall firewall add rule name="Catalog" dir=in action=allow program="$NewExe" enable=yes profile=private,domain | Out-Null
`;

/** The helper: waits for Catalog to close, then the steps above. */
const HELPER = `param([int]$AppPid, [string]$Dir, [string]$Installer, [string]$NewExe, [string]$Elevated, [string]$Log)
function Note([string]$m) { Add-Content -LiteralPath $Log -Value ((Get-Date).ToUniversalTime().ToString('s') + 'Z move: ' + $m) }
$oldExe = Join-Path $Dir 'Catalog.exe'
try { Wait-Process -Id $AppPid -Timeout 90 -ErrorAction Stop } catch {}
# Every Catalog process from that folder (the server is one too) closed by itself first: the
# uninstaller force-closes any still running, and that mid-write once damaged the library.
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Process -Name 'Catalog' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($Dir + '\\*') }) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 500 }
if (Get-Process -Name 'Catalog' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($Dir + '\\*') }) {
	Note 'Catalog did not close, so nothing changed'
	exit
}
Start-Sleep -Seconds 2
Note 'asking Windows to remove the copy for all users'
try {
	Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Elevated + '"'), '-Dir', ('"' + $Dir + '"'), '-NewExe', ('"' + $NewExe + '"'))
} catch {
	Note ('permission not given, nothing changed: ' + $_.Exception.Message)
	Start-Process -FilePath $oldExe
	exit
}
if (Test-Path -LiteralPath $oldExe) {
	Note 'the copy for all users is still there, so nothing was installed'
	Start-Process -FilePath $oldExe
	exit
}
Note 'installing for this account'
Start-Process -FilePath $Installer -ArgumentList '/S', '/currentuser' -Wait
if (Test-Path -LiteralPath $NewExe) {
	Note 'done'
	Start-Process -FilePath $NewExe
} else {
	Note 'the install did not finish: opening the installer'
	Start-Process -FilePath $Installer
}
`;

/**
 * Steps 1 and 2 (the helper does the rest once Catalog has closed). `say` gets how it's going
 * ({ status: 'downloading' | 'closing' | 'error', message? }); `quit` closes Catalog.
 */
async function moveToThisAccount({ log, say, quit }) {
	const dir = path.dirname(process.execPath);
	try {
		say({ status: 'downloading' });
		const listing = await net.fetch(`${LATEST}latest.yml`, { cache: 'no-cache' });
		if (!listing.ok) throw new Error(`latest.yml ${listing.status}`);
		const yml = await listing.text();
		const file = yml.match(/^path:\s*(.+)$/m)?.[1]?.trim();
		const sha512 = yml.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
		if (!file || !sha512) throw new Error('latest.yml names no installer');
		const download = await net.fetch(`${LATEST}${encodeURIComponent(file)}`);
		if (!download.ok) throw new Error(`installer ${download.status}`);
		const bytes = Buffer.from(await download.arrayBuffer());
		if (crypto.createHash('sha512').update(bytes).digest('base64') !== sha512) throw new Error('the installer came damaged');

		const work = path.join(os.tmpdir(), 'catalog-move');
		fs.mkdirSync(work, { recursive: true });
		const installer = path.join(work, 'Catalog-Setup.exe');
		const elevated = path.join(work, 'remove-all-users.ps1');
		const helper = path.join(work, 'move.ps1');
		fs.writeFileSync(installer, bytes);
		fs.writeFileSync(elevated, ELEVATED);
		fs.writeFileSync(helper, HELPER);

		const logFile = path.join(require('electron').app.getPath('userData'), 'update.log');
		log(`move: moving from ${dir} to just this account (${newExePath()}) with ${file}`);
		spawn(
			'powershell.exe',
			['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helper,
				'-AppPid', String(process.pid), '-Dir', dir, '-Installer', installer, '-NewExe', newExePath(), '-Elevated', elevated, '-Log', logFile],
			{ detached: true, stdio: 'ignore', windowsHide: true }
		).unref();
		say({ status: 'closing' });
		setTimeout(quit, 1500);
	} catch (error) {
		log(`move: stopped before anything changed: ${error.message}`);
		say({ status: 'error', message: error.message });
	}
}

module.exports = { moveToThisAccount, HELPER, ELEVATED };
