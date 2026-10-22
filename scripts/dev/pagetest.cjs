// Fetches the real Febbox player page with the saved sign-in (one request) and runs the
// desktop app's reader (fromSourcesList in electron/main.cjs) on it. When Febbox changes its
// page, both this reader and showbox.ts' need fixing.
//
//   node scripts/dev/pagetest.cjs "<copy of library.db>" electron/main.cjs <shareKey> <fid>
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const [db, main, shareKey, fid] = process.argv.slice(2);
if (!db || path.resolve(db).toLowerCase() === path.resolve(process.env.APPDATA || '', 'Catalog', 'library.db').toLowerCase()) {
	console.error('Give a COPY of the library, never the live one.');
	process.exit(1);
}
const token = new DatabaseSync(db, { readOnly: true }).prepare("select value from settings where key='febboxToken'").get()?.value;
const src = fs.readFileSync(main, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function fromSourcesList(html)');
const end = src.indexOf('\n}\n', start) + 2;
const fromSourcesList = new Function(src.slice(start, end) + '\nreturn fromSourcesList;')();
(async () => {
	const r = await fetch('https://www.febbox.com/file/player', {
		method: 'POST',
		headers: {
			Cookie: token,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
		},
		body: `fid=${fid}&share_key=${shareKey}`
	});
	const html = await r.text();
	console.log('page', r.status, html.length, 'chars; has var sources:', /var\s+sources/.test(html));
	const s = performance.now();
	const url = fromSourcesList(html);
	console.log('reader found:', url.slice(0, 100), `(${(performance.now() - s).toFixed(1)} ms)`);
	const m = await fetch(url, { headers: { Referer: 'https://www.febbox.com/' } });
	const body = await m.text();
	console.log('link works:', m.status, body.includes('#EXT-X-STREAM-INF'), (body.match(/RESOLUTION=\d+x\d+/g) || []).join(' '));
	// And the refusal check, on a refusal.
	const refusedText = '{"code":-1,"msg":"please login"}';
	console.log('refusal spotted:', /^\s*\{[\s\S]*"code"\s*:\s*-?\d+/.test(refusedText) && refusedText.length < 400, '| real page taken as refusal:', /^\s*\{[\s\S]*"code"\s*:\s*-?\d+/.test(html) && html.length < 400);
})();
