import { myWatchOrders } from '$lib/server/db/queries';
import { libraryHeaderData } from '$lib/server/libraryHeader';
import { resolveOrder, warmFranchiseSuggestions, counts } from '$lib/server/watchOrders';
import { titleProgress } from '$lib/orderProgress';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const mine = myWatchOrders();
	warmFranchiseSuggestions();

	const lookingUp = Promise.all(
		mine.map(async ({ id, name }) => {
			const order = await resolveOrder(id);
			const released = (order?.items ?? []).filter(counts);
			const upNext = released.find((i) => i.status !== 'watched') ?? null;
			return {
				id,
				name: order?.name ?? name,
				// A show's seasons count as one title.
				watched: titleProgress(released).watched,
				released: titleProgress(released).total,
				upNext,
				// The next one to watch sets the scene; the finished ones show what's done.
				backdropUrl: (upNext ?? released.at(-1))?.backdropUrl ?? null,
				posters: released.slice(0, 6).map((i) => i.posterUrl)
			};
		})
	);

	return {
		...libraryHeaderData(),
		mine,
		// Saved answers come back in a moment, so normally the page waits and shows up complete.
		// Only a first look-up (nothing saved yet) is streamed in behind a loading line.
		franchises: (await readyWithin(lookingUp, 1500)) ?? lookingUp
	};
};

/** The answer if it arrives in time, otherwise undefined (the promise carries on). */
function readyWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
	return Promise.race([
		promise.catch(() => undefined),
		new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))
	]);
}
