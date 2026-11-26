/** Interleave weekly categories in a fixed order, irrespective of network arrival order. */
export function mixWeekly<T extends { href: string }>(groups: T[][], limit: number): T[] {
	const result: T[] = [], seen = new Set<string>();
	const indexes = groups.map(() => 0);
	while (result.length < limit) {
		const before = result.length;
		for (const [i, items] of groups.entries()) {
			while (indexes[i] < items.length) {
				const item = items[indexes[i]++];
				if (seen.has(item.href)) continue;
				seen.add(item.href);
				result.push(item);
				break;
			}
			if (result.length === limit) break;
		}
		if (result.length === before) break;
	}
	return result;
}
