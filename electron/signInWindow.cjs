/*
 * The Edge window Google's sign-in happens in (youtubeSignIn.cjs), kept with Catalog's YouTube window
 * and closed by itself once Google is done. Windows only (elsewhere the person closes it).
 *
 * Catalog can't ask Edge anything while Google's page is open (Edge started with a DevTools port is
 * refused by Google), so a small PowerShell helper watches it from outside through Windows itself:
 * - It finds Edge's window (by its processes, whose command line holds the sign-in profile folder).
 * - It makes the YouTube window its owner: it then stays over that window, and minimizes and comes
 *   back with it, as a dialog of it would.
 * - It reads the window's title: once it's a YouTube page's ("You - YouTube": the sign-in is started
 *   with that page to come back to; Google's own sign-in pages are called "YouTube" or "... - Google
 *   Accounts"), it closes the window. Edge then quits, and Catalog reads the sign-in.
 */
const { spawn } = require('node:child_process');

// PowerShell, sent as an encoded command (the app's files are packed, so it can't run a file of them).
const HELPER = String.raw`
param([string]$Profile, [long]$Owner)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class CatalogSignIn {
	public delegate bool EnumProc(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
	[DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
}
"@
$owned = @{}
$lastTitle = ''
$pids = @()
$checked = [DateTime]::MinValue
$started = Get-Date
while (((Get-Date) - $started).TotalMinutes -lt 120) {
	if (((Get-Date) - $checked).TotalSeconds -ge 2) {
		$checked = Get-Date
		$pids = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Profile) } | ForEach-Object { [uint32]$_.ProcessId })
		if ($pids.Count -eq 0 -and ((Get-Date) - $started).TotalSeconds -gt 20) { break }
	}
	$found = New-Object System.Collections.ArrayList
	[CatalogSignIn]::EnumWindows({ param($h, $l)
		$p = 0; [void][CatalogSignIn]::GetWindowThreadProcessId($h, [ref]$p)
		if ($pids -contains $p -and [CatalogSignIn]::IsWindowVisible($h)) {
			$c = New-Object System.Text.StringBuilder 64; [void][CatalogSignIn]::GetClassName($h, $c, 64)
			if ($c.ToString() -like 'Chrome_WidgetWin_*') {
				$t = New-Object System.Text.StringBuilder 512; [void][CatalogSignIn]::GetWindowText($h, $t, 512)
				if ($t.ToString()) { [void]$found.Add(@($h, $t.ToString())) }
			}
		}
		return $true }, [IntPtr]::Zero) | Out-Null
	foreach ($w in $found) {
		$h = $w[0]; $title = $w[1]
		if (-not $owned.ContainsKey([string]$h) -and $Owner -ne 0) {
			[void][CatalogSignIn]::SetWindowLongPtr($h, -8, [IntPtr]$Owner)
			$owned[[string]$h] = $true
			[Console]::Out.WriteLine('window'); [Console]::Out.Flush()
		}
		if ($title -ne $lastTitle) { $lastTitle = $title; [Console]::Out.WriteLine('title ' + $title); [Console]::Out.Flush() }
		# Google done: the window is on a YouTube page of its own ("You - YouTube"; the sign-in pages are
		# called "YouTube" or "... - Google Accounts").
		if ($title -match '. - YouTube$' -and $title -notmatch 'Google') {
			[Console]::Out.WriteLine('done'); [Console]::Out.Flush()
			[void][CatalogSignIn]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
			exit 0
		}
	}
	Start-Sleep -Milliseconds 300
}
`;

/**
 * Watches the sign-in window (Windows only). `owner` is the YouTube window (a BrowserWindow) or
 * null. Calls `onEvent('window' | 'done' | 'title', text)`. Answers a stop function.
 */
function watchSignInWindow(profile, owner, onEvent = () => {}) {
	if (process.platform !== 'win32') return () => {};
	let handle = 0n;
	try {
		const raw = owner && !owner.isDestroyed() ? owner.getNativeWindowHandle() : null;
		if (raw) handle = raw.length >= 8 ? raw.readBigUInt64LE(0) : BigInt(raw.readUInt32LE(0));
	} catch {}
	const script = `& {${HELPER}} -Profile '${profile.replace(/'/g, "''")}' -Owner ${handle}`;
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
		stdio: ['ignore', 'pipe', 'ignore'],
		windowsHide: true
	});
	child.on('error', () => {});
	let rest = '';
	child.stdout.on('data', (chunk) => {
		rest += chunk.toString();
		const lines = rest.split(/\r?\n/);
		rest = lines.pop();
		for (const line of lines) {
			if (line === 'window' || line === 'done') onEvent(line, '');
			else if (line.startsWith('title ')) onEvent('title', line.slice(6));
		}
	});
	return () => {
		if (child.exitCode === null) child.kill();
	};
}

module.exports = { watchSignInWindow };
