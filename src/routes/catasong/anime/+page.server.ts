import { bestStreaks, LEVELS, warm, warmMade } from '$lib/server/catasong/anime';
import { volume } from '$lib/server/catasong/daily';

export function load() {
	// Easy's list starts coming before Start is pressed, with a round and its song ready, and
	// so does a round for every other level whose list is already made.
	warm('easy');
	warmMade();
	return { levels: LEVELS, best: bestStreaks(), volume: volume() };
}
