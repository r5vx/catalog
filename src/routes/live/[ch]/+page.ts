import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Live channels play in Catalog's own player now (/watch?live=); older links go there. */
export const load: PageLoad = ({ params, url }) => {
	const to = new URLSearchParams(url.search);
	to.set('live', params.ch);
	redirect(307, `/watch?${to}`);
};
