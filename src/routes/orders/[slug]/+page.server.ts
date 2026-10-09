import { error } from '@sveltejs/kit';
import { resolveOrder } from '$lib/server/watchOrders';
import { myWatchOrders } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// Awaited, not streamed: the list has to be there when you come back, or the scroll position can't be restored.
	const order = await resolveOrder(params.slug);
	if (!order) error(404, 'No watch order by that name.');

	return {
		id: params.slug,
		name: order.name,
		items: order.items,
		added: myWatchOrders().some((o) => o.id === params.slug)
	};
};
