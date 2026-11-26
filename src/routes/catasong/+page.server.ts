import { genreLabel, genreList, isGenre, MAIN_GENRES, STEPS, volume, warmMain } from '$lib/server/catasong/daily';

export function load({ url }) {
	const asked = url.searchParams.get('g');
	const genre = isGenre(asked) ? asked : 'rap';
	// ?m=endless: random songs one after another instead of the day's song.
	const mode = url.searchParams.get('m') === 'endless' ? 'endless' : 'daily';
	warmMain();
	return { genre, mode, label: genreLabel(genre), main: MAIN_GENRES, genres: genreList(), steps: STEPS, volume: volume() };
}
