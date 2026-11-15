# Catalog's meeting point

A small server on Cloudflare's free plan (a Worker and a D1 database) that Catalogs in different
houses talk through. **No video goes through it**, and nothing from a Catalog's Settings does
(never the TMDB key or the Febbox sign-in): only names, titles, progress and small notes.

It lives at `https://catalog-meeting.catalog-meet-f5725.workers.dev` (the address is built into
`src/lib/server/online.ts` and `android/assets/setup.html`).

## Files

| File | What |
| --- | --- |
| `src/worker.js` | The whole server |
| `schema.sql` | Its tables (safe to run again) |
| `wrangler.toml` | Its name and which database it uses |
| `secrets.local.json` | The join code and the owner's key. **Never on GitHub** (ignored) |

## The two keys

- **Join code** (`JOIN_CODE`): what a Catalog types under Settings → Online to join. Give it to
  family and friends. Without it nobody can join.
- **Owner's key** (`ADMIN_KEY`): typed once on the owner's own computer, to read the reports
  Catalogs send (Settings → Online → Problem reports, shown only once the key is kept). The
  server counts wrong tries per address: after 10 in a day that address is refused until tomorrow.

Both are in `secrets.local.json`. To change one: edit the file, then run
`npx wrangler secret bulk secrets.local.json` from this folder.

## Putting a change online

From this folder:

```bash
npx wrangler deploy
```

After changing `schema.sql`:

```bash
npx wrangler d1 execute catalog-meeting --remote --file schema.sql --yes
```

## Signing in with Google (not set up yet)

The server has it built, switched off until it is given a Google client:

1. In Google Cloud Console, make an OAuth client of type "Web application" with the redirect
   address `https://catalog-meeting.catalog-meet-f5725.workers.dev/v1/google/callback`.
2. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `secrets.local.json` and run the
   `secret bulk` line above.

Settings → Online then shows "Sign in with Google". Google's page opens in the computer's own
browser, and the person confirms which computer asked before anything is joined.

## How it stays safe

- A Catalog's key is random and only its SHA-256 is kept here.
- Joining needs the join code, and one address can only try a few times a day.
- Codes for friends, for joining computers and for TVs work once and run out.
- Everything sent is cut to a size and a shape; a problem report's addresses lose everything
  after `?` before they leave the house (video links carry sign-ins there).
- Each person only ever sees their own synced progress and their own friends.

## Trying it

`scripts/dev/online/cloudtest.mjs <server address> cloud/secrets.local.json` tries every address with two
pretend houses. `housetest.mjs` does the same through two test Catalogs (library copies on ports 5297
and 5301). Both leave test rows behind: empty the tables afterwards.

### Trying a change before it goes online

The server runs on this computer too, with its own empty database, so nothing real is touched:

```bash
npx wrangler d1 execute catalog-meeting --local --persist-to <a temp folder> --file schema.sql
```

```bash
npx wrangler dev --local --port 8799 --ip 127.0.0.1 --persist-to <the same folder> --var JOIN_CODE:TESTJOIN --var ADMIN_KEY:TESTADMIN
```

A test Catalog talks to it when its `settings` table has `onlineUrl` = `http://127.0.0.1:8799`.

Library sync between one person's computers: seed two empty test libraries with
`scripts/dev/online/librarytest-seed.mjs <library.db> a|b`, run them on 5297 and 5301, then
`librarytest.mjs <A's library.db> <B's library.db>` (31 checks). `cloudtest.mjs` runs against the local
server too, with a secrets file holding `{"JOIN_CODE":"TESTJOIN","ADMIN_KEY":"TESTADMIN"}`.

When `wrangler dev` is stopped from a background shell, its `workerd.exe` processes can stay behind on
port 8799 (three were found from earlier sessions on 2026-11-14): end them before starting it again.
`scripts/dev/online/seentest-seed.mjs <library.db> a|b` sets that (and a few watched titles) in two
empty test libraries, and `seentest.mjs` then tries friends-who-watched and pictures through them
(20 checks; it waits 100 s for the watched titles to be sent).
