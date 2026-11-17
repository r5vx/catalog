import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db';

/**
 * The app icon chosen in Settings → Personalization → App icon, as a 256 px PNG beside the
 * library. The desktop app (electron/appIcon.cjs) makes the windows, the desktop and Start menu
 * shortcuts and a pinned taskbar button use it. No file: the pink circle.
 */
export const appIconFile = join(dataDir, 'app-icon.png');

/** Tells the desktop app which icon to use (nothing happens outside it). Also sent once at start. */
export function tellDesktopIcon(): void {
	if (typeof process.send !== 'function') return;
	try {
		process.send({ type: 'app-icon', file: existsSync(appIconFile) ? appIconFile : null });
	} catch {}
}

/** Keeps a new icon (a PNG), or goes back to the pink circle (null), and tells the desktop app. */
export function saveAppIcon(png: Buffer | null): void {
	if (png) writeFileSync(appIconFile, png);
	else rmSync(appIconFile, { force: true });
	tellDesktopIcon();
}

/** Whether this server runs inside the desktop app (where the app icon can be changed). */
export const inDesktopApp = () => typeof process.send === 'function';
