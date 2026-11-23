'use strict';
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = { runtime: { onConnect: { addListener() {} }, onMessage: { addListener() {} } }, csi: function () {}, loadTimes: function () {} };
Object.defineProperty(navigator, 'plugins', {
	get: () => {
		const p = [
			{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
			{ name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
			{ name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
		];
		p.refresh = () => {};
		Object.defineProperty(p, 'length', { get: () => 3 });
		return p;
	}
});
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
// Permissions API: Turnstile checks notification permission isn't "denied" in automation
const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
if (origQuery) {
	navigator.permissions.query = (desc) => {
		if (desc.name === 'notifications') return Promise.resolve({ state: 'prompt', onchange: null });
		return origQuery(desc);
	};
}
