// node scripts/dev/online/owner-settings-test.mjs. No network, running app, or real key needed.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const lib = new URL('../../../src/lib/server/', import.meta.url);
const routes = new URL('../../../src/routes/', import.meta.url);
const settings = {};
globalThis.ownerTest = { settings };
const stubs = new Map([
	[new URL('settings.ts', lib).href, 'export const readSettings = () => ownerTest.settings; export const updateSettings = (patch) => Object.assign(ownerTest.settings, patch);'],
	[new URL('sources/addons.ts', lib).href, "export const savedAddons = () => [{base:'https://test-addon.invalid/private-config',name:'Fixture',key:'test'}];"],
	[new URL('online.ts', lib).href, 'export const cloud = () => { throw Error("unexpected cloud request"); };']
]);
registerHooks({
	resolve(id, ctx, next) {
		if (id.startsWith('$lib/server/')) return { shortCircuit: true, url: new URL(id.slice(12) + '.ts', lib).href };
		if (id.startsWith('./') && !id.includes('.', 2) && ctx.parentURL?.endsWith('.ts')) id += '.ts';
		return next(id, ctx);
	},
	load(url, ctx, next) {
		if (stubs.has(url)) return { shortCircuit: true, format: 'module', source: stubs.get(url) };
		if (!url.endsWith('.ts')) return next(url, ctx);
		return { shortCircuit: true, format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
		}).outputText };
	}
});
const auth = await import(new URL('ownerSession.ts', lib));
const { withProfile } = await import(new URL('profile.ts', lib));
const load = async path => import(new URL(path, routes));
const health = await load('api/online/source-health/+server.ts');
const usage = await load('api/online/usage/+server.ts');
const reports = await load('api/online/reports/+server.ts');
const page = await load('settings/owner/+page.server.ts');
const jar = () => ({ values: new Map(), get(key) { return this.values.get(key); },
	set(key, value, opts) { assert.ok(opts.httpOnly); assert.equal(opts.sameSite, 'strict'); this.values.set(key, value); },
	delete(key) { this.values.delete(key); } });
const owner = jar(), guest = jar();
settings.onlineAdminKey = 'dummy';
assert.equal(auth.isOwner(guest), false, 'stored upstream key alone must not grant access');
for (const handle of [page.load, health.POST, usage.GET, reports.GET, reports.POST, reports.DELETE]) {
	await assert.rejects(async () => handle({cookies: guest}), e => e.status === 403);
}
auth.rememberOwner(owner, true);
assert.equal(auth.isOwner(owner), true);
assert.equal(withProfile(1, () => auth.isOwner(owner)), false);
page.load({cookies:owner});
let requests = 0;
globalThis.fetch = async url => {
	requests++;
	assert.ok(!String(url).includes('private-config'));
	if (String(url).includes('test-addon.invalid')) return new Response(null, {status:403});
	if (String(url).includes('nyaa.si')) throw Error('offline');
	return new Response(null, {status:200});
};
const check = async () => (await health.POST({cookies:owner})).json();
const [one, two] = await Promise.all([check(),check()]);
assert.deepEqual(one, two);
assert.equal(one.results.length, requests);
assert.ok(one.results.some(row => row.name === 'Nyaa' && row.status === 'Unreachable'));
assert.ok(one.results.some(row => row.name === 'Fixture (add-on)' && row.status === 'Access limited'));
assert.equal((await check()).at, one.at);
assert.equal(one.results.length, requests);
auth.forgetOwner(owner);
assert.equal(auth.isOwner(owner), false);
console.log('Owner access: page and API gates, profile isolation, health statuses, deduplication and revocation passed.');
