/**
 * Checks your series for episodes you haven't seen yet.
 *
 * Run it with `npm run refresh`. It only looks at TV and anime entries, and it
 * only reads — your ratings, notes and positions are never touched.
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

const shows = db
	.prepare(
		`SELECT id, title, source, source_id AS sourceId, last_season AS lastSeason,
		        last_episode AS lastEpisode
		 FROM entries
		 WHERE source_id IS NOT NULL
		   AND (source = 'anilist' OR source_id LIKE 'tv:%')
		 ORDER BY title`
	)
	.all()
	.map((r) => ({ ...r }));

if (shows.length === 0) {
	console.log('No series to check yet.');
	process.exit(0);
}

console.log(`Checking ${shows.length} series…\n`);

const save = db.prepare(
	`UPDATE entries SET episodes_total = ?, show_status = ?, season_counts = ?,
	        next_air_date = ?, checked_at = ? WHERE id = ?`
);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function fromTmdb(sourceId) {
	if (!key) return null;

	const id = sourceId.split(':')[1];
	const url = new URL(`https://api.themoviedb.org/3/tv/${id}`);
	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return null;

	const data = await response.json();

	// Season 0 is specials; it shouldn't count towards being behind.
	const counts = {};
	for (const season of data.seasons ?? []) {
		if (season.season_number > 0) counts[season.season_number] = season.episode_count;
	}

	return {
		total: data.number_of_episodes ?? null,
		status: data.status ?? null,
		counts: Object.keys(counts).length ? JSON.stringify(counts) : null,
		next: data.next_episode_to_air?.air_date ?? null
	};
}

async function fromAniList(id) {
	const response = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query:
				'query($id:Int){Media(id:$id,type:ANIME){episodes status nextAiringEpisode{airingAt episode}}}',
			variables: { id: Number(id) }
		})
	});

	if (!response.ok) return null;

	const data = (await response.json())?.data?.Media;
	if (!data) return null;

	return {
		total: data.episodes ?? null,
		status: data.status ?? null,
		counts: null, // AniList lists each season as its own entry
		next: data.nextAiringEpisode?.airingAt
			? new Date(data.nextAiringEpisode.airingAt * 1000).toISOString().slice(0, 10)
			: null
	};
}

const behind = [];
let checked = 0;

for (const show of shows) {
	try {
		const info =
			show.source === 'tmdb' ? await fromTmdb(show.sourceId) : await fromAniList(show.sourceId);

		if (info) {
			save.run(info.total, info.status, info.counts, info.next, new Date().toISOString(), show.id);

			// Only worth reporting if you told us where you stopped.
			if (info.total && (show.lastSeason !== null || show.lastEpisode !== null)) {
				let watched = show.lastEpisode ?? 0;

				if (info.counts && show.lastSeason !== null) {
					const counts = JSON.parse(info.counts);
					watched = 0;
					for (const [season, episodes] of Object.entries(counts)) {
						if (Number(season) < show.lastSeason) watched += episodes;
					}
					watched += show.lastEpisode ?? counts[String(show.lastSeason)] ?? 0;
				}

				const remaining = Math.max(0, info.total - watched);
				if (remaining > 0) behind.push({ title: show.title, remaining, next: info.next });
			}
		}
	} catch {
		// One failed lookup shouldn't end the run.
	}

	checked++;
	if (checked % 20 === 0 || checked === shows.length) {
		console.log(`  ${checked}/${shows.length} checked`);
	}

	await pause(show.source === 'tmdb' ? 60 : 700);
}

db.close();

if (behind.length === 0) {
	console.log('\nYou are caught up on everything you have tracked.');
} else {
	console.log(`\nEpisodes waiting for you:\n`);
	behind
		.sort((a, b) => b.remaining - a.remaining)
		.forEach((s) => {
			const next = s.next ? `  (next ${s.next})` : '';
			console.log(`  ${String(s.remaining).padStart(4)}  ${s.title}${next}`);
		});
}
