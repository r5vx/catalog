// node scripts/dev/caption-timing/alignment-test.mjs (no network or media files)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

registerHooks({
	resolve(id, ctx, next) {
		if (id.startsWith('./') && !id.includes('.', 2) && ctx.parentURL?.endsWith('.ts')) id += '.ts';
		return next(id, ctx);
	},
	load(url, ctx, next) {
		if (!url.endsWith('.ts')) return next(url, ctx);
		return { shortCircuit: true, format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
		}).outputText };
	}
});
const { fitDelays, FRAME } = await import('../../../src/lib/subtitleAlign.ts');
const { planFromMatches } = await import('../../../src/lib/wordTiming.ts');
const { SubtitleSync } = await import('../../../src/lib/subtitleSync.ts');

let seed = 732;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const cues = [];
const speech = new Float32Array(Math.ceil(700 / FRAME));
for (let t = 8; t < 680;) {
	const end = t + 1 + 3 * random();
	cues.push({ start: t, end });
	speech.fill(1, Math.round((t + 2.4) / FRAME), Math.round((end + 2.4) / FRAME));
	t = end + 0.4 + 5 * random();
}
const voicePlan = fitDelays(speech, cues);
assert.ok(voicePlan?.fits && Math.abs(voicePlan.steps[0].delay - 2.4) < 0.15);
assert.ok(!fitDelays(new Float32Array(speech.length).fill(NaN), cues)?.fits);
const points = Array.from({ length: 28 }, (_, i) => ({ t: 140 * i, off: i % 7 ? 0.1 : 4 }));
const words = planFromMatches(points);
assert.equal(words.steps[0].delay, 0.1);
assert.equal(words.agree, 24);
assert.equal(planFromMatches(points.slice(0, 6)), null);

for (const rate of [25 / 24, 25 / 23.976, 24 / 23.976, 23.976 / 24]) {
	const drift = Array.from({ length: 16 }, (_, i) => {
		const t = i * (rate > 1.02 ? 28 : 210);
		return { t, off: 0.3 + t * (rate - 1) + (i % 7 ? 0 : 2) };
	});
	const plan = planFromMatches(drift);
	assert.ok(plan && Math.abs(plan.rate - rate) < 1e-6, `wrong rate for ${rate}`);
	assert.equal(plan.steps[0].delay, 0.3);
}

let worker;
class TestWorker {
	constructor() { worker = this; }
	postMessage(message) { if (message.kind === 'cues') this.round = message.round; }
	reply(plan, heard) { this.onmessage({ data: { kind: 'plan', plan, heard, round: this.round } }); }
	terminate() {}
}
globalThis.Worker = TestWorker;
const video = { duration: 3427, currentTime: 100 };
let delay = 0, warnings = 0, pending = true;
const sync = new SubtitleSync(video, () => cues, () => delay, () => false);
sync.checkingWords = () => pending;
sync.onDelay = value => { delay = value; };
sync.onMismatch = () => warnings++;
sync.start();
try {
	const mismatch = { steps: [], fits: false };
	worker.reply(mismatch, 3000);
	assert.equal(warnings, 0, 'a speech mismatch must wait for the word check');
	sync.useWordTiming(words);
	pending = false;
	worker.reply(mismatch, 3200);
	assert.equal(warnings, 0);
	assert.equal(delay, 0.1);
	sync.newCues();
	video.duration = 0;
	worker.reply(mismatch, 5);
	assert.equal(warnings, 0, 'unknown duration cannot count as a fully analysed video');
	video.duration = 3427;
	worker.reply(mismatch, 3000);
	worker.reply(mismatch, 3200);
	assert.equal(warnings, 1, 'a supported mismatch is still reported, once');
} finally { sync.destroy(); }
console.log('Timing: known offset, silence, word consensus, four frame rates, pending verdict and genuine mismatch passed.');
