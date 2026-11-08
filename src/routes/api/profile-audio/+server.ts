import { json } from '@sveltejs/kit';
import { audioLanguage, setAudioLanguage } from '$lib/server/audioLanguage';
import type { RequestHandler } from './$types';

/** This profile's audio language (audioLanguage.ts): GET → { language }; POST { language } ('' = original). */
export const GET: RequestHandler = async () => json({ language: audioLanguage() });

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { language?: string } | null;
	setAudioLanguage(String(body?.language ?? ''));
	return json({ language: audioLanguage() });
};
