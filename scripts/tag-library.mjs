/**
 * Works out tags for everything already in your library.
 *
 * Tags come from what the databases already know — genres, the studio, the
 * director, the franchise — so "all my Marvel" or "everything Tarantino" works
 * without you labelling 300 films by hand. Run it with `npm run tag`.
 */
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './paths.mjs';

const db = new DatabaseSync(dbPath());

// The app adds this column when it boots; this script may run first.
db.exec(`
	CREATE TABLE IF NOT EXISTS people (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		photo TEXT
	);
	CREATE TABLE IF NOT EXISTS entry_cast (
		entry_id INTEGER NOT NULL, person_id INTEGER NOT NULL,
		character TEXT, ord INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (entry_id, person_id)
	);
	CREATE INDEX IF NOT EXISTS entry_cast_person_idx ON entry_cast(person_id);
	CREATE INDEX IF NOT EXISTS people_name_idx ON people(name);
`);

const tagColumns = db.prepare('PRAGMA table_info(tags)').all().map((c) => c.name);
if (!tagColumns.includes('kind')) {
	db.exec("ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'");
	console.log('Added the missing `kind` column to tags.');
}

const key =
	db.prepare("SELECT value FROM settings WHERE key = 'tmdbApiKey'").get()?.value ||
	process.env.TMDB_API_KEY ||
	'';

const onlyNew = !process.argv.includes('--all');

const entries = db
	.prepare(
		`SELECT id, title, source, source_id AS sourceId FROM entries
		 WHERE source_id IS NOT NULL
		 ${onlyNew ? 'AND (id NOT IN (SELECT entry_id FROM entry_tags) OR id NOT IN (SELECT entry_id FROM entry_cast))' : ''}
		 ORDER BY id`
	)
	.all()
	.map((r) => ({ ...r }));

if (entries.length === 0) {
	console.log('Everything is already tagged. Use --all to redo them.');
	process.exit(0);
}

console.log(`Tagging ${entries.length} entries…\n`);

const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
const addTag = db.prepare('INSERT INTO tags (name, kind) VALUES (?, ?)');
const clear = db.prepare('DELETE FROM entry_tags WHERE entry_id = ?');
const link = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');

const findPerson = db.prepare('SELECT id FROM people WHERE source_id = ?');
const addPerson = db.prepare('INSERT INTO people (source_id, name, photo) VALUES (?, ?, ?)');
const updatePerson = db.prepare('UPDATE people SET name = ?, photo = ? WHERE id = ?');
const clearCast = db.prepare('DELETE FROM entry_cast WHERE entry_id = ?');
const linkCast = db.prepare(
	'INSERT OR IGNORE INTO entry_cast (entry_id, person_id, character, ord) VALUES (?, ?, ?, ?)'
);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdbTags(sourceId) {
	if (!key) return { tags: [], cast: [] };
	const [kind, id] = sourceId.split(':');
	if (!id) return { tags: [], cast: [] };

	const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
	url.searchParams.set('append_to_response', 'credits');
	const init = key.startsWith('eyJ')
		? { headers: { Authorization: `Bearer ${key}` } }
		: (url.searchParams.set('api_key', key), {});

	const response = await fetch(url, init);
	if (!response.ok) return { tags: [], cast: [] };

	const d = await response.json();
	const tags = [];

	for (const g of d.genres ?? []) if (g?.name) tags.push([g.name, 'genre']);
	for (const c of d.production_companies ?? []) {
		if (c?.name) tags.push([c.name, 'studio']);
	}
	for (const p of (d.credits?.crew ?? []).filter((c) => c.job === 'Director')) {
		if (p?.name) tags.push([p.name, 'director']);
	}
	for (const p of d.created_by ?? []) if (p?.name) tags.push([p.name, 'director']);
	if (d.belongs_to_collection?.name) {
		tags.push([d.belongs_to_collection.name.replace(/\s+Collection$/i, '').trim(), 'franchise']);
	}

	const cast = (d.credits?.cast ?? []).slice(0, 15).map((p) => ({
		sourceId: `tmdb:${p.id}`,
		name: String(p.name ?? ''),
		photo: p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : null,
		character: p.character || null
	}));

	return { tags, cast };
}

async function anilistTags(id) {
	const response = await fetch('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: `query($id:Int){Media(id:$id,type:ANIME){
				genres
				studios(isMain:true){nodes{name}}
				characters(sort:ROLE,perPage:15){edges{
					node{name{full}}
					voiceActors(language:JAPANESE){id name{full} image{medium}}
				}}
			}}`,
			variables: { id: Number(id) }
		})
	});
	if (!response.ok) return { tags: [], cast: [] };

	const m = (await response.json())?.data?.Media;
	if (!m) return { tags: [], cast: [] };

	const tags = [];
	for (const g of m.genres ?? []) tags.push([g, 'genre']);
	for (const s of m.studios?.nodes ?? []) if (s?.name) tags.push([s.name, 'studio']);

	// For anime the cast is the voice actors, labelled with who they play.
	const cast = [];
	const seen = new Set();
	for (const edge of m.characters?.edges ?? []) {
		const va = edge?.voiceActors?.[0];
		if (!va?.id || !va?.name?.full) continue;
		const sourceId = `anilist:${va.id}`;
		if (seen.has(sourceId)) continue;
		seen.add(sourceId);
		cast.push({
			sourceId,
			name: va.name.full,
			photo: va.image?.medium ?? null,
			character: edge.node?.name?.full ?? null
		});
	}

	return { tags, cast };
}

let done = 0;
let tagged = 0;
let castAdded = 0;

for (const entry of entries) {
	try {
		const { tags, cast } =
			entry.source === 'tmdb' ? await tmdbTags(entry.sourceId) : await anilistTags(entry.sourceId);

		if (tags.length > 0) {
			clear.run(entry.id);
			for (const [name, kind] of tags) {
				const clean = String(name).trim();
				if (!clean) continue;
				const existing = findTag.get(clean);
				const tagId = existing?.id ?? Number(addTag.run(clean, kind).lastInsertRowid);
				link.run(entry.id, tagId);
			}
			tagged++;
		}

		if (cast.length > 0) {
			clearCast.run(entry.id);
			cast.forEach((person, index) => {
				if (!person.sourceId || !person.name) return;
				const existing = findPerson.get(person.sourceId);
				const personId = existing
					? (updatePerson.run(person.name, person.photo, existing.id), existing.id)
					: Number(addPerson.run(person.sourceId, person.name, person.photo).lastInsertRowid);
				linkCast.run(entry.id, personId, person.character, index);
			});
			castAdded++;
		}
	} catch {
		// keep going
	}

	done++;
	if (done % 25 === 0 || done === entries.length) {
		console.log(`  ${done}/${entries.length} checked — ${tagged} tagged, ${castAdded} with cast`);
	}

	await pause(entry.source === 'tmdb' ? 60 : 700);
}

db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)');

const top = db
	.prepare(
		`SELECT t.name, t.kind, COUNT(*) AS n FROM tags t
		 JOIN entry_tags et ON et.tag_id = t.id
		 GROUP BY t.id ORDER BY n DESC LIMIT 12`
	)
	.all();

console.log(`\nDone. Most common tags:\n`);
for (const t of top) console.log(`  ${String(t.n).padStart(4)}  ${t.name}  (${t.kind})`);

db.close();
