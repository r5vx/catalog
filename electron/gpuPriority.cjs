/*
 * Catalog's video stays smooth beside a demanding game (Windows only).
 *
 * A game running uncapped (Destiny 2 with its frame-rate cap off, 2026-11-07) keeps the graphics
 * card busy all the time, and Windows shares the card out by each program's graphics priority: at
 * the usual "normal" Catalog's frames waited behind the game's and the video on the other monitor
 * looked choppy. A lighter game (LEGO Marvel's Avengers) left room, so it looked fine.
 *
 * Chromium does all of Catalog's drawing and video decoding in one process (the "GPU" one), so that
 * process is given "high" graphics priority (the step below "realtime", which can starve Windows'
 * own desktop drawing). Its work is small (a video's frames), so the game barely loses anything.
 * Works without admin rights (checked 2026-11-07). The GPU process can restart, so it's checked
 * again every 30 s and the new one raised too.
 */
const { app } = require('electron');
const { spawn } = require('node:child_process');

const HIGH = 4; // D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH

function raise(pid) {
	const script = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class CatalogGpu {
  [DllImport("gdi32.dll")] public static extern int D3DKMTSetProcessSchedulingPriorityClass(IntPtr h, int c);
}
'@
$p = Get-Process -Id ${pid} -ErrorAction Stop
[void][CatalogGpu]::D3DKMTSetProcessSchedulingPriorityClass($p.Handle, ${HIGH})`;
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
		stdio: 'ignore',
		windowsHide: true
	});
	child.on('error', () => {});
}

function keepGpuPriorityHigh() {
	if (process.platform !== 'win32') return;
	let raised = 0;
	const check = () => {
		try {
			const gpu = app.getAppMetrics().find((m) => m.type === 'GPU');
			if (gpu && gpu.pid !== raised) {
				raised = gpu.pid;
				raise(gpu.pid);
			}
		} catch {}
	};
	setTimeout(check, 3000);
	setInterval(check, 30_000);
}

module.exports = { keepGpuPriorityHigh };
