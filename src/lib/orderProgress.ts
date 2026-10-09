/**
 * "x of y watched" for a watch list, counting titles rather than lines: the seasons of one
 * show are one title, watched once every season of it in the list is watched.
 */
export function titleProgress(items: { sourceId: string; status: string }[]): { watched: number; total: number } {
	const done = new Map<string, boolean>();
	for (const item of items) {
		done.set(item.sourceId, (done.get(item.sourceId) ?? true) && item.status === 'watched');
	}
	return { watched: [...done.values()].filter(Boolean).length, total: done.size };
}
