import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from './updater';

/**
 * Rebuilding the app from source, with something to look at while it happens.
 *
 * The build runs into `dist-staged` **while Catalog is still open**, so the
 * slow part has a progress bar instead of a console window. Only the final
 * folder swap needs the app closed, and that part is a few seconds with no
 * window at all.
 */

export type RebuildState = {
	status: 'idle' | 'working' | 'swapping' | 'failed';
	/** 0–100, by step. Honest rather than smooth: a step is a step. */
	percent: number;
	label: string;
	message?: string;
	startedAt?: number;
};

let state: RebuildState = { status: 'idle', percent: 0, label: '' };

export const rebuildState = (): RebuildState => state;

export function startRebuild(): boolean {
	if (state.status === 'working' || state.status === 'swapping') return true;

	const root = projectRoot();

	state = {
		status: 'working',
		percent: 0,
		label: 'Starting…',
		startedAt: Date.now()
	};

	const child = spawn('node', [join(root, 'scripts', 'stage-update.mjs')], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true
	});

	let line = '';

	child.stdout.on('data', (chunk: Buffer) => {
		line += chunk.toString();

		// Only whole lines; a chunk can split one in half.
		const lines = line.split('\n');
		line = lines.pop() ?? '';

		for (const one of lines) read(one.trim());
	});

	// The build's own output is only interesting when it goes wrong, so it's
	// kept for the failure message rather than shown.
	let tail = '';
	child.stderr.on('data', (chunk: Buffer) => {
		tail = (tail + chunk.toString()).slice(-2000);
	});

	child.on('close', (code) => {
		if (state.status === 'swapping') return;

		if (code !== 0 && state.status !== 'failed') {
			state = {
				status: 'failed',
				percent: 0,
				label: '',
				message: tail.trim().split('\n').slice(-3).join(' ') || 'The build failed.'
			};
		}
	});

	child.on('error', () => {
		state = {
			status: 'failed',
			percent: 0,
			label: '',
			message: 'Could not start the build. Is Node installed?'
		};
	});

	return true;
}

/** Reads the `::step`, `::ready` and `::fail` lines the build script prints. */
function read(line: string) {
	if (line.startsWith('::step ')) {
		const match = /^::step (\d+)\/(\d+) (.*)$/.exec(line);
		if (!match) return;

		const [, done, total, label] = match;
		state = {
			...state,
			status: 'working',
			// The bar sits at the *start* of the step it names, so it never
			// claims to have finished something it's still doing.
			percent: Math.round(((Number(done) - 1) / Number(total)) * 100),
			label
		};
		return;
	}

	if (line === '::ready') {
		state = { ...state, status: 'swapping', percent: 100, label: 'Restarting Catalog' };
		applyAndQuit();
		return;
	}

	if (line.startsWith('::fail ')) {
		state = { status: 'failed', percent: 0, label: '', message: line.slice(7) };
	}
}

/**
 * Hands over to the helper and steps aside.
 *
 * Detached and hidden: it outlives this process, waits for the app to go, and
 * moves the new folder into place. Nothing flashes up on screen.
 */
function applyAndQuit() {
	const root = projectRoot();

	const helper = spawn('node', [join(root, 'scripts', 'apply-update.mjs')], {
		cwd: root,
		detached: true,
		stdio: 'ignore',
		windowsHide: true
	});

	helper.unref();

	// A moment for the page to show "Restarting" before the window closes.
	setTimeout(() => process.send?.({ type: 'quit-for-update' }), 1500);
}
