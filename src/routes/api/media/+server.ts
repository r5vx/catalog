import { json, error } from '@sveltejs/kit';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir } from '$lib/server/db';
import type { RequestHandler } from './$types';

const mediaDir = join(dataDir, 'media');

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const MAX_BYTES = 20 * 1024 * 1024;

/** Store an image dropped or pasted into a note, and hand back its address. */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');

	if (!(file instanceof File)) error(400, 'No image supplied.');
	if (file.size > MAX_BYTES) error(413, 'That image is larger than 20MB.');

	const ext = (extname(file.name) || '.png').toLowerCase();
	if (!ALLOWED.has(ext)) error(415, `${ext} images are not supported.`);

	mkdirSync(mediaDir, { recursive: true });

	const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`;
	writeFileSync(join(mediaDir, name), Buffer.from(await file.arrayBuffer()));

	return json({ url: `/media/${name}` });
};
