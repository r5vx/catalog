# Catalog — project context

The document to re-read when starting a fresh session. It records what this is,
how it's built, why the odd decisions were made, and what went wrong so it isn't
learned twice.

Owner: BlurA. Project lives at `C:\Users\BlurA\Desktop\catalog`.

---

## What it is

A personal library of everything the user has watched — movies, TV, anime —
replacing lists they kept in the iPhone Notes app. Plus a Notes section for
free-form pages. Runs as a desktop app on their PC, reachable from their phone.

**The password vault from the original plan was dropped** (2026-09-14, user's
call). Don't raise encryption or password storage again unless they do.

---

## Stack, and why

| Choice | Reason |
| --- | --- |
| SvelteKit + Svelte 5 runes | Components read like HTML; user edits their own UI |
| **`node:sqlite`** (built into Node) | better-sqlite3 needed Visual Studio build tools they don't have |
| adapter-node | Self-hosted; no cloud |
| Electron 38 | They wanted a real app icon, like Steam or Duolingo |
| **One runtime dependency** | `dependencies` was empty on purpose until 2026-09-15; `electron-updater` is the only thing in it, and only so installed copies can update themselves |

Data lives in **`%APPDATA%\Catalog\library.db`** — shared by `npm run dev` and
the packaged app, so there's only ever one library.

---

## Hard-won lessons (the expensive ones)

**1. adapter-node assumes `https` when no protocol header is set.**
Its `get_origin()` defaults the protocol to `https`. On a plain-http app that
poisons anything comparing against `url.origin`, and **only in the packaged
build** — SvelteKit skips the CSRF check entirely in dev, so `npm run dev` looks
fine while the real app is broken. Two separate bugs came from this:
- "Cross-site POST form submissions are forbidden" on every form
- `cookies.set` marking the login cookie `Secure`, which the browser silently
  discards over http — the PIN page looped forever

Fixed with `csrf: { trustedOrigins: ['*'] }` plus a same-**host** check in
`src/hooks.server.ts`, and `secure: false` on the auth cookie.

**2. With a PIN set, every keystroke in the library search is a data request.**
`goto()` fetches `/__data.json`, which the auth hook can redirect to `/login`.
A broken session therefore presents as *"search is broken"*, not *"login is
broken"*. Chased the wrong thing for a while.

**3. Shell reads of files can be stale. The app is the source of truth.**
Reads of `settings.json` from Git Bash *and* PowerShell returned different
content than the running app saw at the same path — proven when a migration
moved a file containing a key and PIN hash that neither shell could see. Told
the user three times their settings were lost when they never were.
→ `GET /api/diagnostics` exists for this. Trust it over a shell read.

**4. Force-killing the app corrupts the database.**
Repeated `taskkill /F` on Catalog.exe while SQLite was mid-write produced
`database disk image is malformed` and cost the user 11 entries (recovered from
a snapshot). **Never force-close it.** Ask them to close it, or check
`tasklist` and skip the rebuild.

**5. When the user states a number, believe them.**
They said 199 entries; a script said 188. The script was reading a corrupted
duplicate. They were right, and arguing wasted a round trip.

**6. Test against the packaged build, not `npm run dev`.**
Several bugs only exist in the packaged app. Use a throwaway database
(`CATALOG_DB=<temp>`) on a **port other than 5173** so their session is never
touched.

**7. SvelteKit route files can only export HTTP handlers.**
`export const mediaDir` / `export function updaterPath` from a `+server.ts`
throws at runtime. Put helpers in `$lib/server/`.

**8. electron-builder's icon step never ran.**
Its winCodeSign bundle fails to unpack (macOS symlinks need Developer Mode) and
it calls that fatal, so the exe kept the default icon for days. `npm run pack`
is now `scripts/pack.mjs`, which judges success by whether the exe appeared and
then sets the icon itself with rcedit from that same cache.

**9. Svelte inputs bound to props reset while you type.**
`EntryForm` used `value={entry.title}`. Any refresh of the page data reset every
field to the stored value mid-sentence, which the user reported as *"all the
text boxes stop working randomly"*. Every field now seeds its own `$state` once
via `untrack` and uses `bind:value`, so typing is immune to reloads.
Consequence: after a re-match the form must be **reloaded**, not invalidated —
otherwise it holds the old poster and saving writes it back.

**10. Cast links only cover the top 15 billed, so don't use them as "do I own this".**
Samuel L. Jackson's cameos in Iron Man and Thor fall outside stored billing, so
"Also known for" listed films the user plainly had. It now checks
`allTitleKeys()` — every title in the library, normalised — not the person's
cast links.

---

## How the pieces work

### Metadata
- **AniList** for anime — no key needed
- **TMDB** for movies/TV — free key, stored in the `settings` table

**Ranking** (`src/lib/server/metadata/index.ts`): title match dominates
(exact 3 / prefix-or-suffix 2 / contains 1, ×10), then a year hint (+4), then
fame (×5). Fame comes from **`vote_count`, not TMDB's `popularity`** — the
latter is a "trending this week" score, which is how a 1987 TV show once beat
the 2012 *21 Jump Street* film. `fameScore()` anchors to a floor and ceiling so
obscure genuinely reads as obscure.

**Search quirks handled:** TMDB returns nothing for `wall-e` (real title is
`WALL·E`, middle dot) and treats "and" and "&" as different words. Both forms
are searched and merged; punctuation variants are a fallback. Zero-vote,
no-date placeholder records are filtered out. Results are ranked **before**
trimming — X-Men (2000) sits 14th in TMDB's own order.

**De-duplication** keys on title + year + **category** — without the category,
the 2008 *Clone Wars* series and film collapsed into one and the film vanished.

### Settings
Live in a `settings` table inside `library.db`, **not** a JSON file — the file
kept losing writes (see lesson 3). `scripts/backup.mjs` deliberately skips that
table so the API key never reaches GitHub.

### Tags and cast
Derived from what the databases already know, never invented:
genres, **all** production companies, director (or `created_by` for TV),
franchise (TMDB collections, "Collection" trimmed), and the top 15 billed cast.
Anime gets genres + main studio from AniList.

**Anime cast is the Japanese voice actors**, from AniList's
`characters.voiceActors`, labelled with the character they play. Person ids are
namespaced — `tmdb:1245` vs `anilist:95067`.

The tag filter is a **searchable multi-select panel** (`src/lib/TagFilter.svelte`),
not a dropdown — there are 800+ tags. Groups (Genres / Studios / Directors /
Franchises) start **collapsed**; you open one, or type to search across all.
Selected tags show as removable chips and combine with AND. URL carries
repeated `?tag=` params.

**Category tabs preserve the query string** (`CategoryTabs.link()`), so sort,
search and filters are app-wide settings rather than something you reapply per
tab.

**Name matching is word-by-word, not phrase-based.** "samuel jackson" has to
find "Samuel L. Jackson"; a LIKE on the whole phrase never will. Both
`/people` and the library search split the query and require every word.
`/person/[id]` lists what you've watched plus "Also known for" from TMDB
combined_credits / AniList staff, filtered to things you don't already have.
That fetch goes **200 deep**, not top-20: for someone whose famous work the user
has mostly seen, a short list filters down to nothing. The page shows 20 at a
time with a "Show 20 more" button.

### Navigation
`src/lib/nav.ts` stashes the library's query string in sessionStorage, so
"← Library" from an entry restores the sort/filter/search you left — it used to
reset to "Recently added". Cast links carry `?from=<entryId>`, and the person
page's back link returns to that film (rendered server-side from `data.from`,
not in an effect, so there's no flash of the wrong label).

### Appearance
One accent colour is stored (`accentColor` in settings); `--accent-ink` is
derived from relative luminance and `--accent-bg` via `color-mix`, so a single
choice stays coherent in both themes. Applied as an inline style on the app
wrapper in `+layout.svelte`, loaded once in `+layout.server.ts`.

The **hex box is the submitted field**, not a read-only label — you can paste
into it, with or without the leading `#`. The picker and the box write to each
other, and Save is disabled until the value is a complete six-digit hex.

### Export
`src/lib/server/export.ts` builds the files; `rowsFor(url)` reads the same
`?cat=`, `?status=`, `?sort=` parameters the library uses, so an export is
described the same way a view of the library is. Default order is Title (A–Z)
— a printed list wants alphabetical, not "recently added".

| Route | What |
| --- | --- |
| `/export` | a real printable page — the browser's "Save as PDF" makes the PDF |
| `/api/export?format=csv` | spreadsheet, UTF-8 **BOM** first or Excel mangles accents |
| `/api/export?format=txt` | plain list, grouped and numbered per category |
| `/api/export?format=json` | full backup, **ignores the filters** |

There is no PDF library: a styled page plus the print dialog does the job with
nothing added to `dependencies`. The print rules live in the page's own
`<style>` — `:global(.app)` to undo the layout's max-width, explicit black on
white so neither theme leaks onto paper, `thead { display: table-header-group }`
to repeat the column headings on every page.

The JSON export matches `scripts/backup.mjs` byte-for-byte in shape, so a file
saved from the app restores with `npm run restore`. It leaves out `settings`
for the same reason the backup does — the TMDB key.

A **filtered** JSON backup would be a trap: restoring one would quietly drop
everything it excluded. So the filters apply to csv/txt/print and not to json.

### Settings, as sections
One page per section under `/settings/*`, with a shared `+layout.svelte` holding
the nav: **Appearance / Library / Services / Privacy / Updates**. `/settings`
itself is an "at a glance" summary.

Two columns on a wide screen, and on a phone it behaves like a phone's own
settings — the index is the list, and picking one replaces it. That's the
`.shell.index` class plus a 720px breakpoint, not two separate layouts.

Adding a section means a folder and an entry in `SECTIONS`. Updates hides
itself when `updateMode` is `none`.

### Reading about a title
Every title has a page worth landing on, not just a form.

**`/entry/[id]`** — poster, status, scores, synopsis, tags, cast, and *then* a
closed `<details>` holding the edit form, the re-match tool and delete. The
user's words: clicking a film shouldn't "immediately show you a ton of text
boxes". Shared pieces are `ScoreStrip`, `Synopsis`, `TagChips` and `CastRow`.

**`/title/[source]/[id]`** — the same page for something you *don't* own,
reached by clicking an actor's "also known for". `[id]` is the provider's own
id, colon and all: `/title/tmdb/movie:550`. Anything already in the library
**redirects to its entry**, so there's never a preview of something you have.
Its cast links only for people already in `people` — the rest would be dead
links.

On the person page the `+` button is a **sibling** of the card link, not inside
it: a button nested in an anchor is invalid and swallows the click.

### Scores from elsewhere
TMDB carries its own rating and nothing else. IMDb, Rotten Tomatoes and
Metacritic come from **OMDb** (`omdbApiKey`, free, 1,000/day), which is the one
free source carrying all three in one response. Entirely optional — with no key
the section simply doesn't appear.

Looked up by IMDb id where TMDB gives one (`append_to_response=external_ids`
for TV; films carry `imdb_id` directly), and by title+year for AniList, which
has no IMDb id at all.

**Stored on the entry, not fetched per view** — `imdb_rating`, `rt_score`,
`metascore`, `content_rating`, `awards`, `scores_checked_at`. `POST /api/scores`
runs *after* the page renders so a slow API never blocks it, and a lookup that
finds nothing still stamps `scores_checked_at` — otherwise every page view
re-asks about something OMDb has never heard of.

That endpoint also backfills the synopsis, tags and cast for entries added
before the app kept them, and **returns the tags and cast** rather than letting
the page reload — a reload would throw away anything half-typed in the edit
form.

### Notes
`notes` table; rich text via `contenteditable` + `execCommand` (still the only
thing browsers implement consistently). Images upload to
`%APPDATA%\Catalog\media\` and are served by `/media/[file]`. Saved HTML is
sanitised — pasted scripts, `on*` handlers and `javascript:` URLs are stripped,
Svelte marker comments removed.

### Episode tracking
`(S1E23)` style markers are parsed on import (many formats; asterisks stripped;
`Blade Runner 2049` correctly keeps its year). `npm run refresh` fetches
per-season counts and reports how many episodes are waiting.
**Imports always land as Completed** — a marker often records where a finished
show ended, so status is the user's to set.

---

## Commands

```
npm run dev        work on it, live reload
npm run pack       rebuild the desktop app (also sets the icon)
npm run icon       redraw the icon — 9 sizes, each drawn natively
npm run tag        derive tags + cast (add --all to redo everything)
npm run refresh    check series for unwatched episodes
npm run backfill   fill in public ratings for older entries
npm run backup     export + snapshot + push to GitHub
npm run restore    preview a restore (-- --write to apply)
npm run check      type check
npm run release    build and publish a new version to everyone
```

**Testing against their real data safely:** copy `library.db` (plus `-wal`,
`-shm`) to a scratch folder, clear `pinHash` in the copy, point `CATALOG_DB` at
it and serve on port 5199. The real app can stay open throughout — nothing is
shared. Optional fields (ratings, rewatches, favourites, `last_season`) are all
empty in the real library, so seed a few rows in the copy or those code paths
go untested.

Updating is also a button: **Settings → Update Catalog**. It launches
`Update Catalog.bat`, which waits for the app to close, rebuilds, and reopens
it. The user does not use a terminal — don't tell them to run commands.

---

## Backups

Nightly at 3am via Task Scheduler ("Catalog Backup"), plus on demand.

| Layer | What |
| --- | --- |
| `library.json` | readable export, pushed to `github.com/r5vx/catalog-backups` (private) |
| `snapshots/*.db` | last 14 database copies — the fast restore |
| `media/` | note images, gitignored |

Restore has been tested end to end, not just written.

---

## Sharing it with other people

Decided 2026-09-15: **public repo, anyone can install; each friend brings their
own TMDB key.** Built the same day.

### How a friend gets it and keeps it

They download `Catalog-Setup-<version>.exe` from the repo's Releases page and
run it. From then on `electron-updater` checks GitHub on every launch,
downloads a new version in the background and installs it on quit. No account,
no server, no shared anything — their library is a file on their own PC.

**Two update paths now exist and the app picks between them itself.**
`electron/main.cjs` looks for `Update Catalog.bat` two folders above the exe:

| Found | Mode | What Settings offers |
| --- | --- | --- |
| yes | `source` | rebuild in place — the owner's own copy |
| no | `release` | check / download / restart — an installed copy |
| (`npm run dev`) | `none` | no Updates section at all |

The mode is passed to the server as `CATALOG_UPDATE_MODE`.

**Progress has to cross a process boundary.** Only Electron can talk to GitHub,
only the SvelteKit server can answer the browser. They already had an IPC
channel (it's how `quit-for-update` works), so update events travel over it and
`src/lib/server/updater.ts` parks the latest state for the page to poll at
`GET /api/update`. That listener is registered from `hooks.server.ts` — via a
side-effect import — so the check made at launch isn't lost before anyone opens
Settings.

### Releasing

`npm run release` (or **Release Catalog.bat**): bump → `npm run pack` → wrap in
an installer → commit, tag, push → upload.

The installer step is `electron-builder --win nsis --prepackaged
dist-app/win-unpacked`, **not** a plain nsis build. `npm run pack` sets the icon
with rcedit after electron-builder gives up (lesson 8), so the installer has to
be made from the folder that already has the icon on it — otherwise an
installed Catalog gets Electron's default icon back.

Publishing reads `GH_TOKEN` from `.env` (gitignored, parsed by hand — no dotenv
dependency). Without a token it still builds and prints what to upload. Both
files matter: **a release without `latest.yml` updates nobody.**

Verified 2026-09-15: `--win nsis` completes cleanly and produces a 96 MB
installer plus `latest.yml`. The winCodeSign failure from lesson 8 does not
affect this target — signing is simply skipped.

### First run

`setupNeeded()` in `settings.ts` gates a `/welcome` screen (redirect lives in
`hooks.server.ts`). It **self-heals for existing installs**: a library with
entries, or a key already saved, is marked done rather than asking someone who
has used the app for months to introduce themselves to it. Answering it either
way sets `setupDone` permanently.

### What is still the owner's alone

- `scripts/backup.mjs` pushes to **`r5vx/catalog-backups`**. Friends can't use
  it; Settings → Export → full backup is their substitute.
- The nightly Task Scheduler job.
- `electron-updater` is now the **only** entry in `dependencies`, which used to
  be empty on purpose. It earns its place: an installed app has no source code,
  no npm and no `node_modules`, so nothing else can update it.

### Deliberately not done

- **Code signing.** A certificate is a few hundred a year; friends click through
  SmartScreen's "unknown publisher" once. The README says so up front so nobody
  thinks the app is malware.
- **Bundling the owner's TMDB key.** In a public repo it would be scraped and
  disabled within days.

## Working style the user wants

- **Don't over-explain in the UI.** They called the chatty copy out; it was cut.
- **Answer the current message**, not things from several messages ago.
- They have limited coding experience and depend on me to write it, but want to
  be able to change the UI themselves — readability beats cleverness.
- Styling tokens all live at the top of `src/app.css`.
- Every database query is plain SQL in `src/lib/server/db/queries.ts`.
