import { json } from '@sveltejs/kit';
import { isShowboxUp } from '$lib/server/showbox';

export async function GET() {
	const up = await isShowboxUp();
	return json({ up });
}
