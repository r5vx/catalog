// Build Catalog, then start it with CATALOG_DB pointing to an empty scratch file,
// TMDB_API_KEY=fixture and node --import ./scripts/dev/browse-fixture.mjs build/index.js.
// The script skips Welcome on that scratch instance and adds/removes its own fixture title.
// With a scratch Chrome tab open on a local --remote-debugging-port, run:
// node scripts/dev/browse-check.mjs http://127.0.0.1:5347 9343 [screenshot.png]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [origin, port, screenshot] = process.argv.slice(2);
const setup = await fetch(origin + '/welcome?/skip', {
	method: 'POST', headers: { Origin: origin }, body: new URLSearchParams(), redirect: 'manual'
});
assert.ok(setup.ok || setup.status === 303, `Welcome skip: ${setup.status}`);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
const pending = new Map();
let sequence = 0;
socket.onmessage = ({ data }) => {
	const { id, result, error } = JSON.parse(data);
	const call = pending.get(id);
	if (!call) return;
	pending.delete(id);
	if (error) call.reject(new Error(error.message));
	else call.resolve(result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params }));
});

async function run(expression) {
	const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true });
	if (exceptionDetails) throw new Error(result.description);
	return result.value;
}

async function until(expression, description = expression) {
	for (let i = 0; i < 80; i++) {
		if (await run(expression).catch(() => false)) return;
		await delay(100);
	}
	throw new Error(`Timed out: ${description}`);
}

async function open(path) {
	await send('Page.navigate', { url: origin + path });
	await until(`location.pathname + location.search === ${JSON.stringify(path)} && document.querySelector('.toolbar input') !== null`);
	await delay(1000);
}

const field = (selector, value, change = false) =>
	run(`(() => {
		const field = document.querySelector(${JSON.stringify(selector)});
		field.value = ${JSON.stringify(value)};
		field.dispatchEvent(new Event('input', { bubbles: true }));
		if (${change}) field.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
const results = (title) => `[...document.querySelectorAll('.name')].some(node => node.textContent === '${title}')`;
async function check(label, test) {
	try { await test(); console.log(`PASS ${label}`); }
	catch (error) { console.error(`FAIL ${label}: ${error.message}`); process.exitCode = 1; }
}

try {
	await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 440, deviceScaleFactor: 1, mobile: false });
	await check('Show more keeps keyboard focus during loading, after success and after failure', async () => {
		await open('/browse?cat=movies');
		await run(`window.originalMoreFetch = window.fetch;
			window.moreRequests = 0;
			window.fetch = async (...args) => {
				if (!String(args[0]).startsWith('/api/browse?')) return window.originalMoreFetch(...args);
				window.moreRequests++;
				await window.moreGate;
				return window.failMore ? new Response(null, { status: 503 }) : window.originalMoreFetch(...args);
			};`);
		try {
			for (const fail of [false, true]) {
				await run(`window.failMore = ${fail}; window.moreRequests = 0;
					window.moreGate = new Promise(resolve => window.releaseMore = resolve);
					window.moreButton = document.querySelector('.shelf .btn.more'); window.moreButton.focus();`);
				await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
				await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
				await until("window.moreButton.getAttribute('aria-disabled') === 'true'");
				assert.equal(await run('document.activeElement === window.moreButton'), true, 'focus during loading');
				await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
				await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
				assert.equal(await run('window.moreRequests'), 3, 'repeat activation does not load duplicate pages');
				await run('window.releaseMore()');
				await until("window.moreButton.getAttribute('aria-disabled') !== 'true'");
				assert.equal(await run('document.activeElement === window.moreButton'), true, 'focus after loading');
				assert.equal(await run("window.moreButton.textContent.includes('Try again')"), fail);
			}
		} finally {
			await run('window.fetch = window.originalMoreFetch; window.releaseMore()');
		}
	});
	await check('Browse year fields follow Back and Forward', async () => {
		await open('/browse?cat=movies&from=2001');
		await click('.browse-filter-trigger');
		await field('[aria-label="From year"]', '2012', true);
		await until("new URLSearchParams(location.search).get('from') === '2012'");
		await run('history.back()');
		await until("new URLSearchParams(location.search).get('from') === '2001'");
		await until(`document.querySelector('[aria-label="From year"]').value === '2001'`, 'From year reflects Back');
		await run('history.forward()');
		await until("new URLSearchParams(location.search).get('from') === '2012'");
		await until(`document.querySelector('[aria-label="From year"]').value === '2012'`, 'From year reflects Forward');
	});

	await check('Browse search field follows Back and Forward', async () => {
		await open('/browse?cat=movies');
		await field('.toolbar input', 'First search');
		await until("new URLSearchParams(location.search).get('q') === 'First search'");
		await field('.toolbar input', 'Second search');
		await until("new URLSearchParams(location.search).get('q') === 'Second search'");
		await run('history.back()');
		await until("new URLSearchParams(location.search).get('q') === 'First search'");
		await until("document.querySelector('.toolbar input').value === 'First search'", 'search field reflects Back');
		await run('history.forward()');
		await until("new URLSearchParams(location.search).get('q') === 'Second search'");
		await until("document.querySelector('.toolbar input').value === 'Second search'", 'search field reflects Forward');
	});

	await check('Returning from View details restores the loaded pages and scroll, then loads the next batch', async () => {
		await open('/browse?cat=movies&genre=18');
		await click('.shelf .btn.more');
		await until(results('Fixture shelf 18 page 4'), 'initial Show more adds page 4');
		await run('window.scrollTo(0, document.body.scrollHeight)');
		const scroll = await run('window.scrollY');
		assert.ok(scroll > 0, 'fixture shelf is scrollable');
		await run(`document.querySelector('.shelf .card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
		await run(`[...document.querySelectorAll('.ctx-menu button')].find(button => button.textContent.trim() === 'View details').click()`);
		await until("location.pathname.startsWith('/title/')");
		await click('nav.bar a');
		await until("location.pathname === '/browse' && location.search.includes('genre=18')");
		await until(results('Fixture shelf 18 page 4'), 'app Back restores page 4');
		await until(`window.scrollY === ${scroll}`);
		await click('.shelf .btn.more');
		await until(results('Fixture shelf 18 page 7'));
		if (screenshot) writeFileSync(screenshot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
	});

	await check('Add, failed removal, successful removal and re-add keep the Browse card in sync', async () => {
		await open('/browse?cat=movies&q=Fixture+Film');
		await until(results('Fixture Film'));
		if (await run("document.querySelector('.card.mine') !== null")) {
			await click('.card [title="Remove from library"]');
			await until("document.querySelector('.card.mine') === null");
			await open('/browse?cat=movies&q=Fixture+Film');
		}
		await click('.card [title="Add to watchlist"]');
		await until("document.querySelector('.card.mine .added[href]') !== null");
		const firstLink = await run("document.querySelector('.card .added').getAttribute('href')");
		await run(`window.origFetch = window.fetch; window.fetch = (...args) =>
			String(args[0]) === '/api/entries' && args[1]?.method === 'DELETE'
				? Promise.resolve(new Response(null, { status: 503 }))
				: window.origFetch(...args)`);
		await click('.card [title="Remove from library"]');
		try {
			await until("document.body.innerText.includes('That could not be removed') || document.querySelector('.card.mine') === null");
			assert.equal(await run("document.querySelector('.card.mine .added')?.getAttribute('href')"), firstLink, 'failed removal leaves the card owned');
			assert.equal(await run("document.body.innerText.includes('That could not be removed')"), true, 'failed removal shows an error');
		} finally {
			await run('window.fetch = window.origFetch');
		}
		await click('.card [title="Remove from library"]');
		await until("document.querySelector('.card.mine') === null");
		assert.equal(await run("document.querySelector('.card .added') === null"), true);
		await click('.card [title="Add to watchlist"]');
		await until("document.querySelector('.card.mine .added[href]') !== null");
		assert.notEqual(await run("document.querySelector('.card .added').getAttribute('href')"), firstLink);
	});
} finally {
	socket.close();
}
