/**
 * Deletes GitHub releases v1.7.1 through v1.7.9 and their git tags.
 * Run with: node scripts/cleanup-releases.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tokenFromEnvFile() {
	const file = join(root, '.env');
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const match = /^\s*(?:GH_TOKEN|GITHUB_TOKEN)\s*=\s*(.+?)\s*$/.exec(line);
		if (match) return match[1].replace(/^["']|["']$/g, '');
	}
	return '';
}

const token = process.env.GH_TOKEN || tokenFromEnvFile();
if (!token) { console.error('No GH_TOKEN found'); process.exit(1); }

const owner = 'r5vx';
const repo = 'catalog';
const api = (path, init = {}) =>
	fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...init.headers
		}
	});

const toDelete = ['v1.7.1', 'v1.7.2', 'v1.7.3', 'v1.7.4', 'v1.7.5', 'v1.7.6', 'v1.7.7', 'v1.7.8', 'v1.7.9'];

const releases = await (await api(`/repos/${owner}/${repo}/releases`)).json();

for (const tag of toDelete) {
	const release = releases.find(r => r.tag_name === tag);
	if (release) {
		const resp = await api(`/repos/${owner}/${repo}/releases/${release.id}`, { method: 'DELETE' });
		console.log(`${tag} release: ${resp.ok ? 'deleted' : `failed (${resp.status})`}`);
	} else {
		console.log(`${tag} release: not found (already gone)`);
	}

	const tagResp = await api(`/repos/${owner}/${repo}/git/refs/tags/${tag}`, { method: 'DELETE' });
	console.log(`${tag} tag: ${tagResp.ok ? 'deleted' : tagResp.status === 422 ? 'not found' : `failed (${tagResp.status})`}`);
}

console.log('\nDone. v1.7.0 is now the latest release on GitHub.');
