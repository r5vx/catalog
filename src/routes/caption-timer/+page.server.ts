import type { PageServerLoad } from './$types';

/**
 * The caption timer's page is cross-origin isolated, so Whisper can use several of the computer's
 * threads (one otherwise). Only this page: nothing else in Catalog changes.
 */
export const load: PageServerLoad = ({ setHeaders }) => {
	setHeaders({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
};
