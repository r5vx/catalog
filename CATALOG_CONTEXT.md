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

**11. The SvelteKit server is also called Catalog.exe.**
`electron/main.cjs` forks it with `execPath: process.execPath`, so Windows
lists a second `Catalog.exe`. It could outlive the window — and
`Update Catalog.bat` waits for Catalog to close, so it waited forever. The user
reported it as *"it says waiting for catalog to close, and even though its
closed nothing happens"*. The server is now stopped on `before-quit` as well as
`quit`, escalates to SIGKILL after 2s, and is killed on `process.exit`.
**Never diagnose "is Catalog running?" by process name alone.**

Also: `timeout /t 1` exits immediately with an error when its input is
redirected, which a script launched by the app always is. Use
`ping -n 2 127.0.0.1 >nul` to sleep in a batch file.

**12. `spawnSync(..., { shell: true })` concatenates arguments, it doesn't quote them.**
`run('git', ['commit', '-m', 'Release 1.0.0'])` reached git as
`commit -m Release 1.0.0`, which read the version as a pathspec and failed —
while the release carried on regardless. npm and npx need `shell: true` on
Windows because they're `.cmd` files; **git must not have it**.

**13. A release must publish *this* version's files, by name.**
Installers are named per version so they never overwrite each other — which
means `dist-release` accumulates them. Picking "the first `Catalog-Setup-*.exe`
in the folder" published **1.0.0 under the v1.0.1 tag**, with a `latest.yml`
naming a file that wasn't in the release. Every updater would have fetched that
manifest and 404'd. The folder is now cleared before each build, the installer
is found by exact name, and foreign assets are deleted from the release before
upload. **Verify a release by fetching `latest.yml` and downloading the file it
names** — that is the only check that proves the update path.

**14. A keyed `{#each}` dies on a duplicate key, and takes the page with it.**
`/person/[id]` keyed credits on title+year. TMDB credits the same title twice
(a guest spot *and* a hosting slot on one talk show), and the first duplicate
sits at index 40 — exactly what the **second** "Show more" click reveals. So it
worked once and then froze, with no visible error. Credits are deduplicated by
provider id and keyed on that. **When a list comes from an API, never key it on
anything but an id.**

**15. TMDB's `credits` for a series is not the cast.**
`/tv/{id}?append_to_response=credits` returns whoever is billed on the show
record — **four people** for The Office. The real cast is
`/tv/{id}/aggregate_credits`, which returns 689, with a `roles` array instead of
a `character`. Films are fine with plain `credits`.

**16. `--prepackaged` skips the step that writes `app-update.yml`.**
electron-updater reads `resources/app-update.yml` to learn which repo to check.
electron-builder injects it *while packaging* — but the release builds with
`--win dir` and then wraps with `--prepackaged`, which skips that phase. The
file was never written, so **every release from 1.0.0 to 1.2.1 could not update
itself**, failing with `ENOENT: app-update.yml`. It went unnoticed because the
local `dist-release` build runs in *source* mode (the batch file sits two
folders up), so electron-updater is never exercised there.

`release.mjs` writes the file itself now. **Testing a release build means
installing it**: `Catalog-Setup-x.y.z.exe /S /D=<dir>`, run it with its own
`--user-data-dir`, `CATALOG_PORT` and `CATALOG_DB`, then read
`GET /api/update` — `"mode":"release"` with a real status proves the chain.
Uninstall afterwards with `Uninstall Catalog.exe /S`.

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

### Sorting
**A sort that looks alphabetical means the column is all nulls.** Nulls sort
last and ties break on title, so an empty column produces an A-Z list. That is
how "Longest" appeared broken: `runtime_minutes` was **0 of 314**, because the
TMDB *search* endpoint returns no runtime and only tags and cast were being
saved from the detail fetch. Runtime and episode counts are now stored by
`saveFacts()` wherever details are fetched — on add, on the entry page's
enrichment, and on Refresh.

`src/lib/server/backfill.ts` walks the whole library once for anything still
missing, with a progress bar in Settings → Library. A button rather than
automatic: it is hundreds of API calls.

`sortBadge()` in `constants.ts` puts the sorted-on value on each card, and
returns null where the card already shows it (title, year, your rating).

`SORTS` in `constants.ts` carries a `group`, and `SortPicker.svelte` is a
disclosure panel rather than a dropdown — fifteen orders is too many for a flat
list. Every `column` must also appear in `SORT_COLUMNS` in `queries.ts`, which
is the allow-list that stops a sort value reaching SQL.

Score sorts (IMDb, Rotten Tomatoes, Metacritic, box office) are null until OMDb
has been asked, and nulls sort last — so with no key those views look
alphabetical, which is correct rather than broken.

### PDFs
The print dialog produced files that wouldn't open. `src/lib/server/pdf.ts`
asks the desktop app over IPC to render `/export` with
`webContents.printToPDF()` and sends the bytes back; `/api/export?format=pdf`
streams them. Browser-only installs don't get the button.

The render window has **no cookies**, so with a PIN set it would be redirected
to the login page and produce a PDF of that. `renderPdf` mints a one-time token
that `hooks.server.ts` honours once, within a minute.

Verified by page count scaling with the data: 314 titles → 11 pages, 62 → 3,
0 → 1, every one a valid `%PDF`. Text extraction does **not** work on these —
Chromium embeds subset fonts, so the words aren't ASCII in the file.

### Sharing a library
`/api/export?format=share` writes a file with the list, the public scores and
tags — and your own ratings and reviews only when asked. It is **not** a
backup: no ids, no note pages, and a different filename so the two are never
confused.

`/shared` reads a file the browser picks, with `FileReader`. **Nothing is
uploaded and nothing is stored** — the server only supplies `allTitleKeys()` so
the page can mark the overlap and filter to "only what I haven't seen", which
is the point of looking at someone else's list.

### Locked note pages
`notes.locked`, gated on the same PIN. The body is withheld **in SQL**
(`CASE WHEN locked = 1 THEN ''`), not hidden in the template — hiding it in
markup still ships it to the browser. `/api/notes` refuses to write or delete a
locked page too: saving over one is as good as destroying it. The unlock cookie
is a separate token from the login one, so signing in on a phone doesn't open
locked pages.

### Scores from elsewhere
TMDB carries its own rating and nothing else. **OMDb** (`omdbApiKey`, free,
1,000/day) supplies everything else it has: IMDb rating + votes, Rotten
Tomatoes, Metacritic, the age rating, awards and box office. Those are *all*
the rating sources OMDb returns — there is no audience score, and no
Letterboxd. Entirely optional; with no key none of it appears.

Parsing lives in **`omdbParse.ts`, which imports nothing**, so it can be run
against captured payloads with no key and no network. There is a test at
`scratchpad/omdb.test.mjs` (`node --experimental-strip-types`) covering a film,
a series with no RT entry, `N/A` handling, the Metascore fallback and the money
formatting.

**`fetchScores` returns `null` when it couldn't ask** — no key, rejected key,
daily limit, offline — versus `EMPTY_SCORES` meaning it asked and OMDb has
nothing. Only the latter is recorded as checked. Conflating them meant one bad
key, or one day over the limit, permanently stamped every title you opened as
"no scores" for a month.

A bad key comes back **HTTP 401** with the reason in the body, not a 200 — so
`verifyOmdbKey` reads the body either way and shows OMDb's own message.

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

### Updating a source build
**A build that misses its swap is not thrown away.** The helper waits five
minutes for the exe to unlock, and `rebuild.ts` writes `dist-staged/pending.txt`
naming the build. `main.cjs` reads that marker on **any** quit and starts the
helper again, so reopening Catalog while the swap is waiting delays the update
rather than wasting it. That was the real failure: two complete builds sat
unused while the app stayed on the old version, because the one-minute window
expired when the app was reopened.

**The button no longer opens a console.** `scripts/stage-update.mjs` builds into
`dist-staged` **while Catalog is still open** — nothing it writes is locked —
printing `::step n/total label` lines. `src/lib/server/rebuild.ts` reads those
and `/api/update` serves the state, which the Settings page draws as a bar.

Only the swap needs the app closed, and that's a folder move:
`scripts/apply-update.mjs` runs detached with `windowsHide: true`, waits for the
exe to unlock, renames the old folder aside, moves the new one in, deletes the
old and reopens. If the move fails it puts the old folder back, and it writes
`dist-app/last-update.txt` either way.

It decides the app has closed by **trying to open the exe for writing**, not by
looking for `Catalog.exe` in the task list — the server is forked with
Electron's binary and carries the same name (lesson 11). Opening for write is
the condition that actually matters and it's testable against a fake folder.

The pull only happens when the working tree is clean. Uncommitted changes *are*
the update in this project, and pulling over them would fight them.

`Update Catalog.bat` still exists — it's what `updateMode()` checks to tell a
source build from a release — but it's a manual fallback now.

### Updating across several versions
electron-updater reads `latest.yml` from the **newest** release and goes
straight there — it does not step through versions. Verified 2026-09-16 that a
v1.0.0 install is pointed at 1.2.1 in one hop.

Schema migrations are additive and guarded by `PRAGMA table_info`, so any
starting point converges. Verified by building a database with the **v1.0.0
schema** (`git show v1.0.0:src/lib/server/db/index.ts`), filling it, then
opening it with today's code: `box_office` and `notes.locked` were added,
integrity ok, and every rating, rewatch, favourite, status, review and note
body survived byte for byte. Worth repeating whenever a column is added.

The `.blockmap` is uploaded alongside the installer so updates download only
what changed. Both the installed and the new version need one, so it only
starts paying off from 1.2.1 onwards.

### Release notes
`RELEASE_NOTES.md` is the source. Write bullets under `## Unreleased`;
`npm run release` **refuses to run without them**, publishes them as the GitHub
release description, and stamps the heading with the version and date. The file
ships inside the app (it's in `build.files`), and Settings → Updates renders it
— so "what's new" works offline and always describes the version installed
rather than the newest one published.

Bullets are Markdown for GitHub's sake, so `whatsNew()` splits `**bold**` into
typed runs server-side. No HTML crosses to the browser and there's nothing to
sanitise.

### Releasing

`npm run release` (or **Release Catalog.bat**): bump → build → icon → installer
→ commit, tag, push → upload.

It builds into **`dist-release`**, not `dist-app`, so a release never waits for
the running app. The icon goes on **before** the installer is made — an
installer built from an un-iconed folder installs an un-iconed app, and
electron-builder's own icon step doesn't run here (lesson 8).

The installer is built with `--publish never` and **uploaded by our own code**
against the GitHub API. electron-builder's publisher writes `latest.yml` only
as it uploads, so a failed upload left an installer with no way to publish it
by hand — and **a release without `latest.yml` updates nobody**. Built this way
both files always exist and a failed upload can just be rerun.

`GH_TOKEN` comes from `.env` (gitignored, parsed by hand — no dotenv). A
fine-grained token needs **Contents: Read and write** on the repo; without it
GitHub returns a 403 whose message doesn't say which permission is missing, so
`explain()` says it instead.

**v1.0.0 shipped 2026-09-15** to `github.com/r5vx/catalog/releases`.

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
