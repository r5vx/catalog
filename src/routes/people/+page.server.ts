import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q');
	const target = q ? `/browse?cat=actors&q=${encodeURIComponent(q)}` : '/browse?cat=actors';
	redirect(301, target);
};
