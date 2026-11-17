/**
 * Catalog's icon, as chosen in Settings → Personalization → App icon: on every window, and on the
 * desktop and Start menu shortcuts and a pinned taskbar button.
 *
 * The server keeps the chosen picture as app-icon.png beside the library and tells us where it is
 * (src/lib/server/appIcon.ts), at start and whenever it changes. Windows shortcuts only take .ico
 * files, so one is made from it here. Back to the pink circle: the shortcuts point at Catalog.exe's
 * own icon again.
 *
 * Shortcuts are looked at on every start too, since an update puts the installer's back.
 */
const { app, BrowserWindow, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ICON = path.join(__dirname, '..', 'build', 'client', 'icon.ico');
const DEFAULT_PNG = path.join(__dirname, '..', 'build', 'client', 'icon.png');

/** Sizes Windows picks from (the taskbar's ~24 px matters most), as in scripts/make-icon.mjs. */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** The chosen icon's .ico, or null for the pink circle. */
let customIco = null;

/** The icon file for a new window. */
function iconPath() {
	return customIco ?? DEFAULT_ICON;
}

/** An .ico holding each size as a PNG (Windows Vista and later read these). */
function icoFrom(image) {
	const pngs = ICO_SIZES.map((size) => ({ size, png: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	let offset = 6 + 16 * pngs.length;
	const entries = pngs.map(({ size, png }) => {
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0);
		entry.writeUInt8(size >= 256 ? 0 : size, 1);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.length;
		return entry;
	});
	return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

/** Catalog's own shortcuts: on the desktop, in the Start menu, and pinned to the taskbar. */
function shortcutFiles() {
	const appData = app.getPath('appData');
	return [
		path.join(app.getPath('desktop'), 'Catalog.lnk'),
		path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Catalog.lnk'),
		path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Catalog.lnk')
	];
}

const same = (a, b) => path.resolve(a || '.').toLowerCase() === path.resolve(b || '.').toLowerCase();

/** Points Catalog's shortcuts at `icon` (an .ico, or Catalog.exe for its own). Installed copies only. */
function pointShortcuts(icon) {
	if (process.platform !== 'win32' || !app.isPackaged) return;
	for (const file of shortcutFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const link = shell.readShortcutLink(file);
			// (Only shortcuts to this Catalog: a test copy elsewhere leaves the installed one's alone.)
			if (!same(link.target, process.execPath)) continue;
			const now = link.icon || process.execPath;
			if (same(now, icon) && (link.iconIndex ?? 0) === 0) continue;
			shell.writeShortcutLink(file, 'update', { icon, iconIndex: 0 });
		} catch {}
	}
}

/** Uses the icon at `file` (a PNG), or the pink circle when null. */
function useAppIcon(file) {
	let image = null;
	try {
		if (file && fs.existsSync(file)) image = nativeImage.createFromPath(file);
	} catch {}
	if (image && !image.isEmpty()) {
		const folder = path.dirname(file);
		// A new name for each icon: Windows remembers shortcut icons by file name and would keep
		// showing the old one.
		const ico = path.join(folder, `app-icon-${Math.round(fs.statSync(file).mtimeMs)}.ico`);
		try {
			if (!fs.existsSync(ico)) fs.writeFileSync(ico, icoFrom(image));
			for (const name of fs.readdirSync(folder)) {
				if (/^app-icon-\d+\.ico$/.test(name) && !same(path.join(folder, name), ico)) fs.rmSync(path.join(folder, name), { force: true });
			}
			customIco = ico;
		} catch {
			customIco = null;
		}
	} else {
		// (Back to the pink circle: the .ico made for the last icon isn't needed.)
		if (customIco) fs.rmSync(customIco, { force: true });
		customIco = null;
	}
	const shown = nativeImage.createFromPath(iconPath());
	for (const win of BrowserWindow.getAllWindows()) {
		try {
			if (!win.isDestroyed()) win.setIcon(shown);
		} catch {}
	}
	if (process.platform === 'darwin') {
		try {
			app.dock?.setIcon(customIco ? image : nativeImage.createFromPath(DEFAULT_PNG));
		} catch {}
	}
	pointShortcuts(customIco ?? process.execPath);
}

module.exports = { iconPath, useAppIcon };
