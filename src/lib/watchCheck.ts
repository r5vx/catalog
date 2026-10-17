/**
 * The Watch button's check, as it goes: asks the computer every second where each source's
 * check is at (/api/watch/available?now=1), until every source has answered (the button can
 * turn to Watch before that; the row shows which sources have it). `onChange` gets the
 * answer so far (null while checking) and each source's progress. Returns a function that stops
 * asking (for when the page changes).
 */
export type SourceCheck = { name: string; state: 'checking' | 'yes' | 'no' };

export function checkWatchable(
	params: URLSearchParams,
	onChange: (available: boolean | null, sources: SourceCheck[]) => void
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const query = new URLSearchParams(params);
	query.set('now', '1');
	const ask = async () => {
		try {
			const answer: { available: boolean | null; sources?: SourceCheck[] } = await fetch(`/api/watch/available?${query}`).then((r) => r.json());
			if (stopped) return;
			const sources = answer.sources ?? [];
			onChange(answer.available, sources);
			if (answer.available !== null && !sources.some((s) => s.state === 'checking')) return;
		} catch {
			if (stopped) return;
		}
		timer = setTimeout(ask, 1000);
	};
	ask();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
