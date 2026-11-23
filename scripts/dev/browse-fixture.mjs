// Offline provider fixture for browse-check.mjs.
const fetchLocal = globalThis.fetch;
const movie = (id, title) => ({
	id, title, media_type: 'movie', release_date: '2016-06-01', vote_count: 420,
	popularity: 10, vote_average: 7, genre_ids: [18], original_language: 'en'
});
const titles = new Map();

globalThis.fetch = async (input, options) => {
	const url = new URL(typeof input === 'object' && 'url' in input ? input.url : input);
	if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return fetchLocal(input, options);
	if (url.hostname !== 'api.themoviedb.org') return new Response(null, { status: 503 });

	const page = Number(url.searchParams.get('page')) || 1;
	if (url.pathname === '/3/search/multi') return Response.json({ results: [movie(11, 'Fixture Film')] });
	const id = Number(url.pathname.match(/^\/3\/movie\/(\d+)$/)?.[1]);
	if (id) return Response.json({ ...movie(id, titles.get(id) ?? 'Fixture Film'), credits: { cast: [] }, runtime: 83 });
	if (/^\/3\/(discover|trending)\/movie(?:\/week)?$/.test(url.pathname)) {
		const genre = Number(url.searchParams.get('with_genres')) || 0;
		const result = movie(1000 + genre * 1000 + page, `Fixture shelf ${genre} page ${page}`);
		titles.set(result.id, result.title);
		return Response.json({ results: [result] });
	}
	return Response.json({ results: [] });
};
