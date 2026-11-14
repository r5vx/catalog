-- Catalog's meeting point (cloud/README.md). Applied with:
--   npx wrangler d1 execute catalog-meeting --remote --file cloud/schema.sql
-- Every statement can be run again safely.

-- One Catalog on one computer. Its key is never kept, only its SHA-256.
CREATE TABLE IF NOT EXISTS houses (
	id TEXT PRIMARY KEY,
	key_hash TEXT NOT NULL,
	name TEXT NOT NULL DEFAULT '',
	created INTEGER NOT NULL,
	seen INTEGER NOT NULL
);

-- One person, on however many computers. google_sub is Google's own id for them, when they signed in that way.
CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL DEFAULT '',
	google_sub TEXT UNIQUE,
	email TEXT,
	rev INTEGER NOT NULL DEFAULT 0,
	created INTEGER NOT NULL
);

-- A profile of a house is one account.
CREATE TABLE IF NOT EXISTS members (
	house TEXT NOT NULL,
	profile INTEGER NOT NULL,
	account TEXT NOT NULL,
	PRIMARY KEY (house, profile)
);
CREATE INDEX IF NOT EXISTS members_account ON members (account);

-- Short codes that are used once: "link" joins a computer to an account, "friend" makes two accounts friends,
-- "google" is a Google sign-in under way (code = its state).
CREATE TABLE IF NOT EXISTS codes (
	code TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	account TEXT NOT NULL,
	house TEXT NOT NULL DEFAULT '',
	profile INTEGER NOT NULL DEFAULT 0,
	expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friends (
	a TEXT NOT NULL,
	b TEXT NOT NULL,
	since INTEGER NOT NULL,
	PRIMARY KEY (a, b)
);

-- What someone is watching right now (only while they share it).
CREATE TABLE IF NOT EXISTS presence (
	account TEXT PRIMARY KEY,
	what TEXT NOT NULL,
	at INTEGER NOT NULL
);

-- What someone has watched, for "friends who've seen this" (only while they share it).
CREATE TABLE IF NOT EXISTS seen (
	account TEXT NOT NULL,
	tkey TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	rating REAL,
	PRIMARY KEY (account, tkey)
);
CREATE INDEX IF NOT EXISTS seen_key ON seen (tkey);

-- Watching together: one room, what's playing and where, and who's in it.
CREATE TABLE IF NOT EXISTS rooms (
	code TEXT PRIMARY KEY,
	host TEXT NOT NULL,
	state TEXT NOT NULL,
	rev INTEGER NOT NULL DEFAULT 0,
	updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
	code TEXT NOT NULL,
	account TEXT NOT NULL,
	name TEXT NOT NULL DEFAULT '',
	at INTEGER NOT NULL,
	PRIMARY KEY (code, account)
);

-- Problem reports a Catalog sent by itself.
CREATE TABLE IF NOT EXISTS reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	house TEXT NOT NULL,
	house_name TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL,
	created INTEGER NOT NULL
);

-- Work one house did that every house can use (intro and credit times, subtitle timing, copy sharpness).
CREATE TABLE IF NOT EXISTS shared (
	kind TEXT NOT NULL,
	skey TEXT NOT NULL,
	value TEXT NOT NULL,
	house TEXT NOT NULL,
	updated INTEGER NOT NULL,
	PRIMARY KEY (kind, skey)
);

-- A computer waiting for a TV to find it by a short code.
CREATE TABLE IF NOT EXISTS pairs (
	code TEXT PRIMARY KEY,
	house TEXT NOT NULL,
	what TEXT NOT NULL,
	expires INTEGER NOT NULL
);

-- An account's library and progress, kept in step between its computers. Newest change wins.
CREATE TABLE IF NOT EXISTS sync_rows (
	account TEXT NOT NULL,
	kind TEXT NOT NULL,
	skey TEXT NOT NULL,
	value TEXT NOT NULL,
	updated INTEGER NOT NULL,
	rev INTEGER NOT NULL,
	PRIMARY KEY (account, kind, skey)
);
CREATE INDEX IF NOT EXISTS sync_rev ON sync_rows (account, rev);

-- How many times an address tried something limited today (new houses, pairing codes).
CREATE TABLE IF NOT EXISTS tries (
	who TEXT NOT NULL,
	day TEXT NOT NULL,
	n INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (who, day)
);

-- An account's picture (Settings → Profile): a small square image as a data address. `rev` goes up
-- with each new one, so a Catalog knows when to fetch it again.
CREATE TABLE IF NOT EXISTS avatars (
	account TEXT PRIMARY KEY,
	image TEXT NOT NULL,
	rev INTEGER NOT NULL DEFAULT 1
);
