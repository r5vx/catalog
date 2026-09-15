import { error } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { dataDir } from '$lib/server/db';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml'
};

/** Serve an image from your notes folder. */
export const GET: RequestHandler = async ({ params }) => {
	// basename() keeps a crafted name from climbing out of the folder.
	const name = basename(params.file ?? '');
	const path = join(dataDir, 'media', name);

	if (!name || !existsSync(path)) error(404, 'No such image.');

	const type = TYPES[extname(name).toLowerCase()];
	if (!type) error(415, 'Not an image.');

	return new Response(readFileSync(path), {
		headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000' }
	});
};
