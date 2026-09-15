/**
 * Fills in public ratings for entries added before the app started recording
 * them. Run once with `npm run backfill`.
 *
 * Only touches entries that came from a search (they have a source id) and
 * don't already have a rating. Your own ratings and notes are never touched.
 */
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './paths.mjs';

const db = new DatabaseSync(dbPath());

// Same order the app uses: the key you saved in Settings, or the env var.
const key =
	db.prepare("SELECT value FROM settings WHERE key = 'tmdbApiKey'").get()?.value ||
	process.env.TMDB_API_KEY ||
	'';

if (!key) {
	console.log('No TMDB key saved — only anime entries can be checked.');
}

const todo = db
	.prepare(
		`SELECT id, title, source, source_id AS sourceId
		 FROM entries
		 WHERE source_id IS NOT NULL AND external_rating IS NULL
		 ORDER BY id`
	)
	.all()
	.map((r) => ({ ...r }));

if (todo.length === 0) {
	console.log('Nothing to backfill — every entry already has a public rating.');
	process.exit(0);
}

console.log(`Filling in public ratings for ${todo.length} entries…\n`);

const save = db.prepare('UPDATE entries SET external_rating = ?, external_votes = ? WHERE id = ?');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function fromTmdb(sourceId) {
	if (!key) return null;

	const [kind, id] = sourceId.split(':');
	const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return null;

	const data = await response.json();
	return { rating: data.vote_average || null, votes: data.vote_count ?? null };
}

async function fromAniList(id) {
	const response = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: 'query($id:Int){Media(id:$id,type:ANIME){averageScore popularity}}',
			variables: { id: Number(id) }
		})
	});

	if (!response.ok) return null;

	const data = (await response.json())?.data?.Media;
	if (!data) return null;

	return {
		rating: data.averageScore != null ? data.averageScore / 10 : null,
		votes: data.popularity ?? null
	};
}

let done = 0;
let filled = 0;

for (const entry of todo) {
	try {
		const found =
			entry.source === 'tmdb' ? await fromTmdb(entry.sourceId) : await fromAniList(entry.sourceId);

		if (found?.rating != null) {
			save.run(found.rating, found.votes, entry.id);
			filled++;
		}
	} catch {
		// One bad lookup shouldn't stop the run.
	}

	done++;
	if (done % 25 === 0 || done === todo.length) {
		console.log(`  ${done}/${todo.length} checked, ${filled} filled in`);
	}

	// Gentle on the free APIs.
	await pause(entry.source === 'tmdb' ? 60 : 700);
}

console.log(`\nDone. ${filled} entries now have a public rating.`);
db.close();
