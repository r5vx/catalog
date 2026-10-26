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
then sets the icon itself with rcedit from that same cache. If rcedit says
"Unable to commit changes", something (usually antivirus scanning the new exe)
has it open for a moment: everything else is built, so just run
`node scripts/set-exe-icon.mjs` again.

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

**17. Waiting for the app to close is not a mechanism.**
The swap needs Catalog shut, so the helper waited for it — and a finished 1.4.0
build sat unused for five minutes because the app stayed open. It only applied
when the user happened to close it, which read to them as "clicking update does
nothing". **The update is installed at startup now**: a pending marker makes the
app restart into the new build before opening a window, which converges whatever
happened before.

That path must be loop-proof. Restarting into an update that can't install would
mean the window never opens at all, so the marker carries an attempt count and
gives up after two, leaving a note instead. Verified by simulation: restart,
restart, then open normally.

**Verified on the real app, not only in theory.** Stage a build, write
`dist-staged/pending.txt` with a deliberately *different* version so the
startup check fires, then launch `dist-app/win-unpacked/Catalog.exe`. What
proves it: `dist-app`'s `app.asar` mtime moves to the staged build's, the marker
deletes itself, `last-update.txt` reads "Updated.", and the app answers HTTP 200
having relaunched. A successful swap renames only `<staged>/win-unpacked` into
place, so the parent folder is left behind empty — the next build's tidy loop
removes it, and it is not a sign of failure.

Two helpers were also racing — one from pressing Update, one from the quit
handler. The first swapped and relaunched the app; the second found the folder
busy and **overwrote "Updated." with an EPERM failure**, so a working update
reported itself broken. `dist-staged/applying.txt` is the lock; the loser exits
quietly. **When diagnosing an update, read the timestamps, not just the note.**

**18. The owner's copy is an installed release build now, not a source build.**
It ran the source-mode updater — rebuild, stage, swap — and that path failed on
four consecutive versions, each time differently (lessons 17, 19, 20). The
friend's copy, which updates from GitHub Releases through electron-updater,
never failed once. The owner was the only person running that mechanism, so it
was also the only one being tested in anger, on the machine with real data on
it.

So the owner now installs `Catalog-Setup-x.y.z.exe` like everyone else:
`%LOCALAPPDATA%\Programs\Catalog`, `app-update.yml` inside, registered in
Add/Remove Programs. The library is untouched by this — both builds read
`%APPDATA%\Catalog\library.db`, so switching cost nothing.

`dist-app` and the `Update Catalog.bat` path still exist for development
builds, and `SOURCE_MODE` still keys off that batch file two folders up. **But
nothing anyone uses depends on it any more.** If a dev build is packed for
testing, delete `dist-app` afterwards: a second Catalog on the machine is how
the library got corrupted (lesson 21).

**19. "Did it work?" is not the same question as "did I start it?"**
The 1.6.0 update failed on the owner's own machine, and the reason is worth
keeping. The helper was waiting for Catalog to close, as designed. Every launch
during that wait ran the startup-install path, which spawned *another* helper —
and that one exited within milliseconds because `applying.txt` was held by the
first. But `startHelper()` returned `true` (spawning hadn't thrown), so the app
charged itself an attempt and quit. Three launches in ten seconds spent the
whole budget without one real swap, the guard declared the update
uninstallable, deleted the marker, and the finished build was orphaned — while
the original helper was still sitting there, perfectly healthy, waiting.

Three things came out of it:

- **The lock is a heartbeat**, rewritten every second while a helper waits, so
  "someone is on the job" can be told from "someone died holding it". Startup
  checks it: if a helper is working, step aside without spawning a rival and
  **without charging an attempt**.
- **Every exit path releases the lock.** The timeout path didn't, so one slow
  update blocked every helper for the next ten minutes.
- **Say what's happening.** The app quit in silence to install, which looks
  exactly like Catalog refusing to open — so it got clicked again and again,
  each click landing in the middle of the swap. It shows a small "Installing
  Catalog x.y.z…" window now. The human failure was the important one.

Verified against a fake project tree: heartbeat moves, a rival helper exits 0
without touching the note, the swap completes when the exe unlocks, and a
timed-out helper releases the lock while keeping the marker for the next start.

**20. Test with the lock on.**
The update banner never appeared for the owner, and the reason it was missed is
more instructive than the bug. `UpdateBanner` lives in the root layout, which
the **login page shares**. With a PIN set, Catalog opens on `/login`, the
banner asks `/api/update` from behind the lock, and the hook redirects it to the
login page — which arrives as a cheerful `200` full of HTML. `.json()` throws,
the `catch` swallows it, `offer` stays null, and because the layout survives
signing in the effect never runs again. **Everyone with a PIN was silently
never told.**

It was missed because the test copy of the database had its `pinHash` deleted
to get in — removing the exact condition that breaks it. **When a fixture is
made easier to test with, check what the removal was load-bearing for.** The
fix re-runs the check on navigation, skips `/login`, and treats a non-JSON
reply as "no answer yet" rather than "no update".

**21a. An update that asks Windows' permission can fail where nobody sees it.**
A friend on 3.0.1 couldn't update to 3.0.3: Update closed Catalog, Windows asked permission, and
Catalog never came back — still 3.0.1. A Windows permission prompt means the app folder isn't
writable by the user (installed "for all users" / Program Files), and a *silent* install there
can fail without a trace (`updater.logger` was null). Since 3.0.4: a copy that can't write its own
folder (`canWriteAppFolder`) installs with the installer's window showing and doesn't install on
close; every install is remembered in `update-attempt.json`, and a start that's still on the old
version tells the page (`update-failed` → `/api/update` `failed` → the banner links the download
page); electron-updater's log goes to `%APPDATA%\Catalog\update.log`. Only the version doing the
updating runs this code, so 3.0.1 itself still needs installing by hand.

**21b. Installing at night** (2026-10-11): `nightUpdate` / `nightUpdateHour` in settings, off by
default. `updater.ts` looks every 5 minutes: in that hour, Windows release copies only, with an
update `ready` and nothing played for 15 minutes (`watchedLately`, any profile), it sends
`install-update` with `auto: true` — once a night (`nightUpdateTried`). main.cjs skips an auto
install where the app folder needs permission (nobody's there for the prompt) or nothing is
downloaded. main.cjs also checks for updates every 4 hours, for a Catalog left open for days.

**21. The library got corrupted, and how it was put back.**
Between two snapshots an hour apart the live `library.db` went from
`integrity_check: ok` to a damaged B-tree: rowids out of order, a page
referenced twice, an invalid page number, and two broken indexes on
`entry_cast`. `entry_tags` threw *database disk image is malformed* partway
through a scan.

What was happening in that hour: the update machinery quitting and relaunching
the app repeatedly, with orphaned instances left alive — at one point a
windowless, server-less husk holding the exe — while the backfill wrote cast
and tag rows. The damage is in exactly the tables the backfill writes. SQLite
survives a process being killed; what it is not built for is two copies of the
app writing to one library, which the relaunch cycle kept producing. **That is
the strongest argument for the release build: it never kills and relaunches
itself to update.**

Recovering it, in case it happens again:

- **A damaged tree is not a lost table.** A plain `SELECT *` throws at the
  broken page, but `SELECT * ORDER BY <column>` takes a different path through
  the file and walks past it — 3,314 rows one way, 4,200 the other, from the
  same table. Read both ways and merge.
- **Rebuild rather than repair.** There is no fixing a B-tree in place: create a
  new file from the schema (which lives apart from the data and usually reads
  fine), insert everything readable, and the trees and indexes are built again
  from scratch.
- **`node:sqlite` has `foreign_keys` ON by default.** Loading tables
  alphabetically put `entry_tags` before `tags`, so every row was silently
  rejected and the table came out empty. Load with foreign keys off, parents
  first, then `PRAGMA foreign_key_check`.
- **Delete `-wal` and `-shm` with the old file.** Dropping a rebuilt
  `library.db` next to the *old* journal makes SQLite replay the corrupted WAL
  onto it, and the fresh file reads as malformed. That happened here and looked
  briefly like the repair had failed.

Result: all 382 entries byte-identical to the last clean snapshot, both API
keys and the PIN intact, `entry_cast` ending up with *more* rows than either
source alone. The damaged file is kept as `library.corrupted-<date>.db`.

**22. A missing value is not an unanswered question.**
"Missing information" sat at 44 titles no matter how many times it ran, and
reported "filled in 0". The query asked `WHERE runtime_minutes IS NULL`, which
cannot tell *nobody has looked* from *there is nothing to find* — so the same
44 were fetched, found to have no runtime, and counted as missing again.

Every lookup now records that it happened. `details_checked_at` is stamped
whenever the detail endpoint answers, **even when the answer is empty**, and the
count asks `details_checked_at IS NULL AND (…)`. `scores_checked_at` already
worked this way; the same rule was simply missing on the details side. The
matching distinction in the code: `fetchDetails` returning a title, or
`fetchScores` returning `EMPTY_SCORES` rather than `null`, means *asked*. A
failure must never stamp, or one flat network would mark a library complete.

The underlying cause was worth finding rather than papering over. **All 44 were
TV series, and TMDB now returns `episode_run_time: []` for nearly every show** —
Breaking Bad, The Office, Squid Game, all empty. The runtime moved to
`last_episode_to_air.runtime`, which is populated for all of them.
`details.ts` falls back to it (then `next_episode_to_air`), and after one pass
every one of the 44 had a runtime. Sorting by "Longest" covers the library now.

The general shape: **before silencing a count, check whether the data really is
absent or has just moved.** Stamping alone would have hidden a fixable bug.

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

**Other names** (`entries.other_titles`, `src/lib/server/otherNames.ts`): TMDB's original name
plus alternative titles from JP/US/GB/CA/AU, one per line, searched alongside the title, so
"dungeon meshi" finds Delicious in Dungeon. NULL = not asked; filled 30 s after start-up and on
every add.

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

### Linking between people and titles
**Every cast member is clickable, owned or not.** `/person/[id]` takes either
our numeric id **or the provider's** (`tmdb:588`); the second form resolves
through `getPersonBySourceId()` and falls back to `fetchPerson()`. Before this,
the cast of a title you didn't own had no row here, so they rendered as plain
faces and the chain film → actor → film → actor died on the third hop — which
is exactly how the user hit it.

Navigation carries `?back=<path>` (`src/lib/back.ts`), not an entry id, because
each hop is a different kind of page. `safeBack()` rejects anything that isn't
one of our own paths.

### Reading about a title
Every title has a page worth landing on, not just a form.

**`/entry/[id]`** — poster, status, scores, synopsis, where to watch, tags,
cast, and *then* a closed `<details>` holding the edit form, the re-match tool
and delete. The user's words: clicking a film shouldn't "immediately show you a
ton of text boxes". Shared pieces are `ScoreStrip`, `Synopsis`,
`WhereToWatch`, `TagChips` and `CastRow`.

**`/title/[source]/[id]`** — the same page for something you *don't* own,
reached from an actor's "also known for", from Browse, or from someone else's
shared list. `[id]` is the provider's own id, colon and all:
`/title/tmdb/movie:550`. Anything already in the library **redirects to its
entry**, so there's never a preview of something you have. Its `add` action and
`POST /api/add` share one function, `addFromSource()` in `entries.ts`, so
adding works out the same wherever it's done.

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
missing. It starts by itself a few seconds after the app opens
(`scheduleBackfill`), shows a thin line on the library page while it runs
(`FillingIn.svelte`) and a progress bar in Settings → Library. What counts as
missing is one shared `OUTSTANDING` condition, and it turns on the *stamps*
rather than the values — see lesson 22, which is the whole reason the count
used to be stuck at 44.

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
backup: none of our own ids, no note pages, no settings, and a different
filename so the two are never confused.

It **does** carry `source` and `sourceId` (`catalogShare: 2`). That is the
difference between a list you can read and a list you can use: without them
nothing in someone else's catalog can be opened, looked into, or added, which
is what the first version was — a wall of text. They're public catalogue
numbers, nothing personal. Older files without them still open; the page says
why their titles aren't clickable and falls back to matching on title.

`/shared` reads a file the browser picks, with `FileReader`. **Nothing is
uploaded and nothing is stored** — the server only supplies `allTitleKeys()`
and `existingSourceKeys()` so the page can work out the overlap. Matching on the
provider id is exact; the title keys are the fallback for old files.

From there it behaves like the library: sort by any of the same values (with
the same `sortBadge` under each card), filter to *everything*, *only what I
haven't seen*, or *only what we've both seen*, click any title through to
`/title/[source]/[id]`, and add one with **Watchlist** or **Seen it** via
`POST /api/add`. Cards added in the session update in place rather than
reloading, so the list doesn't jump under you.

### Browsing
`/browse` is the other half of `/entry/new`: Add is for something you know the
name of, Browse is for finding something you don't. With no query it shows what
`browseShelves()` returns — TMDB's weekly trending for films and series, and
AniList `TRENDING_DESC` for anime, one shelf each, or two pages deep when a
single category is chosen. With a query it runs the ordinary `searchAll` at a
much wider limit (60 rather than 12), because the thing you want when browsing
is often the twentieth result.

Everything already in the library is marked from `existingSourceKeys()` and
dimmed — browsing should not offer you your own library back. Cards carry the
synopsis the search endpoint already returns, so you can read what something is
before deciding to open it.

### Where to watch
TMDB carries JustWatch's availability, per country: `/movie|tv/{id}/watch/
providers` → `results[REGION]` with `flatrate`, `free`, `ads`, `rent`, `buy`
and a `link`. `providers.ts` folds `free` and `ads` together and keeps the rest
apart.

**The country is the whole answer.** `watchRegion()` takes the one saved in
Settings → Services, else the region of this PC's locale
(`new Intl.Locale(...).maximize().region`), else `US`. A stored answer for a
different region is thrown away rather than shown.

AniList has no availability data, so an anime added from there is matched to
TMDB by name first, and only when the normalised title matches **and** the year
is within a year — the wrong show is worse than no answer.

Asked for after the page renders (`/api/providers`), never during load: it's an
extra round trip, two for anime. Library entries keep the answer on the row
(`providers`, `providers_checked_at`, stale after 7 days); titles you don't own
sit in a small capped in-memory map. As everywhere else here, `null` means
*couldn't ask* and is never stored — only an answer is.

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

### Library view that sticks
Status, sort, tags and years are remembered in the `libraryView` setting
(`KEPT_FILTERS` in `constants.ts`). The URL wins and is saved; anything it
leaves out comes from the setting. Clearing one writes it **empty**
(`?status=`), because leaving it out would bring the saved one back. Tabs hidden
by right-click live in `hiddenTabs`. Library, Notes and Watch list share
`LibraryHeader.svelte` so switching tabs never moves the layout.

### Notes
Deleting is soft: `deleted_at` is set and the page sits in Recently deleted
(`/notes/deleted`) for 7 days, erased by `eraseExpiredNotes()` at start-up and
on the notes pages. `note_versions` keeps the text *before* a save when it's
worth it (first save after 10 quiet minutes, or when over half the text just
went), 50 per note; restoring a version keeps the current text as one first.
`scripts/restore.mjs` adds any column a backup has that its fresh tables lack.
Pinned (`notes.pinned`) always sorts first; the sort is the `notesSort` setting.
Tags are `note_tags` / `note_tag_links` (not the library's genre tags); the list
filters with `?tag=<id>` client-side.

Confirm boxes: never `confirm()` — use `confirmAction()` / `askText()` from
`$lib/confirm.svelte.ts`; `<ConfirmDialog />` sits in the root layout.

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

### One card per anime show
AniList lists every season as its own title. Besides the season-suffix rule, a
sequel whose name *starts with* the show's name ("JoJo's Bizarre Adventure:
Stardust Crusaders") joins when TMDB — which Showbox follows — has a season of
that show starting or running then. That keeps Naruto Shippuden separate.
AniList's "(TV)"/year qualifiers are stripped (`withoutQualifier`) before any
Showbox or TMDB lookup. `one_time_fixes` in `db/index.ts` runs a named fix once;
it cleared `anime_roots` when this rule arrived.

 `metadata/franchise.ts` folds them:
it climbs PREQUEL/PARENT relations to the oldest ancestor, and a title only
joins that root if its name is the root's name plus a season-like suffix
("2nd Season", "Part 2", "Season 3"…). **Films, OVAs and specials are always
their own card** (the owner wants them separate) but still count as links in
the chain, so a season after an OVA still finds its root. Roots are saved in
`anime_roots` for 30 days, because AniList rate-limits hard (429 → a cool-down
via `quietUntil`). `seasonMerge.ts` runs 45 s after start-up and merges
same-show entries already in the library, after a `VACUUM INTO` backup in
`backups/`.

### Catalog on a Fire TV
`android/` (see its README) builds a 25 KB Android TV app with `npm run tv` — SDK tools only,
no Gradle. It's a full-screen WebView of Catalog on a computer in the same house (the owner's
mom: her laptop runs Catalog, her Fire TV shows it). Pieces:
- The computer answers UDP `CATALOG_DISCOVER` on port 41734 (`electron/main.cjs`), so the TV
  finds it; Settings → Watch on TV shows the address to type if not, and the Downloader URL
  (`/catalog-tv.apk`, served from `static/`, public even behind the PIN).
- Video: the app adds Febbox's Referer/Origin to requests leaving the house, the same trick
  as Electron's `onBeforeSendHeaders`, so the computer doesn't relay the video.
- TV mode (`src/lib/tv.ts`, on when the user agent has `CatalogTV/`): arrows move focus to the
  nearest element (left/right stay on the row), the menu key opens the focused card's ⋯, and
  `window.__catalogTv` takes play/pause and seek from the remote. The player keeps the arrows
  while a video is showing and nothing in its controls is focused (`data-tv-player`).
- The signing key `android/catalog-tv.keystore` must be kept, and `versionCode` bumped, for updates.
- **TV layout** (`src/routes/tv/`, 2026-10-10): the home page redirects the TV app (user agent
  `CatalogTV/`) to `/tv` unless `settings.tvLayout === 'full'` (Settings → Watch on TV). Netflix-
  style: menu down the left, a banner about the highlighted title over rows of posters, an
  on-screen keyboard (`TvKeyboard`; the TV's own keyboard doesn't pop up in the WebView, and no APK
  change is needed), title screens with Resume / From the start / My List. The remote is handled by
  `src/lib/tvNav.ts` (rows `[data-tv-row]`, grids `[data-tv-grid]`, items `[data-tv-item]`,
  `[data-tv-track]` slides rows under the banner; `tv.ts` stands aside while `[data-tv-app]` is on
  screen). The highlight is also drawn from a `.tv-focused` class because `:focus` doesn't paint in a
  background window. Everything is sized in vw (the Fire TV WebView is 960×540 CSS px). It's all
  web code, so it reaches the TV with an ordinary Catalog update on the laptop.
- **Profiles** (2026-10-10, "Who's watching?", `src/routes/tv/profiles/`): each request runs as one
  profile via AsyncLocalStorage (`src/lib/server/profile.ts`, set in `hooks.server.ts` from the TV's
  `catalog_profile` cookie), so queries call `currentProfile()` instead of every caller passing it.
  Only TV requests count: the `CatalogTV/` user agent, or the TV layout previewed on a computer
  (`catalog_tv_preview` cookie, dropped on any other page), and never with `tvLayout === 'full'`.
  Profile 0 is the library's owner (no `profiles` row until renamed; shown as "Me"); their list *is*
  the library. Anyone else's list is `profile_titles`, and `/api/add`, `/api/watch/add-to-library`,
  `/api/entries` PATCH and `finish-film` write there instead; the rest of `/api/entries` refuses.
  `watch_progress` and `continue_hidden` were rebuilt with `profile` in the key (one-time fix
  `progress-per-profile`). Profile ids are AUTOINCREMENT so a deleted one's number isn't reused. The
  TV app opens at `/`, which goes to `/tv/profiles` when there's more than one profile.
- **Old TV app's Back** (before 1.2 it goes back a page or exits): the TV layout keeps a spare
  history step (`pushState` with `tvGuard`) on menu screens; Back pops it, `tvBack()` runs and it's
  put back. So Back never exits there (the Home button does). With 1.2 it's never used.
- **Poster menu** (☰ / M): `TvMenu.svelte`, posters carry `data-tv-menu` (kind continue / library /
  result); the rest of the screen is `inert` while open; Back closes it. "Remove from My Library"
  works on the owner's library too (the owner's mom only uses Catalog on her TV).
- Continue Watching on the TV opens the title's page (`tvTitleLink`: library entry, else TMDB).
- **TV app 1.3** (versionCode 4): back after 30+ minutes away reloads the computer's address, so
  it opens at "Who's watching?" (`/` always redirects the TV app to `/tv/profiles` now, even
  with one profile). Browse pages add a row per genre (TMDB ids; TV has its own, e.g. 10759, 10765;
  anime goes through `TMDB_GENRE_TO_ANILIST`, fewer rows for AniList's rate limit).
- **Back and fast-forward** (TV app 1.2, versionCode 3): Back asks `window.__catalogTv.back()` first
  (`tvBack` in tvNav.ts: on a menu screen opens the menu, then Home, then "exit"; elsewhere
  "default" = history back). Fast-forward/rewind send `scan(±1)` once per press (repeats dropped);
  the player scans at 8/16/32/64× until play/pause or OK. The old app's `seek(±30)` also scans.
- **Player-numbered shows on the TV title screen**: a second after it opens, the page asks
  `/api/tv/player-episodes` (the player's own resolve, nostream); if those seasons differ from
  TMDB's (Bleach: TMDB 2, player 18 from Showbox), the seasons, episodes and names
  (`/api/watch/episode-names` with before/count) become the player's, so the picked episode is the
  one that plays. Browse's AniList query has `genre_not_in: ["Ecchi", "Hentai"]` (search doesn't).
- **Title screen episodes** (`src/lib/server/tvEpisodes.ts`, `/api/tv/season`): TMDB seasons and
  episodes (the player's numbering), no Showbox calls; anime is found with `tmdbShow(name, '')`
  and opens on the season that aired in the entry's year. Picking one opens
  `/watch?...&resume_s=&resume_e=`.
- **Player on the TV, 2026-10-16:** Up from the controls row highlights the progress bar
  (`.progress-wrap` gets tabindex on a TV; `data-tv-up` on an element restricts where tv.ts sends
  Up), where left/right skip 10 s and Up goes on to the top bar — before, Up from the right-hand
  buttons landed on Skip Intro / Next Episode sitting on the bar and the bar itself could never be
  reached, which is what the owner's brother meant. Skip Intro takes focus
  when it appears unless a button is in use. Auto-skip has its own TV key (`catalog-tv-autoskip`,
  on when unset). TVs never fingerprint: they POST `/api/watch/skip-found/prepare`, the computer
  opens `/skip-maker` hidden (same queue as `/strip-maker`), and the TV re-reads at 30 s / 75 s.
  The picked source is kept per show (`catalog:source:<title>`, via `pickFor`), captions turned
  off are kept per show (`catalog:captionsOff:<title>`), and captions never auto-start or restore
  over a `burnedIn` file.
- In the player on the TV: captions go on by themselves (English CC first), Autosync is always on,
  Autoplay has its own setting (`catalog-tv-autoplay`), the Next Episode button counts down its last
  30 s and takes focus, and known closing credits move on 10 s in. A stall in the last 3 s counts as
  the end (`episodeEnded`), not a reason to fetch a fresh link.

### Other sources: Aniwave video, anime.nexus subtitles
`src/lib/server/sources/`. Only for anime (TMDB: Japanese + Animation). The owner says both
sites' developers gave permission. Found with `npm run probe -- <site>` (`scripts/source-probe.cjs`),
which records what a site's page loads while the owner browses it.
- **Aniwave** (aniwaves.ru) answers plain requests: search → episode list → servers → the
  player's `getSources` → an .m3u8. Only "S-Sub" (Japanese, clean picture) and "Dub" are used;
  plain "Sub" has subtitles burned in. Its video servers only answer Referer
  `https://play.echovideo.ru/` and won't let another page read the video (CORS), so Catalog's
  server relays it (`/api/watch/relay`, only to hosts Aniwave sent us to): playlists rewritten
  to point back at the relay, video streamed through. That's why it plays on the phone and the
  TV too. Its labels lie — playlists say video, video says image/jpeg — so the relay goes by
  the first bytes (`#EXTM3U`). Its own subtitle server often doesn't answer; its tracks sit last.
- **anime.nexus**: its video can't be used — its player signs every request after a human
  check, and copying that is off-limits. Its subtitle files are plain downloads, but the list of
  them is only given to its own page, so `readPageAnswer` (main.cjs) opens the episode page out
  of sight, reads that one answer from Chromium's network log, and closes it (~2 s, cached a
  week). It ignores the browser's CORS preflight to the same address (an empty 204 — grabbing
  it was the first bug). A profile that never passed their check gets 403: the subtitle menu
  then offers "Get anime.nexus subtitles", which shows their page until the lookup goes through.
  "English CC" is the dub-accurate one. Every line in it is bold, which the player drops.
- **AnimeTosho** (`sources/animetosho.ts`, animetosho.net — the old feed.animetosho.org is gone;
  the feed is feed.animetosho.net/json): automatic official subtitles, no check. Searches
  "<name> S01E05" / "<name> 05" (player's numbering), prefers Crunchyroll multi-sub releases
  (VARYG, ToonsHub), reads the release page's `/download/<id>/subs/file/<n>` links. Files come
  xz-compressed (`xz-decompress` in `downloadSubtitle`). "English (SDH)" = dub CC; unnamed older
  releases: the English SRT next to an English ASS is the CC, otherwise the unnamed tracks are
  downloaded and the one full of sound cues ("[gasps]", ♪) is the CC. Picture subtitles (PGS,
  VobSub) are skipped. AnimeTosho comes first; anime.nexus is only asked when it has nothing.
  Season packs: each file inside has its own page (`/file/<name>.<id>`, listed on the pack's
  /view page) with that episode's subtitle links — used when no single-episode copy has CC.
  Search terms lose their punctuation ("-word" means NOT in AnimeTosho's search). Names like
  "Season 2 - 03" / "2nd Season - 03" count as S02E03. Unnamed tracks are always looked inside:
  under 40 lines = signs, none = dropped, full of sound cues = CC.
- Kept subtitles: table `saved_subtitles` (url → show, content). `/api/watch/subtitle-content`
  serves a kept copy first and keeps new ones (key `url#SxE` for season packs); opening an
  anime episode keeps the rest of its season from AnimeTosho in the background
  (`keepSeasonSubtitles`). `forgetFinishedSubtitles` (startup, hourly, home page) drops shows
  completed, unwatched 7 days, or hidden from Continue Watching. Not in backups or exports.
- **Placing seasons** (`sources/index.ts`): these sites list each season (or half-season) as its
  own show. Each is put in the TMDB season that started within 60 days before it, the next
  ones in that season following on. Search with AniList's romaji exactly ("JoJo no Kimyou na
  Bouken (TV)") — their quick search only shows five results. When Showbox numbers seasons its
  own way (Re:Zero: TMDB one season of 85, Showbox four), episodes are matched by counting from
  the show's first, only if every Showbox season begins where an Aniwave series does, or
  Showbox's seasons add up to exactly where a TMDB season ends (Black Clover: 51+51+52+16 =
  TMDB's 170; TMDB's later seasons then follow as new ones). Showbox sometimes files episodes
  under whole-series numbers (Black Clover's "season 1" is S01E52–S01E128): `wholeSeriesNumbers`
  moves those first, under the same add-up rule. Episode names only use TMDB's same-numbered
  season when it starts at the same episode. The list waits 6 s for Aniwave at most (`partial`,
  not cached, so it joins next time). anime.nexus is looked up through the episode's Aniwave copy
  (`ref`), which gives TMDB's numbering; AnimeTosho also searches the whole-series number.
- **7Movies** (`sources/vidrift.ts`, 2026-10-10): 7movies.ac's player is embed.vidrift.net, asked by
  TMDB id/season/episode, so no searching or lining up. `/api/boot/...` (plain request, no token
  needed) gives the Orion playlist: HEVC only, its pieces on `*.hakunaymatata.com`, which allow
  any page — the relay leaves those addresses alone (`playsDirect`), so Orion's video never goes
  through the laptop. `/api/source/...?token=<boot's playbackToken>&hevc=0` gives an H.264 server
  (Vela) through relay.vidrift.net, which wants Origin/Referer embed.vidrift.net, so all of it
  goes through Catalog's relay (~8 Mbps at 1080p). Two copies per film/episode (fid -4 H.264
  listed first so it's the default — Orion often tops out at 720p; -3 HEVC; quality "HD"); `playableHere` hides HEVC where `MediaSource.isTypeSupported` says no.
  Added to every aired TMDB episode in `combineEpisodes` (only when Showbox numbers seasons like
  TMDB) and to films in resolve (`filmCopies`); shows/films only 7Movies has resolve too.
  Showbox stays the default pick; `linkFor` in the player tries the other sources' copies when
  one gives no link. The relay's playlists have no ".m3u8" in their address, so the player treats
  anything from `/api/watch/relay` as HLS (`isPlaylist`). No subtitles from 7Movies; Catalog's own
  subtitle sites are used. Found with the probe while the owner played SVU S28E1.
- **Starting a video** (2026-10-11): hls.js is made with `autoStartLoad: false`; the saved place
  (`savedPlace()`, asked for the moment the video is chosen, inside `untrack`) and the level
  (`startLevel`/`loadLevel`, not `currentLevel`, which flushes) are settled first, then
  `startLoad(place)`. Before, it fetched the start in one quality, again in another, then the
  place itself: up to three pieces before playing — the "10 seconds to resume". Thor via the
  relay now plays from its place 1.6 s after the page opens.
- **Kept strips and the computer's own gatherer** (2026-10-11): the gathering lives in
  `src/lib/previewStrip.ts` (`PreviewStrip`, two unseen copies). Pictures are kept as base64 JPEGs
  (192×108, ~5 KB) in `<library folder>/previews/<sha1>.json`, one per film/episode
  (`stripKey`: title|type|season|episode, whichever copy) — `/api/watch/strip`, cleared after 60
  days unopened, not in backups. The player loads them at open, gathers the rest (only while ≥10 s
  is buffered), keeps every 15. TVs never gather (a second video would fight the TV's own): they
  ask `/api/watch/strip/prepare`, the server sends `make-strip` to electron/main.cjs, which opens
  `/strip-maker` in a hidden window (one at a time, `backgroundThrottling: false`, muted, 6-min
  cap) — tested: a whole 24-min strip (140 pictures) in ~50 s. Every player also asks for the next
  episode's (a minute in; at once on a TV). `?stay=1` keeps /strip-maker open for trying in a
  browser. On the TV the preview shows while fast-forwarding. Until a picture exists the poster
  shows. Neither Aniwave nor 7Movies publishes ready-made seek pictures; Showbox's player unknown.
- **Progress-bar preview** (trick-play, 2026-10-11): a hidden second hls.js copy (`progressive:
  true`, `autoStartLoad: false`) of the smallest copy (`findThumbSource`: the playlist's lowest
  level, Showbox's smallest file ≤480p, Orion's 480p for 7Movies' H.264 — whose pieces are ~20 MB —
  else the video itself). Each picture is the first frame of a piece: `startLoad(t)` + seek to the
  piece start, `createImageBitmap` on `seeked`, then `stopLoad()`. Gathered in the background
  (5 s after playing starts, only while the main video has ≥20 s buffered or is paused): one a
  minute across the whole video first, then every 10 s; the one under the mouse jumps the queue,
  and the nearest gathered (≤60 s) shows meanwhile. Kaiju Girl: every point on the bar had a
  picture within 50 ms after 20 s of playing. The relay lets the browser keep video pieces
  (`private, max-age=21600`) so pictures from the part the player already loaded cost nothing.
  On a fresh start the piece list needs loading to begin (LEVEL_LOADED), then stops.
- Aniwave's "sub" flag means Japanese audio, often only with burned-in subtitles. The Japanese
  file plays S-Sub when the series has it (`aniwaveHasSoftSub`, checked on its first episode,
  kept a week), otherwise the burned-in "sub" copy (`burnedIn`, kind `sub`; Catalog's own
  subtitles don't switch on over it). Black Clover and Memory Snow have only burned-in + dub.
- **Showbox folders come 50 files a page** (`file_share_list&page=N`); `listFebboxFiles` reads
  every page. Before 2026-10-10 only page 1 was read, so long seasons lost episodes.
- Films: TMDB lists anime films under Anime, so the title page works out `watchType` (TMDB
  `movie:` id, AniList MOVIE, one-episode OVA) — sending them as "tv" opened the show. A film
  Showbox lacks plays from Aniwave (`aniwaveFilm`, exact name + year, needs AniList to know it).
  A show's films (TMDB `/search/movie` by its name, animated, name starts with the show's) are
  searched on Aniwave by their own names and go in Specials, in release order, "· Movie".
  Subtitles for a film (or a film in Specials, via `aniwaveExtra`) are looked up by its name
  (`toshoFilmSubtitles`, OpenSubtitles as a movie). TMDB's top hit for one Re:Zero film is the
  other: `fetchImdbId` prefers the exact title.
- The Watch button's check (`src/lib/server/availability.ts`) asks Showbox and Aniwave at once,
  first "yes" wins, answers kept (yes a day, no an hour); the title page starts it during load.
- OVAs/specials (Aniwave types OVA, Special, TV Special, named after the show) go to season 0
  in release order, after Showbox's own specials, with their own names (`ListedEpisode.name`;
  TMDB's season 0 is too cluttered to match). Kept even when the seasons can't be lined up.
- Waiting on other sites: subtitle sites are asked at once (2.5 s after OpenSubtitles, 6 s max;
  late answers kept an hour); search gives AniList and its season grouping 3 s each; Browse
  shows stale rows and refreshes behind. Every outside fetch gets a 15 s limit unless it has one,
  and ones over 2 s are listed in /api/diagnostics `slowRequests` (`src/lib/server/slowRequests.ts`).
- An Aniwave file carries its own `shareKey` (`aniwave:<id>:<episode>:<ssub|dub>`) and
  `source`; `pickFile` takes Showbox's first. Don't hammer these sites while testing either.

### Hearing the sound track: subtitle auto-timing and Skip Intro (2026-10-16)
Showbox's HLS playlists carry the sound as separate tracks (`EXT-X-MEDIA TYPE=AUDIO`, fMP4: an
init piece + ~6 s `.m4s` pieces, ~22 MB an episode, readable from any page). `src/lib/soundTrack.ts`
reads one and has the browser decode it (`OfflineAudioContext(1, rate, rate).decodeAudioData` on
init + pieces gives mono-able audio at that rate, durations exact). Two things use it:
- **Auto-timing v2** (`subtitleSync.ts`, `subtitleTiming.worker.ts`, `subtitleAlign.fitDelays`).
  The first version listened as it played and needed ~2 minutes of talking per answer: on Bleach
  S1E1 its first move came at minute 10, so the owner saw "it does nothing". Now the whole track is
  fetched (two minutes at a time, from where you are, only while ≥30 s is buffered), Silero runs in
  a worker (~10 s an episode), and `fitDelays` gives a delay per part of the video: best overall
  delay within ±150 s (top 3 tried), then 3-minute stretches every 30 s within ±20 s of it, outliers
  dropped, changes ≥1 s placed in the longest quiet spell. Most releases step by a few seconds at
  the break (HorribleSubs −0.1 → −6 s at 8:20), so one delay was never enough. Whole episode timed
  in ~17–22 s, the part you're at in ~4 s; switching subtitles re-times in ~1.3 s (the talking is
  kept). Fewer than 20% clear stretches over 12+ stretches = "These subtitles don't match this
  video" (wrong episode, wrong show). Videos without a separate track still listen as they play.
  It found Delicious in Dungeon's Netflix CC at −11 s — the delay the owner had set by hand.
- **Skip Intro by comparison** (`skipFinder.ts`, `introFinder.ts`, `/api/watch/skip-found`): the
  first 6 and last 5 minutes of this episode and a neighbour (next, else previous; a copy that is a
  playlist, not an MP4) are fingerprinted (32 band-difference bits per 0.128 s) and the longest
  shared run (≥20 s) is the intro / credits. Kept per Showbox fid for both episodes. Wins over
  AniSkip where both answer: AniSkip's Dungeon Meshi E3/E5 intros end ~10 s late (the "Skip Intro
  button stays up" report), and it has nothing for E1/E4 and no credits at all. Not run on TVs.
- **Kept speech** (`src/lib/server/heardSpeech.ts`, `/api/watch/speech`): what auto-timing heard,
  one byte per 32 ms, kept per Showbox fid + language in `previews/`. Every screen tries it first
  (a second watch is timed in ~2 s with nothing fetched); a TV never hears audio itself, it asks
  the computer (`/api/watch/speech/prepare` → hidden `/speech-maker`, ~20 s) and polls. Uploading
  raw bytes needs `Content-Type: application/octet-stream` — without it the body arrived empty.
  Auto-timing is on by default; Reset goes back to its delay (`backToTiming`).
- **Gotchas:** the browser can't decode Dolby (E-AC-3) tracks, and some playlists list them
  beside AAC (Dungeon Meshi's `audio_ec3` group) — `soundTrackIn` skips groups whose video
  variants say `ec-3`/`ac-3`. Fetching ~50 pieces at once gave `ERR_NO_BUFFER_SPACE`: six at a time.
- Bench: `scratchpad/sync` (`whole.mjs`, `plan.mjs` replay `fitDelays` from `.vad` files) and
  `scratchpad/intro/pair.mjs` (8 kHz `.pcm8` from ffmpeg). AnimeTosho releases must now name the
  show (`isThisShow`): "Bleach 01" used to pick Thousand-Year Blood War's subtitles.

### Fixes of 2026-10-16 (round 4)
- **Anime audio:** `/api/watch/is-anime` (TMDB: original language ja + genre 16, kept a month);
  the player only defaults to the Japanese track when that says yes. A film with a Japanese dub
  (Avatar) keeps its own default.
- **Febbox sign-in:** the login window used to draw a full-screen "LOGIN DIAGNOSTICS" overlay
  after ~10 s on any febbox page that wasn't `/login` — the email 2-step code page is such a page,
  so the owner's mom and brother needed several tries. Overlay removed; success is polled every
  second; diagnostics go to the console after a minute.
- **Subtitle adverts:** `isAdvert()` in the player drops lines with a web address or advert /
  credit wording, line by line (other cues keep their times). Checked on 155,813 lines from 20
  titles: every match was an advert, no dialogue.
- **Mac menus vanishing:** no `backdrop-filter` anywhere in the player (Chromium on macOS stops
  repainting blurred panels over a video while subtitles change underneath); `.popup` gets its
  own layer (`translateZ(0)`).
- **Availability:** 7Movies' token comes back for every id, even made-up ones, so it proves
  nothing; an Orion playlist in the boot answer does (instant). Otherwise the H.264 lookup (6–15 s)
  decides. The whole check answers within 12 s (`unsure: true` past that, not kept); the pages ask
  once more 6 s later. Showbox's fallback searches and alternative-title searches run in parallel.

### Fixes of 2026-10-16 (round 5)
- **Showbox files that only come in 360p.** Madagascar's and Witch Hat Atelier's "1080p" files
  came as one 640×360 level with no choices, in Catalog and on Showbox's own site, while other
  titles played in full: Febbox decides per file. (I first blamed a daily data limit — wrong: that
  notice in Febbox's player page is a template only shown to VIP accounts, and the owner's mom
  and brother use their own accounts. Also: a plain server-side fetch of /file/player gets 360p
  for every file; only the hidden player window in Electron gets the real HD link, so the test
  server can't tell which files are really 360p-only.) The player notices (a 720p+ Showbox file
  whose playlist tops out at ≤480p, `showboxHeldBack`), plays another source's copy (7Movies
  H.264 is 1080p) and remembers that file for a day (`catalog:lowOnly:<fid>`).
- **7Movies H.264 moved to edge.reelvault.click**, which the relay refused ("Not a video server
  Catalog was sent to") — SVU S28E2 and Madagascar's HD "could not be played".
  `src/lib/server/relayHosts.ts`: any server a source hands out is trusted, and so is every
  server named inside a playlist from a trusted one.
- **Auto-timing from the player's own downloads** (`hearAppended`): hls.js's BUFFER_APPENDING
  gives each audio piece (or audio+video piece) as fMP4; init + pieces decode with
  `decodeAudioData`. Used whenever there's no separate sound track (Showbox while limited,
  Aniwave, 7Movies H.264), from the moment the video starts (no extra data). Before, those fell
  back to listening through the speakers, which needed minutes and was ~1 s out — Witch Hat
  Atelier "didn't put any delay". `soundTrack.ts` also resolves the relay's relative addresses
  now (Orion's separate audio track failed on `new URL(relative, relative)`).
- **Other speeds:** subtitles made for 25 fps DVDs run 4% fast against a 23.976 film; `fitDelays`
  tries 25/23.976, 25/24, 24/23.976 and their inverses when the normal speed doesn't fit (or
  nothing fits after 4 minutes heard). The plan carries `rate`; the player shows subtitle time
  `(t − delay) / rate`. Madagascar's aXXo file: rate 1.0427, −0.4 s on Orion; the 7Movies H.264
  copy starts 26.1 s later than Orion, so +25.7 s there (both right).
- **Speed:** stretches and the overall search run every 0.128 s first, then 32 ms around the best
  (`quickShift`) — same answers on all test episodes, ~12× faster (a film ~0.5 s). The worker
  skips fits that a newer one has superseded.

### Febbox folder listings: the gatekeeper (2026-10-17)
Spider-Man: Brand New Day showed no Showbox files: share_link found, then `file_share_list`
answered **429 with `cf-mitigated: challenge`** ("Just a moment…", Cloudflare), which
`listFebboxFiles` returned as `[]`, the film path took as "no files", and the answer was cached.
The log showed 13 more such refusals that day. Cloudflare challenges too many listings from one
connection for a while, and the check loops even in a normal browser while it lasts — so nothing
tries to get past it. Instead (`src/lib/server/febboxList.ts`):
- every listing goes through one gate: two at a time, 250 ms apart (a show's season folders used
  to be asked all at once — 16+ for Bleach); same folder at once → one request; fresh for 20 min;
- a refusal rests the gate (30 s doubling to 5 min) and falls back to the listing kept in
  `watch_order_cache` (`febbox-list|share|parent`, a month); with none it throws `FebboxRefused`;
- resolve treats `FebboxRefused` as busy: match kept (never `forgetShowboxMatch`), nothing cached,
  other sources play, `showboxBusy` seconds returned; the player re-asks then and adds Showbox's
  files without touching what's playing (or, with no other source, waits and retries);
- in the desktop app listings go out through Electron's `net.fetch` with the session cookies and
  the same Chrome identity as the player's link lookups (`febbox-list` IPC); `npm run dev` fetches
  directly (so the dev server sees refusals the app may not).
Test: `scratchpad/gate.test.mjs` (fake Febbox: sharing, spacing, rests, kept fallback).
Refusals do happen in normal use (the owner's own 3.1 logged four in an hour). While Showbox is
busy, Bleach's list comes from Aniwave/7Movies in TMDB's numbering (2 seasons, not Showbox's 18),
so `/api/tv/player-episodes` passes on `retryIn` and the TV title page asks again (up to 4 times).
The last list Showbox answered for is kept (`tv-episodes|title|year`, 60 days, `keptPlayerList` in
tvEpisodes.ts) and sent with the page itself, then looked up again in the background (10 min+).

### Long video pieces, and TVs (2026-10-17, after 3.1)
Mom's Fire TV kept stopping to load on SVU's newest episode (7Movies only); Bleach on Aniwave was
fine. 7Movies' H.264 copies come in **36-second fMP4 pieces of ~28 MB** (Aniwave's are a few
seconds), and all of it goes TV → laptop's relay → edge.reelvault.click. Three things went wrong:
- the relay's `AbortSignal.timeout(30000)` covered the **whole** download, so a TV pulling a big
  piece slowly got it cut off (measured: 19 of 28 MB at 600 KB/s), threw it away and started over.
  Now `fetchSteadily` (relayPieces.ts): 30 s for the answer to start, then 30 s of silence at most
  (2026-10-20: no answer after 4 s → the same request again alongside, first answer wins — one SVU
  piece hung 53 s while the rest took <1 s; 12 s of silence mid-download = hung. Not for Movy,
  which refuses a sixth download at once. The player's `fetchAhead.ts` does the same, and hls.js
  `fragLoadPolicy` retries after 5 s with no first byte);
- hls.js only uses a piece once it's all there, and Android WebView's video memory is small
  (Chromium: 150 MB, but ~30 MB on "low-end" ≤1 GB devices like smaller Fire TV sticks) — one
  28 MB piece nearly fills it, the next can't be added (`bufferFullError`, piece thrown away);
- so the relay **splits long pieces** (> 12 s, fMP4 with EXT-X-MAP, not locked or byte-ranged):
  each is listed as ~6 s parts (`&part=k&of=n&len=&ts=&tk=`). Inside, every piece is several
  `moof`+`mdat` chunks, each starting on a keyframe with `default-base-is-moof`, so any chunk
  plays alone. Asking for any part downloads the whole piece once (kept a few minutes, 4 at
  most) and each part is answered as soon as its chunks have arrived; parts are placed by each
  chunk's `tfdt` on the video track's clock (from the init piece). Joined back, the parts are
  byte-identical to the piece. The edge server ignores Range and needs vidrift's Referer, so the
  TV can't fetch it directly. Progress-bar pictures ask with `&whole=1` (they only want each
  piece's first frame; a part would make the laptop fetch the whole piece);
- safety net: if a video in parts gets stuck or fails (any `refreshStream`), the player reloads it
  with `&whole=1` for the rest of the visit (`piecesWhole`) — exactly the old behavior. (A smaller
  TV buffer was tried and taken back out: the owner didn't want Aniwave on the brother's TV
  touched, and with short parts hls.js copes with the WebView's memory by itself);
- the TV's top bar only hid in full screen, and full screen needs the press that opened the
  episode to still count (~5 s): a slow start left the bar up for good. On a TV it now hides
  with the controls either way, and a hidden top-bar button loses the highlight.

### The Watch button's check, as it goes
`availability.ts` notes each source's progress (`noted`, `progress` map, kept a minute after);
`/api/watch/available?now=1` answers at once with `{ available | null, sources }`, and the title
and entry pages poll it every second (`src/lib/watchCheck.ts`) with `SourceChecks.svelte` under
the button. No 12-second limit or "unsure" there any more (the old blocking call still exists).

### Starting sooner: warm-ups (2026-10-20)
Measured: a title that exists answers the check in under 1 s; pressing Watch took 5–6 s,
as two steps in a row — the lookup (`/api/watch/resolve`, ~2–4 s: search, Febbox listing, and
for films the link) and, for shows, the episode's link (`/api/watch/stream`, ~2 s). Now:
- `resolve?…&warm=1` (sent by the player and by warm-ups) starts the link for the episode the
  player will most likely start (`warmLikelyEpisode`: `resume_s/resume_e`, else progress, else
  `startSeason`, else the first; Showbox's best file), not awaited; `getStreamUrl` shares the
  one under way. Pushing Daisies: link step 2.0 → 0.5 s, playing at 3.1 s instead of 5.7 s.
  Without `warm=1` (the TV's `player-episodes`) no link is fetched.
- Lookups of one title queue behind each other (`lookingUp` in resolve), so a warm-up and the
  player's own never do the same Febbox listing side by side; the second reads the cache.
- Title and entry pages call `warmUpTitle` 0.5 s after the check says yes (the owner asked
  for page-open rather than hover only; the Febbox gate still spaces and rests listings).
- `warmWhenResting` (`src/lib/watch.ts`): resting on Watch 250 ms (title and entry pages;
  Continue Watching already did) or the TV highlight on Play / From the start / an episode for
  1.5 s calls `warmUpTitle`, with the same title, type and year as the Watch link, so the
  player's lookup key matches. Re-warms after 10 min (links last 15; the TV stays open for
  days). The Prestige after 5 s on Watch: playing 1.3 s after the click.
- **The packed app's own link lookup** (`get-video-url` in main.cjs) didn't know Febbox's
  2026-10-19 page either (only showbox.ts was fixed then): no link matched, so every Showbox
  video waited on the hidden window (3 s after load + a dozen JW Player looks) — Primetime 12 s
  from Watch to picture. main.cjs now has its own `fromSourcesList` (AUTO first), reads the
  rest comment-stripped and unescaped, and skips the hidden window on a refusal JSON
  (`{"code":-1,"msg":"please login"}`: 10.6 s → 1.2 s on an unsigned test copy). **Any
  change to Febbox's page needs both readers fixed.** The dev server can't show this path
  (no Electron); test with `electron .` on port 5299 and a test copy.
- Page-open warm-up is 0.5 s after the check says yes (was 1.5 s; the owner clicked as soon
  as the sources showed).
- Not done (on purpose): remembering "not available" longer; giving up
  on 7Movies early (its "no" takes 6–15 s; quitting sooner would hide real copies).

### Continue Watching, caught up, and new episodes (2026-10-21)
**The owner's rule:** a show leaves Continue Watching only when its last episode out has been
watched, or Remove is pressed. The status label doesn't count. Before, a show marked completed
left as soon as its latest episode passed 90%. Re:Zero had been imported as Completed and vanished
at 25:00 of 27:29 in S2E15. Autosync's "reached" update also bumps `entries.updated_at`, so the
"completed after you watched" check fired too.
- `caught_up` (db/index.ts) holds one row per profile and title. The player writes it
  (`noteCaughtUp`, `/api/watch/caught-up`) near the end of an episode with nothing playable after
  it, and when episodes are ticked by hand. It never writes while Showbox is missing from the list
  (`episodeListWhole`). Caught up at the latest row and ≥90% means the show is off Continue Watching.
- `src/lib/server/newEpisodes.ts` runs 3 minutes after start, then every 6 h, and looks at each show
  at most once every 12 h. It asks TMDB first (one request, no Febbox). Only when something aired
  within 14 days of finishing does it ask the player's own lookup (`/api/watch/resolve?nostream=1`,
  self-fetched with the PIN cookie), one show at a time, 20 s apart. A playable episode after
  `known_*` makes the show come back at that episode with `newEpisode`. That also overrides an
  earlier Remove, if the episode was found later. "Airs …" placeholders don't count, so an SVU
  episode only appears once a source has it.
- On a first look (`known_*` NULL, from the one-time fix) it only notes what's out. Ended shows
  aren't looked up at all.
- Shown as a "New episode" badge with × on the computer, and as an accent "New · S28E2" note on the
  TV. The TV's ☰ menu has "Dismiss new episode", and the title page says "Play new episode SxEy".
- One-time fix `continue-not-by-status` keeps what the old rule hid hidden. Finished shows become
  caught up; ones left midway get a `continue_hidden` row.
- The test server listens only on localhost, while the app listens on 0.0.0.0. The self-fetch tries
  127.0.0.1, then localhost. `/api/diagnostics` → `caughtUp`. `GET /api/watch/caught-up?check=1`
  runs a round now.
- Marking episodes watched in the player also moves `last_season/last_episode` forward.

### Febbox's listing fields turned into text (2026-10-21)
On the evening of 2026-10-21, `file_share_list` began sending every field as a string (`is_dir: "1"`,
`fid: "52249131"`). That morning they were numbers. `listFebboxFiles` tested `is_dir === 1`, so
every season folder read as a file. **Every show lost Showbox** and fell back to Aniwave, 7Movies and
Movy. Films kept working, because their files sit at the top of the folder.
- Now it uses `Number(f.is_dir) === 1`.
- How to spot it: shows have no Showbox while films do, with no 429s in `slowRequests`.
- Compare a kept `febbox-list|…` entry from before with one from after: the field types tell.

### Never switch to the dub by itself (2026-10-21)
`linkFor` used to try every other copy, in list order, when the picked one gave no link. Someone
watching in Japanese was then put on Aniwave's Dub. Now:
- `linkFor` only falls back to copies with the same audio (`isDub`);
- `pickFile` with no Showbox copy never takes the dub unless English was asked for;
- a switch Catalog makes by itself (`changeToFile(…, true)`) no longer saves `catalog:animeAudio`.

If the dub is the only copy, it still plays, with a short notice (`sayIfOnlyDub`).

### What "Showbox only" checks cost while Showbox was down (2026-10-21)
With Showbox gone for shows, several things quietly stopped, because they keyed on the show's
Showbox `shareKey` or a Showbox file:
- `prefetchNextEpisode` returned on `!shareKey`, so Next Episode took ~30 s. It now uses each
  copy's own share key.
- `/api/watch/prefetch` only warmed Aniwave and Showbox. It now warms 7Movies (`vidriftStream`, kept
  20 min) and Movy (`movyStream`, kept 40 min) too. A cold 7Movies lookup took 16 s; a warmed one
  answers at once.
- A fatal hls error with no Showbox key showed "Video failed to load (fragLoadTimeOut)" for good,
  even though the video played on. It now checks `shareOf(activeFile)` and gets a fresh link, and the
  banner clears after 3 s more of playing (`loadProblemAt`).
- Skip Intro by comparison (`loadSkipTimes`) only runs on Showbox files. On other sources only
  AniSkip answers: it has nothing for Dungeon Meshi E1/E4, and E5 is timed on a 24:32 cut, so it's
  dropped. Other sources' copies are different releases: Dungeon Meshi E4 is 1546 s on Showbox,
  1575/1579 s on 7Movies, 1545 s on Aniwave. So Showbox's times can't simply be reused. Their sound
  is inside the video pieces (7Movies' H.264 pieces are 28 MB), so comparing them would cost
  hundreds of MB. **Not done.**
- Re:Zero S2E11–16 on Showbox found nothing: those episodes share no ≥20 s run in the first 6 or
  last 5 minutes (no regular opening). The finder itself is fine: Dungeon Meshi E4/E5 still give
  0–90 s plus both credits.
- Auto-timing on 7Movies and Movy hears the video only as it loads (`hearAppended`), so its first
  move comes once talking after the opening is downloaded. "Don't match" now waits until a no-fit
  holds over 180 s more heard, or 80% of the video (`mismatchFrom`). Dungeon Meshi E6's Netflix CC
  fits Showbox's 1441 s copy; 7Movies' are 1474 s and 1525 s.

### Subtitle order by audio (2026-10-21)
`/api/watch/subtitles` treats English files named for the Japanese release (`madeForJapanese`:
"JAPANESE"/"JPN" in the name, e.g. `…S01E06.JAPANESE.WEBRip.NF.en[cc].srt`, Netflix's English for the
Japanese audio) as follows:
- On Japanese audio (anime), they go first and are the `default`.
- On the dub, they're never taken as the dub's captions; English CC stays first.

The `others` list is cached between requests, so it's copied with `default` cleared. Marking it in
place had made the Japanese-audio pick show as on for the dub as well.

### Skip Intro on every source, and Anime Skip (2026-10-21, later the same day)
- **Anime Skip** (`src/lib/server/metadata/animeskip.ts`) uses the owner's client ID (60 requests a
  minute). It does one search plus one `findEpisodesByShowId` per show, kept a day
  (`animeskip|<name>`). It matches the player's season and episode first, then the overall number.
  It's used only within 30 s of `baseDuration`, and each part runs until the next timestamp.
  `/api/watch/skip-times` asks AniSkip and Anime Skip at once; each kind of part comes from the
  first that has it. The player now sends `season` and `number` too.
- **Found times are kept per copy** (`skipKeyOf`): a Showbox file number, or another source's share
  key (`vidrift:tv:207784:1:4:avc`). The other sources' file numbers are the same for every episode,
  so they can't be the key. `skip-found` takes `?key=`. Old Showbox keys are unchanged.
- **The neighbour** is read from any copy with a separate sound track: Showbox, then 7Movies' Orion
  (`hevc`) copy. 7Movies' H.264, Aniwave and Movy pack their sound into the picture.
- **The copy being watched:** if it has its own track, it's compared as before (`findSkips`).
  Otherwise its sound is heard from the player's downloads (`DownloadedSound`: BUFFER_APPENDING
  pieces, only the first 6 and last 5 minutes, decoded at 8 kHz) and `fromDownloads` does this:
  1. it takes the neighbour's own intro and credits, kept or found by comparing the neighbour with
     the episode beyond it;
  2. it looks for that sound in what's downloaded so far (`locate`, again each time more arrives),
     where 20 s of a match places it.

  The player only keeps about 30 s ahead, so waiting for minutes of the start would find the intro
  after it had played. Tested on Dungeon Meshi E4 via 7Movies H.264 (1579 s long): Skip Intro showed
  3 s after starting. Kept: intro 1–91.2, credits 1455.3–1546.8 (this copy runs on about 30 s after
  the credits).
- **TVs:** for a copy with a separate track, the TV asks the computer (`/skip-maker`), as before. For
  one with its sound inside the picture (Bleach on Aniwave), the TV runs `fromDownloads` itself but
  with `referenceFrom`: the computer works out the neighbour's times (prepare with that copy's
  fid/key), and the TV only locates them in its own downloads. `locate` looks again only after 15 s
  more has arrived. Tested as a TV (`localStorage catalog:tv=1`) on Dungeon Meshi E3, Aniwave
  burned-in copy (1509 s): intro 11.1–101.3, credits 1360.4–1452. AniSkip's 0–100 would have been
  11 s off there.

### The owner's first test of the build, and what it found (2026-10-22)
- **The old episode replayed under "Loading episode…".** I added `hearDownloadsOf(activeFile)` to the
  `$effect` that builds hls.js, which made the effect track `activeFile`. Picking an episode changes
  `activeEpisode`, and through it `activeFile`, so hls was rebuilt at once with the *old* `streamUrl`
  and the old episode played from 0:00 while the new link was fetched. It's now `untrack`ed.
  **Anything read inside that effect must be untracked.**
- **`playEpisode` let the old video play on** while the next link was fetched, and progress saves
  wrote its position onto the new episode: E6 was marked 98% watched from E5's position (1469/1501).
  Now it pauses and stops loading first. The switch is marked before the pause, or the pause counts
  as the user's. `buildProgressBody` saves nothing while switching or loading. The title shows the new
  episode at once. A newer pick takes over (`episodeSwitch`). Episode buttons are no longer disabled
  while loading; that was "it doesn't let me click episode 6".
- **`linkFor`:** the copy picked gets 5 s. Then the others in the same audio answer, and the first with
  a link plays. Order: the same source's other copy, Showbox's best, the rest. The first two are
  asked alongside from the start. Before, a show set to Movy waited out Movy's lookup (50 s) with
  Showbox right there, and the fallbacks never included Showbox. The kept source now notes `hevc`
  (7Movies' two copies).
- **`changeToFile`** clears "… couldn't play this one" once a link comes.
- **Skip finding from downloads now prefers the same episode's twin** (its Showbox or Orion copy):
  1. it places the intro;
  2. it shifts the twin's credits by the same amount, so they show at once;
  3. it checks them later.

  A copy with a kept intro but no credits (from the first build) is looked at again (`incomplete`).
  With a kept intro (`known`), the shift needs no downloads, which helps when resumed past the intro.
  Small sound-track reads aren't gated on the video's buffer (`anyTime`): the 30 s gate stalled Movy
  and 7Movies "until paused".
- **IntroDB** (`metadata/introdb.ts`): `GET api.introdb.app/segments?imdb_id&season&episode`. No key.
  The IMDb id comes from TMDB `/tv/{id}/external_ids`. It has Dungeon Meshi (nearly all), Bleach, and
  SVU's credits. It doesn't say which cut, so it ranks after AniSkip and Anime Skip, and Catalog's own
  per-copy times override it. TheIntroDB (`api.theintrodb.org/v2/media?tmdb_id&season&episode`) also
  answers, but gave Dungeon Meshi E4's credits as 5–100 s: not used.

### Auto-timing moved Venom 2 by 22 s (2026-10-22)
A friend on 3.3.0 had Venom: Let There Be Carnage's subtitles "synced horribly wrong", and right
with auto-timing off. Reproduced:
- **The top subtitle was SUNSCREEN-HI**, a c1nem4 pre-release rip. Pre-release (and HDTS) subtitles
  are timed to another version of the film: about 22 s off in the first 20 minutes, close to right
  later on.
- **One clear stretch, after 2 minutes heard, gave "−22.3 s".** Later answers said the file didn't
  fit, but a non-fit never undid a delay already applied.
- **The hearing itself was fine.** BluRay and WEB-DL files score clearly at −1 to 0 s across the
  whole film.

Fixes:
- `fitAtRate` needs 3 clear stretches before answering.
- If fewer than 40% of stretches are clear, the answer must agree (within 2 s) with a confident
  `quickShift` over everything heard.
- `SubtitleSync` remembers the delay before it first moved them (`before`) and puts it back when a
  plan stops fitting.
- `/api/watch/subtitles` lists cinema-recording subtitles last (`fromCinema`: CAM/TS/TC/HDTS…,
  c1nem4, SUNSCREEN).

Checked against Venom 2's whole-film hearing (`speech-2541104-en`) and Re:Zero S2E10/12/13/15:
- Venom 2: BluRay −0.8 s, WEB −0.3 s, EVO +0.2 s; both cinema files no longer fit the whole film.
- Re:Zero: every file fits within 0.4 s, on 81–100% of stretches.

**Testing note:** `window.subSync` (dev only) has `heardSoFar()` and `last`. Saved hearings live
in `previews/speech-<fid>-<lang>.bin`; copy them to a test copy's `previews/` to replay `fitDelays`.

### Auto-timing sooner (2026-10-22)
The owner asked whether the 5–10 s wait could be shorter. Measured on Frieren, Showbox 1080p:
- **A separate sound track was only heard once subtitles were on and downloaded.** It now starts
  when the video does (`ownTrack` in the player; not on a TV). With subtitles off it stops after
  `HEARD_AHEAD` (600 s, about 2% of a 1080p episode; `wholeTrack` false). Turning them on carries on.
- **Showbox's audio pieces are 6.5 s, so a group of 20 was only 130 s.** A first answer needs about
  240 s (three 3-minute stretches 30 s apart), which meant two rounds. The first group is now
  `FIRST_ANSWER` (270 s), fetched in one go.
- **Nothing was fetched until 30 s of video was buffered.** The first group may go at 8 s
  (`canFetch(first)`).
- **Silero takes about 2.4 s per 270 s heard, and that's now most of the wait.** I tried running
  8 parts of the sound side by side (batch dimension): only 2.4 → 1.7 s, and 1–2% of talk/no-talk
  marks changed, because the model needs well over a second to settle. Not kept.
- **Opening songs need more heard.** Since the 3-stretch rule, Frieren S1E13 needed about 9 minutes
  heard for a first answer, hence 600 s ahead.
- **Fetches can be slow while the player buffers.** Sound fetches compete with the video for the
  connection; one 130 s group took about 25 s.

### OpenSubtitles' daily download limit (2026-10-22)
Never bulk-download subtitles to survey them. About 350 downloads in an hour (to look for adverts)
used up the owner's internet connection's anonymous daily allowance. `dl.opensubtitles.org` then
answers 404 with a page saying "… exceeded. If you will continue trying to download, your IP will
be blocked by our firewall", lifted after about 24 h. Searching still works; only downloads stop.
`downloadSubtitleText` now leaves OpenSubtitles alone for 3 h once it says "exceeded". The player
moves on to the next file each time one won't download, so without that it kept knocking. Survey
from `saved_subtitles` in a library copy, or download a handful at most.

### Subtitle credits and adverts, surveyed (2026-10-22)
Through 209 English files of 32 films and shows, before the limit above was hit:
- **`isCredit(cue)`** drops a whole subtitle when a credit spans lines: "Subtitles by / SDI Media
  Group", "Captioning made possible by / Touchstone…", "Captioned by Deluxe", "Press play.
  Subtitles appear. / … tryray.app", "Provided by explosiveskull", "Copyright from SI Media",
  "Synch: …", "Titles Re edited by …", and "[ENGLISH SDH]" labels.
- **`isAdvert(line)`** also drops spaced-out addresses ("www  .  OpenSubtitles  .  org"),
  "-=xXSwesubsXx=-", and letters drawn out of letters (Shrek's "SIMEDIA" banner).
- **Two older rules were dropping dialogue.** "proudly presents" took Madagascar's "The Central Park
  Zoo proudly presents…" (it now needs a subtitle team's name before it). "www." took "Awww..
  Hey.." (it now needs a word boundary).
- **Still dropped:** Spider-Man: No Way Home's "TheDailyBugle.net" lines (said in the film) look
  like a web address.

### Frozen picture watch (2026-10-21)
Friends on 3.3.0 reported Deadpool going wrong halfway through: the sound went out of time and the
picture froze, and it happened again after reloading. I couldn't reproduce it: Deadpool & Wolverine
played from halfway at 24 frames a second, and the player keeps to H.264 levels. The 4K files do
carry HEVC HDR levels (Deadpool 2's with no CODECS at all), and the 1080p ones Dolby `ec-3` variants
(dropped where the browser can't play them).

Whatever the cause, a picture stuck with the clock running was never noticed, because the stall watch
only looks at a stopped clock. `checkFrozenPicture` runs every 2 s while playing: 4 s on the clock
with fewer than 3 new frames (`getVideoPlaybackQuality`) counts as frozen. Then:
1. `recoverMediaError` plus a seek to the same spot;
2. if it happens again within 2 minutes, `refreshStream`;
3. a third time, a toast suggesting another quality or source.

Each is logged in the stop log with `what`. Tested by freezing the frame count: it was caught in
about 7 s and recovered.

### Intro sources compared (2026-10-21)
- **AniSkip** (in use): crowd-sourced and keyed by MAL id plus episode. Thin: nothing for Dungeon Meshi
  E1/E4.
- **Anime Skip** (anime-skip.com, GraphQL at `api.anime-skip.com/graphql`): needs an `X-Client-ID`
  header. Their playground page carries one; an app should get its own. Its timestamps are timed on
  Crunchyroll and carry `baseDuration`. Checked: no Dungeon Meshi at all; Re:Zero 38 of 38 in one
  entry; Frieren 35/35; Bleach 106/140. Not built: it needs the owner's own client ID.
- **Comparing sound** (skipFinder): it works on any show with a regular opening, including ones no
  site has. It misses openings that start after 6 minutes or aren't shared (Re:Zero S2), and runs only
  on Showbox.

### Background picture (2026-10-21)
Settings → Personalization → Background.
- The picture uploads through `/api/media` (the notes' upload).
- It's saved as `backgroundImage` / `backgroundDim` (0–90, default 55) / `backgroundBlur` (0–20) in
  settings, so it's never exported. `src/lib/background.ts` reads them.
- `+layout.svelte` draws a fixed `.page-background` at z-index −1, with a `var(--paper)` layer over it
  at `--dim`. Dim fades toward the theme's own background, so text stays readable in every theme.
- It isn't drawn on `/watch` or `/tv`. Cards stay solid; the sidebar gets 78% opacity via
  `html.has-background`.
- While a slider is dragged, `backgroundPreview` (svelte state) changes the picture live; it's saved
  on release.

### Scrambled subtitle files (2026-10-21)
Peekaboo's Re:Zero S2E15 on AnimeTosho has real timings, but every line is base64-encrypted
gibberish. `isScrambled` (showbox-subs.ts) refuses a file when more than half its lines are base64.
`downloadSubtitle` returns '' for those, so they're dropped from AnimeTosho's track list. That
list's cache key is `tosho-english2|`. Kept copies are rechecked on read.

### Movy (movy.sx), the fourth source (2026-10-17)
For old films Showbox and 7Movies lack (The She Beast, Miami Beach). Keyed by TMDB id
(`/movie/<id>?play=true`, `/tv/<id>/<s>/<e>?play=true`). Its lookup (`api.wecollege.net/<city>/
sources`) needs a fresh seed and answers scrambled, so nothing of it is copied: the desktop app
opens movy's page out of sight (`findOnMovy` in electron/main.cjs, session `persist:movy`) and
notes the playlist its player asks for (any 200 `mpegurl` response not from movy). Only its own
hosts load scripts/frames/images — every ad network is blocked — pop-ups refused, no leaving the
site. It tries its 18 servers one after another, in its menu's order (a "favorite" in
localStorage `app-favorite-provider` goes first, then the list from the top — so splitting the
list across windows wouldn't help). A hit takes ~5–30 s (Miami Beach: Tampa, the 12th). The last
five only carry dubs (Munich/Berlin German, Paris French, Delhi Hindi, Cancun Spanish — the
last answers 200 with nothing): the moment it asks one of them, it's a "no" (kept 6 h), ~30 s,
and a dub is never played. Before, a "no" waited out a 75 s limit and, queued, took the owner
3 minutes (The Narrow Trail, 1917); now 34 s. 50 s limit. Two windows at once at most.
- `sources/movy.ts`: fid -5, share key `movy:<type>:<id>:<s>:<e>`, listed after 7Movies on every
  film and aired episode. Answers kept (yes 40 min, links are short-lived). Same title asked
  twice shares one lookup. Its own queue, two at once: something about to play is urgent — it
  goes first and a running Watch-button check makes way at once (`MADE_WAY`: back in line), via
  `movy-stop` IPC closing that window. The owner's first try (The Narrow Margin) took 2–3 min
  queued behind checks of titles looked at on the way, though movy itself found it in 5 s; now
  6.8 s after flicking through four titles. A Watch check runs while its title is the latest one
  asked about or its page still polls (`availability.ts` `latest`/`lastAsked`), and isn't started
  once another source has it unless it's the title being looked at.
- Video: `sun.paleoak.top`, needs `Referer: https://www.movy.sx/`, H.264 up to 1080p, 5 s TS
  pieces labelled text/html (relay relabels). ~2 Mbps per download, a 6th at once refused (38 B):
  `relayReadAhead.ts` fetches the next 3 pieces while one plays — 60 s of 1080p in 20 s, played
  with no stops, 268 s ahead.
- Player `linkFor`: with no Showbox file, every other copy is asked at once; first in order wins.
- Only in the desktop app (`npm run dev` has no Electron: Movy never has anything there). Test
  with `CATALOG_PORT=5299 CATALOG_DB=<copy> electron . --user-data-dir=<scratch>`.
- Good Mythical Morning: movy lists it but none of its servers have the episodes tried.

### Mac updates without Terminal
electron-updater can't install on a Mac without an Apple developer certificate, and every .dmg a
browser downloads is quarantined (hence `xattr -cr`). `electron/macUpdate.cjs`: Catalog reads the
newest version from `latest.yml`, downloads `Catalog-<v>-mac.zip` (zipped with `ditto` in
build-mac.yml from the ad-hoc-signed app) itself — files an app downloads aren't quarantined —
unpacks it with `ditto`, checks its version (PlistBuddy), and on install renames the running
Catalog.app aside (`.Catalog-old-*.app`, deleted at next start), renames the new one in, and
relaunches; or swaps it in on quit, as Windows does. 404 for the zip (Mac build still running)
just means "next check". Not yet tried on a real Mac: the first install of a version with it
still needs the .dmg and Terminal once.

### AniList's rate limit
`fetchDetails` keeps every title's answer (`details|source|id` in watch_order_cache): AniList's is
reused for 3 days, and any failed lookup falls back to the last one kept. Right after start the
background jobs used up AniList's allowance and a title's page said "AniList is busy" (2026-10-11).
AniList allows few requests a minute (Retry-After often 30–40 s), shared by
everything on the owner's connection. `anilistResting()` / `anilistSaidWait()`
in `anilistNodes.ts` are the one switch: on a 429 every AniList caller backs
off for as long as it asked, and search shows TMDB's results meanwhile. Never
wait-and-retry inside a search — that is what made typing "jojo" take 4 s.
`searchAniList` also remembers each query for 10 minutes.

### One episode list per show
`src/lib/server/combinedEpisodes.ts`, called from `/api/watch/resolve`. TMDB's
numbering is the master. Other Showbox entries for the same show join only when
TMDB agrees (a season is named after them — JoJo S6 "STEEL BALL RUN" — or TMDB's
search for them finds the same show); Four Knights of the Apocalypse and AoT
Junior High are separate shows there and stay out. Joined episodes carry their
own `shareKey`, and the player switches `shareKey` per episode (`mainShareKey`
is the show's). Greyed placeholders (`available: false`, `airDate`) fill
seasons up to TMDB's count, but only when Showbox numbers seasons the same way.
Specials (season 0) sort last and autoplay never runs into them. The companion
lookup is saved for 3 days in `watch_order_cache` (a general JSON cache).

**Febbox's `file_share_list` is behind Cloudflare and rate-limits:** a burst of
listings (testing several shows back to back) gets 429 "Just a moment…" pages
for a while, which read as empty folders. Don't hammer it while testing.

### Watch orders
Shown to the owner as **"Watch list"** (renamed at their request); the code,
URLs (`/orders`) and tables still say watch orders. "Watchlist" elsewhere in
the app still means the Want to watch status.

The 🗂️ tab. Two sources, both resolved through TMDB for dates and posters:
- **Hand-made lists** in `src/lib/watchOrders.ts` (MCU, Ultimate Marvel, Star
  Wars) for franchises that mix films and series — TMDB has no grouping for
  those. Each title is just name + year + type; later seasons get their own
  line. `short()` marks optional extras (Marvel One-Shots): hidden unless "Show
  extras" is on, not counted in progress, and ticked off in `watched_extras`
  rather than the library, so a five-minute short never lands in Movies.
- **TMDB collections** (`collection-<id>`) for film-only series — every one of
  them is searchable, nothing to maintain. Search results are ranked by the
  collection's total vote count (TMDB's own order is useless: "Harry Friberg"
  above Harry Potter). `POPULAR_COLLECTIONS` is the grid shown before typing.

TMDB's answers are kept in `watch_order_cache` (JSON) and served straight
from there, refreshed in the background when old (released titles 30 days,
upcoming ones daily) — an in-memory cache alone meant ~130 lookups and a
5-second wait on every app start. `scheduleBackfill` warms them 15 s after
start-up.

Skipped titles are `skipped_titles` (keyed `movie:<id>:<season>`); `counts()`
says what goes into "x of y watched" — released, not extra, not skipped.

Title lookups match by name only, never "first result" — a wrong film silently
in a watch order is worse than a missing one (it logs `[watch-orders] not on
TMDB`). The user's chosen lists are `my_watch_orders`. The list page is awaited,
not streamed, so the scroll position can be restored on coming back; links out
carry `?back=` so title and entry pages return to the list.

### More like this

`src/lib/server/recommendations.ts`, shown by `MoreLikeThis.svelte` (and a row
on the TV title page). Anime: AniList's user-voted recommendations. Films and
shows: candidates from MovieLens taste neighbours (`data/film-neighbours.bin`,
built by `scripts/build-film-neighbours.mjs`; films to mid-2023, newer sequels
borrow their series' data), TMDB suggestions, the series, the director's work,
specific studios and shared topics — then scored on all signals together.

Lessons, each from a real bad pick:
- **No single signal decides.** Topics alone gave The Marvels Alien ("outer
  space"); taste alone gave X-Men: Days of Future Past two Star Trek films; a
  shared producer gave Barbie Harry Potter. A studio only counts beside a real
  topic or shared cast, and a match with no real evidence is scaled down.
- **Don't hide watched titles** — the library is mostly finished, so hiding
  them left only poor matches. They're marked Watched instead.
- **At most three by one director** (Wicked was all Jon M. Chu: Step Up, Justin
  Bieber). The cut-off is relative to the third-best, not the best, or one
  standout (Better Call Saul) empties the row.
- **Never a cartoon for live action or a documentary for a drama**; another
  language counts against a pick unless the same people loved both.
- **Shows are weaker**: no free taste data exists for TV, and TMDB's own show
  suggestions are genre-only. No extra logins or keys (the owner said no to
  Trakt).

Marks come from `inLibrary` at read time (never cached): by id, by an anime season's saved
root (`anime_roots`, one card per show), else by name (`showName` strips "Season 2"), which is
also how family profiles are matched. Completed → Watched, watching → Watching; the switch
hides both. AniList recs fold seasons of one show by name (`sameShowByName` in franchise.ts,
no lookups); the title's own seasons are left out. Right-click: Watch, View details, View
entry or the three Add choices (`/api/add`). Cache key `recs4|`, kept 30 days (marks are
fresh each read). Page loads call `startMoreLikeThis` (title, entry, TV title), and `working`
shares one working-out per title, so the row's request joins it. Turning Show watched on
scrolls the row back to the start after `tick()` (with `overflow-anchor: none`).

The API returns up to 60: the row's own, then looser ones marked `more` that
"Show more" adds ten at a time. Show watched (localStorage
`catalog:recsShowWatched`) hiding them refills the row from the looser ones so
it keeps its length.

`evalrecs.mjs`-style checks: clear `recs2|%` from a *copy* of the library's
`watch_order_cache`, then call `/api/recommendations` for a spread of titles.

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
`RELEASE_NOTES.md` is the source. Write bullets under
`## Unreleased — <title>` (the title is shown in Settings → Updates);
`npm run release` **refuses to run without the bullets or the title**, publishes them as the GitHub
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

**Order matters: the notes are stamped before the build, not after.**
`RELEASE_NOTES.md` is packaged into the app and the Updates page reads the copy
*inside* it. Stamping the `## Unreleased` heading after packaging meant every
release from 1.0.0 to 1.7.0 shipped a file still describing its own changes as
unreleased — so the app listed the version it was running as not yet released.
`abort()` puts the notes back as well as the version, so a failed build leaves
nothing half-stamped. **Anything the app reads from its own files has to be
correct before `electron-builder` runs, not before the upload.**

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

### Showbox all 360p: the account's daily high-speed flow (2026-10-22)
The owner found every Showbox title "only available in 360p" (each one switched to another source).
- **Not Catalog, and not every user.** febbox.com/console said "Run Out of High-Speed Flow, High Speed
  Flow Usage 11.49 GB / 10 GB, Flow Reset 4 Hours", and "10 GB / Day for free users, reset every
  day". After that, the player page lists only 360p.
- **Each person's account has its own 10 GB.**
- **Testing ate into it:** the test server signs in as the owner (copied settings), and Frieren and
  Venom 2 had been played at 1080p in tests that day.
- **The older note was wrong:** the 2026-10-16 note says the "limit" text is only a template. That's
  true of the player page's notice, but the real figure is on /console.
- **What Catalog does:** switches to another source, which is right.
- **Not built:** telling the viewer it's Febbox's daily limit, and when it resets, rather than "only in
  360p".

**Subtitles through Stremio.** When OpenSubtitles says a connection's downloads are "exceeded",
`downloadSubtitleText` fetches the same file from Stremio's copy instead. It uses the same file
number: `subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/<n>` for
`…/filead/<n>.gz`. Stremio's server does the downloading, so it doesn't count against the
connection. Tested on Madagascar 3 while the owner's connection was blocked.

**Built after that (unreleased):**
- `febboxFlow.ts` reads Usage and Flow Reset from /console, kept 5 min. `/api/watch/febbox-flow`
  serves it.
- `showboxHeldBack` asks it before deciding why a file came in 360p. When the allowance is out, it
  notes `catalog:febboxOut` until the reset and shows "Febbox's daily HD limit is used up for about
  N more hours". `pickFor` then goes straight to another source's HD copy.
- The "360p-only" notes made during the limit are cleared once (`catalog:lowOnlyCleared`).

### Story over the ending: never auto-skipped (2026-10-22)
Re:Zero S2E16's ending song plays over the episode's last scene, and auto-skip jumped to the next
episode. IntroDB had it as a plain outro (one submission); Anime Skip as "Mixed Credits".
- **The databases' word is kept.** `SkipSegment.mixed` comes from AniSkip's `mixed-op`/`mixed-ed` and
  Anime Skip's "Mixed …". `/api/watch/skip-times` marks a part mixed if any source overlapping it
  says so. It also does if Anime Skip says so for any cut of the episode (`animeSkipMixed`): its
  29:30 cut's mark also covers a 28:33 copy. The player's own finds borrow it (`withFound`, within
  30 s).
- **Or the subtitles say so.** `storyDuring(seg)` counts 3+ talking lines inside the part. It skips
  ASS lines styled as songs or signs (song, lyric, OP/ED, sign, title…, or `\pos`/`\move`), ♪ lines
  and "[sounds]". Checked: Dungeon Meshi's saved endings have 0 talking lines; Re:Zero season 2's
  files have 6–44 in that window.
- **What changes:** such a part is never auto-skipped (the Skip button stays). The TV's "next
  episode 10 s into the credits" waits for the end instead.

### Re:Zero on Aniwave is 720p (2026-10-22)
Aniwave lists three servers for S2E16 (`aniwave:75449:3:sub`). The one Catalog reads, Vidplay
(play.echovideo.ru), has a single 1280×720 level. BYFMS and DGHG are other players Catalog doesn't
read. The Japanese copy is labelled "1080p" but its playlist is 720p. 7Movies and Movy don't have
Re:Zero, so Showbox is the only 1080p.

### Owner's and mom's reports, 2026-10-22 evening
- **Old episode playing under "Loading episode".** Clicking SVU S28E3 paused E2, but E2 stayed in the
  video. E3 wasn't on 7Movies and was waiting on Movy (up to 50 s), and play played E2 under E3's
  name. The source menu didn't take over either: other sources' copies share one fid across
  episodes, so `changeToFile` saw "already playing". Now:
  - `oldPicture` hides the old picture and refuses play until this episode has a stream;
  - `changeToFile` during a load drops the load (`episodeSwitch++`) and starts at 0:00, with
    nothing to fall back to.
  - Tested with a slowed lookup.
- **"Latest episode is an older one" (mom, SVU S28E3).** 7Movies and Movy copies were listed from
  the start of the TMDB air date in UTC, about a day before a US evening airing. Movy then answered
  with another video. Now `hasAired()`: from 06:00 UTC the day after the air date. The player's and
  the TV page's "Airs …" use the same rule.
- **The update asked Windows for permission (mom).** That's an install in a protected folder:
  `canWriteAppFolder()` is false, so the installer window shows. The night install is skipped.
  Fix by reinstalling "only for me" (the library in %APPDATA% stays).
- **Wrong Febbox password showed "Logged in" (a friend).** sync-cookies saved any Febbox cookie.
  The login page sets one by itself. Now `isSignedIn()` asks /console first: a 302 to /login means
  "no", and nothing is saved. Settings and the player say so.
- **Mom's constant buffering (Homeland S8, then 7Movies too; better after a reload).** Not
  reproduced, and her stop log is needed. Skip finding on the laptop doesn't download video:
  `neighbourTrack` only uses separate sound tracks.

### Films only in cinemas; subtitles for the right cut (2026-10-22, late)
- **Clayface (US cinemas 23 Oct 2026) showed Watch, and Movy searched for 50 s.** Showbox had its
  page with no files, and `onShowbox` only checks that a page exists. 7Movies had a 720p HEVC
  recording made in a cinema. Now `metadata/cinemas.ts`: `onlyInCinemas` reads TMDB release dates
  by kind (2/3 cinema, 4/5/6 at home). A film counts as out from its first home date; with none
  known, 45 days after cinemas. Until then the title page says "In cinemas · to watch from …" and
  `availability.ts` says no to every source without asking (no Movy). Kept answers were renamed
  `available2|`, so old "yes" answers go.
- **Deadpool 2's captions "wouldn't sync at all" (a friend, 3.4.0).** The cuts differ by copy:
  Showbox's 1080p is the 1:59 cinema version, while its 4K and 7Movies' Orion copy are the 2:14
  Super Duper Cut. The list mixed both cuts' subtitles. OpenSubtitles' `SubLastTS` says when each
  file's last line ends (1:53:30 against 2:13:50), and it's carried as `lastAt`. The player's
  `byCut` puts files that fit the playing video's length first: not past the end (allowing 5% for
  film speed), and not 16+ minutes short. Only files with `lastAt` move, among themselves.
  `fromCinema` now also catches DVDScr/SCR/screener.
- **"Show details" in the Keeps-stopping prompt** turns the stats box on for this video only (on
  the TV too, bigger there), for mom to photograph.
- **A reinstall button: not built.** electron-builder's installer only removes an older copy of the
  same kind, or a "just me" copy when installing "for all users". Installing "only for me" over an
  "all users" copy leaves both, and two installs is how the library got corrupted. Safe options:
  (a) uninstall from Windows Settings, then reinstall with "Only for me"; or (b) a button that
  runs the old copy's uninstaller (`/S /allusers`, one Windows prompt), then the new installer
  (`/S /currentuser`), then starts Catalog. (b) can't be tested here without making an all-users
  install on the owner's PC.

### After 3.4.1: SVU S28E3 on Movy (2026-10-23)
- **Movy's E3 is the real E3.** Its picture at 5, 15 and 25 minutes differs from both E1 and E2
  (32×18 thumbnails; mean differences 27–109 out of 255), and its length (41:43) fits E3's own
  subtitles (last line 39:49). It comes from Movy's slower server (sun.paleoak.top), a single
  720p playlist, while E1 and E2 come from moon.zenoak.top in 1080p. 7Movies simply hadn't added
  it yet. Mom's "older episode" was the night before it aired, which 3.4.1's `hasAired` stops.
- **A failed switch left a red line that never went**, and the stream info said "7Movies has
  nothing for this right now" under Movy. `changeToFile` failing while something still plays now
  gives a toast, and leaves `problem` and `debugInfo` alone. Every successful link sets
  `debugInfo` to its own debug, or clears it.
- **25 s to start.** linkFor already asks every copy at once when there's no Showbox one. E3 is
  on Movy's late server, about 20 s (E2 answers in 1 s). `warmLikelyEpisode` now also warms
  7Movies and Movy copies when the likely episode has no Showbox file (a Movy check with
  start/keep tied to the last title warmed). It only helps when Watch is pointed at, or
  highlighted, before it's pressed.

### Moving an all-users install to just this account (2026-10-23)
- **Why it's needed.** An all-users install (Program Files) means every update needs Windows'
  permission, so night installs are skipped (mom's laptop). The NSIS installer can't switch on its
  own: "only for me" doesn't remove an all-users copy, and two installs corrupted the library once.
- **`electron/moveInstall.cjs`.** Settings → Updates → "Move to just my account", shown when
  `CATALOG_INSTALL_NEEDS_PERMISSION`. Steps:
  1. With Catalog open, it downloads the latest installer and checks it against latest.yml's
     sha512.
  2. It starts a hidden PowerShell helper, and Catalog quits.
  3. The helper waits for every Catalog.exe from the old folder to exit, the server process too.
     It never force-closes: after 90 s it gives up.
  4. One Windows prompt runs `remove-all-users.ps1`: the old copy's own uninstaller with
     `/S /KEEP_APP_DATA /allusers _?=<dir>` (the command the installer itself uses), removal of
     the folder, and a firewall rule letting the new exe in on private and domain networks. The
     old permission was for the old exe's path, and the TVs need it.
  5. Only if the old Catalog.exe is really gone, the installer runs with `/S /currentuser`, then
     starts `%LOCALAPPDATA%\Programs\Catalog\Catalog.exe`.
  Declining the prompt, or the old copy staying, starts the old copy again with nothing changed.
  A failed install opens the installer. Every step goes to update.log as "move: …".
- **What stays.** %APPDATA%\Catalog (library, profiles, TV settings, Febbox sign-in) is never
  touched, and the TVs find the laptop by UDP discovery each time.
- **Tested:** both scripts parse; dry runs of the helper with stand-ins for the prompt, the
  installer and the starts (old copy stays, old copy removed, install fails).
- **Not tested:** the real prompt, the real all-users uninstaller, and netsh with elevation. Each
  needs an all-users install on the owner's PC.

### Owner's and a friend's reports, 2026-10-23 evening
- **Dungeon Meshi E8 had no sound, and "0:07 / 0:00".** E8's 503 MB Showbox file is a plain MP4
  (`tv_mp4_h264`, no playlist: "vi: no-vid"), not HLS. ffprobe: H.264 + AAC stereo, 24:02, so the
  file was fine. With subtitles on, auto-timing listens to a plain file through the page's audio
  (`createMediaElementSource`), and a cross-site `<video>` without `crossorigin` gives that silence,
  which then is all that plays. Proven in Electron: same file, loudest sample 0.000 without, 0.125
  with `crossorigin="anonymous"`. Febbox's CDN sends `Access-Control-Allow-Origin: *`. Now a
  cross-site plain file gets `crossorigin`; if it errors before loading, it's loaded again without,
  and `soundBlocked` keeps it out of the page's audio (no listening, no volume past 100%). Once an
  element has gone through `createMediaElementSource` it can't come out, so a later no-CORS file
  after a boosted one would still be silent: rare, not handled. Its length: `ondurationchange`
  ignores lengths while `switchingEpisode`, which a plain file only clears on `loadedmetadata`
  (just after), so the length is now taken there too.
- **Reopening E8 landed on Aniwave with burned-in subtitles.** `linkFor` gives the pick 5 s, and for
  a Showbox pick its fallbacks never included Showbox's other copy, so Aniwave (fast) won when
  Febbox was slow. Now the same source's other copies come first for Showbox too, and a burned-in
  copy (when the pick isn't one) only wins `BURNED_IN_WAIT` (6 s) after it answered, if nothing
  else has. Tested with slowed lookups: the 830 MB copy played instead; with every Showbox copy
  slowed, Aniwave played after the wait. (It could also have been the kept source, if Aniwave
  was picked by hand while looking into it.)
- **E7 stopped to load with 20–80 Mbps pieces and "0 s ahead".** `fetchAhead.ts`: hls.js's loader
  throws "Loader can only be used once" if its start time is set, and the handover from memory set
  it. So a piece fetched ahead that failed (error, 12 s silence, tiny reply) threw in a promise, the
  player's request was never answered, and that track (picture or the separate sound track)
  stopped loading until the stall watch restarted it about 10 s after the video ran dry. Also, a
  handed-over piece had none of hls.js's time limits, so a trickling one held the player. Now
  `plain()` clears the start time, and a piece not here 4 s after the player asks is asked for the
  usual way too (first whole one wins). Tested with the real file on a local playlist: before, one
  failed or trickling piece left it stuck at 31 s of 60; after, it loads to the end. The stop log
  now keeps `pictureAhead`, `soundAhead` (from BUFFER_APPENDED's per-track ranges) and
  `soundPiecesSeconds`. Mom's buffering may be the same thing (not proven).
- **Mini player froze while the sound went on (a friend).** It shows a canvas copy (for subtitles),
  so its own play/pause acted on the copy. Now passed on to the video, and the copy follows the
  video's play/pause. Ruled out by test: the draw loop and the video keep going when Catalog is
  minimized, covered by another window, or behind the "Playing in picture-in-picture" panel.

### A bug sweep before releasing (2026-10-23, late)
The owner asked for more testing before releasing. What was checked, and found:
- **Every page** loads (server and browser) on a library copy with no errors. **Exports** (json, share, csv,
  txt) carry no settings. The only key in one is the TMDB key, written inside one of the owner's own notes.
- **The `crossorigin` fix failed in the real app.** `main.cjs` added `access-control-allow-origin` beside
  the server's own `Access-Control-Allow-Origin`, and the doubled header ("*, *") fails a CORS media
  request (error 4). Tested in Electron with the same header code on E8's real file. The fallback would
  still have played the sound, but without listening. Now it replaces the header: 0.102 loudest
  sample through the page's audio.
- **Which copy plays.** `pickFile` took the first file of the wanted quality. Febbox lists E8's 503 MB MP4
  first and every other episode's big copy first, which is how E8 got the file with no playlist. Its
  size tie-break also ignored units ("503.66 MB" beat "2.45 GB"). Now: the largest of the wanted
  quality (`bytesOf`), else the largest of the top quality. The server's warm-up (`resolve`: the first
  episode's file and the film's file) uses `pickFile` too, so it warms the link that plays.
- **A hand-ticked episode replayed.** `markEpisodes` keeps a tick as 1 s of 1. `savedPlace` only judged
  "finished" when more than 5 s were saved, so Continue Watching (it points at the latest-updated
  episode, the last one ticked) played it from 0:00, and its tick went once a few seconds were saved.
  Reproduced with E11–E12 ticked; now it goes on to E13 and E12 keeps 1/1.
- **fetchAhead's race** (both copies arrive): checked with a late early-copy, a failure, and none. All
  load to the end.

### Up next, the Showbox copy kept, and mini player buttons (2026-10-23, night)
The owner asked for three of the ideas offered after the sweep:
- **Continue Watching moves on at 95%.** `noteUpNext()` posts the next episode (duration 0, "Up next")
  once 95% of an episode is watched. It used to wait for the last frame (`episodeEnded`), so stopping
  in the credits left "S2E17 · 97% · 0m left". It's sent again after every save of the episode
  (the save on leaving too), or that save, newer, would put the watched one back on top. Tested:
  E10 at 96.6% → the card moved to E11.
- **The Showbox copy picked is kept per show** (`KeptSource.showbox`). It's kept as the file's name
  with its numbers taken out (`nameKind`: "danjon.meshi.#.#p.dual.mkv"), its quality, and whether it
  was the larger. `keptShowboxCopy` finds the same kind next episode, or else the larger or smaller
  one. Before, picking Showbox by hand forgot any kept source and picked by the default.
- **Mini player buttons.** The canvas copy in picture-in-picture gets **no play/pause button at all**
  (a live stream). With media-session handlers it shows previous, play/pause and next. Seen on screen
  in Electron 38 (desktopCapturer with the pointer over it). `skipad` shows a button reading "Skip Ad",
  so Skip Intro was left out. `setPiPActions` sets them while it's open, and previous/next are null
  where there's none. The mini player now stays open across episode changes, drawing black while
  `oldPicture`. So **the earlier "PiP pause button froze it" explanation for the friend's freeze is
  unlikely: there was no such button.** That freeze is still unexplained.
- **`mayMoveOn`.** "Finished: on to the next one" in `savedPlace` is only for the episode the player
  opened on. Clicking a ticked E12 jumped to E13: `playEpisode`'s `skipResume` is spent on the first
  ask, and a reload at 0:00 (a copy that wouldn't play) asked again. This was there before for really
  finished episodes; the hand-tick fix widened it.
- **Testing used up the owner's Febbox day:** 11.7 of 10 GB (each test episode loads up to 300 s
  ahead). Test player features on 7Movies/Aniwave (the relay), not Showbox.

### Owner's round, 2026-10-23 late night
- **The library filtered itself by a studio** (Dungeon Meshi → "Ultra Super Pictures"). The app
  preloads a page on hover (`data-sveltekit-preload-data="hover"`), and the library's `load`
  *saved* the address's filters as the kept view. So pointing at a tag chip (`/?tag=…`) on a title's
  page saved that filter. SvelteKit doesn't mark preloads, so the load only reads now. It returns
  `rememberView`, and the page posts it to `/api/library-view` once it's really shown. Tested:
  hovering preloaded `/?tag=1850` and the library stayed 438; clicking filtered it, and that was
  remembered. **No load function should write anything** (hover runs it).
- **Another Febbox account kept the old one's "used up for 14 hours" and 360p.** Three things were
  kept: the player's `catalog:febboxOut` note in localStorage (until the old account's reset);
  `febboxFlow`'s 5-minute reading; and `showbox.ts`'s 15-minute link cache (360p links). Now
  `settings.ts` tells listeners when the account changes (`onFebboxAccountChange`, by
  `febboxAccountOf`: the "ui" cookie's `data.uid`, hashed, so the same account signing in again
  keeps its name). The flow reading and link cache go, the note is kept as `until|account`, and
  "360p only" notes go when the account differs from last time (`catalog:febboxAccount`). Tested on
  the test server with a fake second uid. The video links themselves come through the Electron
  session's cookies, which the login window clears for a new sign-in. Pasting a key in Settings
  doesn't change those cookies.
- **Mini player is now a window** (`electron/miniPlayer.cjs`, `/api/desktop/mini`). The owner didn't
  like Chromium's picture-in-picture: it dims the whole picture on hover, has only play/pause, and
  can't be styled. On the computer (`inDesktopApp`: an Electron user agent), the PiP button opens a
  frameless, always-on-top 480×270 window (16:9, resizable, bottom right) on `/watch?…&mini=1&fid=`.
  `startFid` makes `pickFor` start on the same copy; `saveProgressSync` first, so it resumes at the
  same spot. The big page sets `inMini` (pauses, `stopLoad`, saves nothing, "Playing in the mini
  player"), and the main window is minimized. In mini mode, the player hides its top bar, lists and
  settings. `.mini-top` is the drag strip (`-webkit-app-region: drag`), with back ↗ and close ✕.
  `leaveMini` posts {back, playing, season, episode, fid}; the app closes the mini window, restores
  the main one and calls `window.catalogBackFromMini(said)`. The same spot and copy seek there;
  another episode or copy reloads the page on it; closed another way, `said` is null and it reads
  the saved place. Phones keep the canvas PiP. Tested in the real desktop app over the debugging
  port (`--remote-debugging-port`, a CDP script): opens at the same spot, back carries on playing,
  ✕ and an outside close come back paused at its spot.
- **Editing reworked.** `QuickEdit` on a title's page saves each click
  (`PATCH /api/entries {action:'set', fields}` → `setEntryFields`, only those columns): `StarRating`
  (5 stars = 10 points, left third of a star is the half), `StatusPicker`, favourite, times
  watched, and `ProgressPicker`. Its dropdowns come from `metadata/seasons.ts` (TMDB `/tv/{id}`
  seasons, specials left out, kept 12 h; AniList one season). "More details" is `EntryForm
  mode="details"` saving only name/category/year/dates/notes/poster (`updateEntryDetails`), so it
  never writes over a click. It's `{#key entry.finishedOn}`, because Completed dates it, and a stale
  form saved the empty date back over it (caught in testing). `localToday()`: finished dates were
  UTC (a day ahead in California evenings), and `entries.ts`'s `today()` too.
- **Rate it.** At 95% of a film, or of a series' last playable episode, if it's in the library
  unrated, on the computer (not a TV or the mini player): `rateOffer`, bottom left, once per visit.
  None of the 438 titles had a rating.

### A piece 7Movies' own server trickles (2026-10-23, before 3.5.0)
The Marvels on 7Movies, jumped to 1:00:00, stuck at 1:00:30. Its piece #605 comes from
edge.reelvault.click at about 0.35 Mbps (1.8 of 5.6 MB in 40 s, fetched directly with curl,
twice), while the pieces around it come at 47–2,400 Mbps. Catalog's relay holds a read-ahead piece
until it's whole (`pieceAhead`), and the player's `maxTimeToFirstByteMs` is 5 s, so every ask was
cut off; the stall watch then got a fresh link (same piece, same trickle). Not changed in 3.5.0.
Ideas: play the same spot from the title's other copy once a piece stays stuck, or step past it.
Testing tools: `playtest.mjs`/`stuck.mjs`-style CDP scripts against the built app on
`--remote-debugging-port`, and `scripts/dev/tvsim.mjs` (it wants a `localhost` base and address).

### After 3.5.0: Re:Zero's copy, its ending, and the TV (2026-10-24)
- **Re:Zero resumed on the Japanese-only copy.** 3.5.0's "largest of the wanted quality" took S2E20's
  1.67 GB `….S02E20.1080p.mkv` (Japanese only) over the 458 MB `….s02e20.1080p.dual.mkv` (both,
  the dub being watched). `pickFile` now ranks names saying dual/multi first (`bothLanguages`),
  then size, and compares quality ignoring case ("1080P").
- **S2E20's ending showed as 28:26–28:53.** The databases (Anime Skip/IntroDB by season number)
  have 27:59–29:27. Catalog's own find (`skip-found`, by comparing the sound with a neighbouring
  episode) only covers what the two share, and it replaced the database's. `withFound` now widens
  a find with an overlapping database span of the same kind, if that span is at most 4 minutes
  and covers at least half the find.
- **TV auto-timing on 7Movies/Movy never moved anything.** Both have no separate sound track, so
  the TV hears the pieces hls.js appends (`hearAppended`), decoding format piece + piece with
  `decodeAudioData`. In TV mode on the computer that works (SVU S28E3 fitted at +1.1 s), so the
  Fire TV's engine is the difference. It also kept copies of up to 10 whole 7Movies pieces (25 MB
  each, picture included). `src/lib/aacFrames.ts` now reads the MP4 boxes (esds for the AAC
  settings; moof/traf/trun/mdat for the samples) and keeps each piece as ADTS AAC, sound only,
  in subtitleSync and DownloadedSound. Tested: hls.js-transmuxed TS (Movy-style) and muxed fMP4
  (7Movies-style) decode identically both ways (correlation 1.000, same length). 7Movies' HEVC
  copy fitted at +5.9 s from ADTS. **Not tested on a real Fire TV.** If it still fails there, the
  next step is to report decode errors from the TV to the computer's log.
- **AHS S13E9 kept buffering on the TV.** 7Movies' server (edge.reelvault.click) and Movy's
  (rapidbrook.top; the owner's TV photos showed "slowest 222 s") are slow on pieces they haven't
  cached: 20–60 s, sometimes 102–228 s, trickling the whole time; asked again *after* it finished,
  often under a second. **A second ask while the first is going finishes at the same moment with
  the same bytes** (tested on both, 12 pieces each): the server shares one slow fetch, so racing
  was built, measured useless, and removed. What helps is asking earlier: the relay reads 6 ahead
  for 7Movies (was 2). Movy stays at 3: it refuses a sixth download, and the progress-bar pictures
  can take one. And "Keeps stopping to load" now offers "Play on <source>" first (`otherSource`:
  another source's copy, same language, no burned-in subtitles unless playing those, Showbox
  first unless its allowance is out), which `changeToFile`s at the same spot.
- **TV menus:** the sources menu now closes settings/subtitles/delay/sound, and they close it.
- **TV Back with a menu open left the episode.** `__catalogTv.back` only stopped a scan, then went
  back a page. Now `tvPlayer.closeMenu` (`closeOpenMenu` in the player) closes an episode's menu,
  the settings/subtitles/sound/delay/sources menus, or the cast panel first, and puts the highlight
  back on the player's buttons.
- **Buffering, measured for a better plan (AHS S13E9, cold stretches).** A pool of downloads that
  keeps going past slow pieces beats asking a few ahead: 7Movies with 10 at once, 2.4–5.2x real
  time (wait before play for zero stops: 3–64 s); Movy with 4–5 at once, 1.6–1.9x (31–51 s).
  Single slow pieces (48–176 s) only hurt when nothing else moves while they come. Offered: keep
  downloading the whole episode in the background to a disk cache, and the next episode too.

### Episodes downloaded ahead (2026-10-24, owner's request)
`src/lib/server/episodeDownloads.ts`. For 7Movies (H.264 copies; Orion HEVC plays direct) and Movy
only; Showbox buffers least and has Febbox's daily limit.
- **Naming.** `/api/watch/stream` adds `&copy=<share key>` to the relay link. The relay names each
  quality's playlist `<copy>~v<n>` (sound tracks `~a<n>`), and each piece `&copy=…&n=<number>`.
  Pieces are kept by copy and number because the sources' addresses change with every fresh link.
  A media playlist served with a copy registers the episode (`noteEpisode`: the pieces' current
  addresses).
- **The pool.** At most 10 downloads at once for 7Movies and 4 for Movy (it refuses a sixth;
  one is left for the progress-bar pictures). Everything being watched gets an equal share first,
  then whoever can use the rest. Each episode downloads in order from where it's being watched
  (`from`), to the end. A piece the player asks for that isn't here goes first; with every Movy
  download busy, the one furthest ahead is stopped for it.
- **Serving.** Whole pieces come from disk (`wantedPiece`; `whole=1` requests from the
  progress-bar pictures only take what's there). The TV's long-piece parts (relayPieces
  `piecePart`) are cut from a stored piece, and a piece they download themselves is kept too
  (`keepPiece`).
- **Next episode.** The player, a minute into a 7Movies/Movy episode, POSTs
  `/api/watch/download-ahead` for the next one. It asks this server's own stream and relay, so the
  pieces get the same names, and the episode downloads after what's being watched.
- **Disk.** `%APPDATA%\Catalog\downloads-ahead\<hash of copy>\<n>`. An episode goes 6 h after last
  use; at most 10 GB; at least 5 GB left free on the disk. Not part of the Storage limit (max 2 GB),
  but shown on Settings → Storage.
- **Tested.** AHS S13E9 on the computer: no stops in a minute from 23:00, up to 111 s ahead; the
  rest of the episode on disk within minutes, and E10 downloading meanwhile. TV-style (tvsim)
  through the relay: SVU S28E3 at 2.5x from a cold start, and Movy AHS S13E9 at 6.4x in the
  desktop build. Three TV-paced viewers on 7Movies at once for 150 s each: one 8 s stop in total
  (cold start).

### Live TV (2026-10-24, owner's request)
The owner wanted live sports from their list (FMHY's Live TV section). Checked: NTV, zlive and
StreamSports99 are app shells built around matches. DaddyLive lists ~900 24/7 channels in plain
markup. Famelack uses famelack-data (iptv-org's free channels). IPTV Web sits behind a Cloudflare
check. SportsBite is a large page. TVCL and TitanTV only list channels and schedules. **DaddyLive
was built** (`sources/daddylive.ts`):
- **List:** `/24-7-channels.php` cards (`/watch.php?id=N`, `card__title`). The site moves
  (dlive.sx → thedaddy.pk), so the first address is asked and the redirect remembered. Sports
  are named by a word list. Kept 12 h.
- **Stream:** `stream/stream-N.php` embeds `dembed.st/premiumtv/daddy.php?id=N`, 680 KB of
  scrambled script that refuses to run outside the page ("only works when embedded"). The desktop
  app (`electron/liveCapture.cjs`) opens the stream page out of sight (partition `live`), muted. It
  refuses advert hosts, blocks navigations off the site (an advert sent it to a game's website),
  and notes the first `*.m3u8` with its Referer/Origin (`https://dembed.st`), after
  `/api/playlist-token`. The token (`?t=<seconds>.<sig>`) lasts about 2 min. `liveLink` uses
  the kept one while good and asks for the next one 40 s before it runs out (about 5 s each).
- **Pieces are PNGs on tiktokcdn-us.com.** Their pixels, once un-filtered, read "TIKTIKPX", a
  4-byte length, then gzip of MPEG-TS (`pictureVideo.ts`; checked with ffprobe: 1280x720 H.264 +
  AAC). The relay has a `live` kind (`trustLiveHost` with the player's headers) and unwraps them
  to video/mp2t, so the computer, phones and TVs play them.
- **Pages:** `/live` (search, sports then the rest), `/tv/live` (Sports / All channels, five
  across, in the TV menu; `MENU_SCREENS` includes it), and `/live/[ch]` (its own small hls.js
  live player; play/pause by remote; Back leaves). `/api/live/channels` and
  `/api/live/playlist?ch=` (a fixed address; tokens change behind it).
- **Tested** in the desktop build: the list (899, 443 sports), ABC USA 150 s across a token
  renewal with no stops, ESPN USA and NFL Network 30 s each, and the TV screen.
- **Only while the desktop app runs** (it does the reading). Not built: DaddyLive's schedule of
  games, and the match-based sites.

### Live TV rebuilt: games by sport, saved, search (2026-10-24, owner's request)
The first Live TV ("500 boxes") was called "the worst UI". The owner wanted it organized by
sport (all the football channels, all the basketball…), a way to save a game for later, search,
and "a proper integration".
- **The schedule** is DaddyLive's home page (`#schedule`): days ("Saturday 24th Oct 2026"), then
  leagues (`schedule__catHeader` > `card__meta`, with sport emoji), then games (`data-time`
  HH:MM, `schedule__eventTitle` "NBA : Lakers vs Suns", channel links `/watch.php?id=N`). The
  `schedule-api.php?source=extra*` sources answered "No … schedule available". **Times are GMT**
  (the page says "UK", but its own script adds the viewer's offset to them, and an ESPN noon game
  is 16:00 in October). A day's list runs past midnight GMT: a game hours earlier than the
  league's latest so far is the next day, and so is an American league's first game in the small
  hours (MLB/AEW at 00:00 = 8 PM Eastern); a single "0:00" otherwise can't be told apart. Channel
  "00" ("Channel Not Listed, ask in chat") is dropped. Event-only streams (ids 1200+, "Event SD
  Stream") play like any channel. Flags (Windows shows them as letters, and England's are tag
  characters) and sport emoji are taken out of names. Kept 20 min; games that ended, or start more
  than 36 h ahead, aren't listed.
- **Sports** come from `sportOf` in `src/lib/live.ts` (league name first, then the game's own
  title for "PPV/Upcoming/All … Events"), with how long each sport's games last (for "On now").
  "Football" means American football; soccer is "Soccer" (American spelling, the owner's).
- **Channels** carry the sports their name says plus the sports the schedule has them showing,
  and a country from the last word of the name (USA, UK, Canada first).
- **Saved** (`live_saved`, per profile: `channel`, `game`, `recent` (last 12 played)). A saved
  game keeps its details (JSON) so it shows after the schedule drops it; it goes 6 h after it
  ends. `/api/live/guide` (everything), `/api/live/saved` (GET for the player's star; POST by
  game, or by id from the Roku), `/api/live/watched`, `/api/live/game`.
- **Pages:** `/live` tabs Games / Channels / Saved, sport chips with counts, search across all
  (teams, leagues, channels). Every sport shows 5 games (on now first) with See all; one sport goes
  On now / Later today / Tomorrow with a league picker. `/tv/live`: chips On now, Saved, each
  sport, Channels, Search (TvKeyboard); a game opens a box (`data-tv-sheet`, Back closes it:
  `TvMenu` now only closes itself when it's open, or it stole the focus back) with "Watch on …"
  and Save. The player (`/live/[ch]?name=&game=`) shows the game, a Channels list (switches in
  place), and the star; a channel that won't play offers the game's other channels.
- **Player servers:** a channel's page exists on 7 servers (`stream`, `cast`, `player`, `watch`,
  `plus`, `casting`, `hub`), whose playlists come from different hosts (cowedd…sbs, an :8443 host,
  uzhi.ru). One that fails moves that channel to the next (`liveTrouble`). Tested with the others
  first: `cast` refused ESPN, `player` played it (plain .ts pieces). The capture only takes an
  address whose *path* ends `.m3u8` (JW Player's analytics pings mention one) and blocks
  `jwpltx`.
- **Tested** in the desktop build: GOLF Channel for a golf game started in 2.4 s, the Channels
  list switched to Sky Sports Golf (1.5 s), an event stream (1204, the Osaka final) started in
  11.6 s, all 30 s with no stops; the TV screen's remote path (down, OK, Save, Back).

### More than one Febbox account (2026-10-24, owner's request)
Mom's laptop serves 4+ TVs, and one free account's 10 GB a day runs out. `febboxAccounts.ts`:
extra sign-ins in Settings (`febboxMore`, JSON list); each link is asked for with the account
with the most HD left today (`febboxFlow(token)`, kept 5 min per account; the main one on a tie);
a link that comes back held to 360p (its `quality=` left on) passes that account over for 10 min
and asks the next. In the desktop app each extra account has its own cookie store
(`persist:febbox-<key>`), filled from its sign-in (`holdFebboxSignin`); the `get-video-url`
handler uses that session for its fetches and hidden windows. The fallback through the app's
own window is the main account's only. Settings → Services: "More accounts", each with today's
use, "Add another account" (a sign-in window in its own store, `#catalog-more`; the sign-in is
kept only if Febbox says it's signed in) and "Paste its key". `/api/watch/febbox-flow` is out
only when every account is; the player's account name is all of theirs. **Tested:** a link asked
through a separate store (the main sign-in standing in) came back 1080p; the add window opens in
its own store and, closed unsigned, adds nothing. Not tested with a real second account.

### The buffer bar on TVs (2026-10-24)
Mom's TV bar "barely loads". The player already asks for 5 minutes ahead (`maxBufferLength:
300`), but a Fire TV's browser only holds a minute or two of 1080p in memory, so the TV's own
bar stops there whatever it's told. What the computer has downloaded ahead (7Movies, Movy) now
shows as a lighter shade (`heldRanges`, from `GET /api/watch/download-ahead?copy=`, mapped onto
the playing quality's pieces by their `n`): that's how far the TV can play without waiting on
the source. Tested on SVU over 7Movies: 12% held a minute in.

### Roku (2026-10-24, owner's request)
Roku apps can't show web pages, so `roku/` is a SceneGraph app that asks `/api/roku/*` (hello,
login, profiles, home, title, play, subtitles, live) and plays with the Roku's own player.
`roku/README.md` has how it works and how to install it (developer mode, upload the zip from
`npm run roku`). `/api/roku/play` finds the copy as the player does (resolve, `pickFile`, no
HEVC, Japanese for anime), its link, where it was left and the next episode. `/api/roku/subtitles`
gives English as WebVTT (ASS turned into plain cues). Every request says `CatalogTV/` (so the
profile cookie counts) and carries the PIN cookie. **Checked** with BrighterScript's compiler
(no errors; it caught three planted ones) and every endpoint answered as a Roku asks. **Not run
on a Roku**: layouts, focus, dialogs (StandardKeyboardDialog/StandardMessageDialog fields) and
playback (relay fMP4 parts, subtitles with the PIN cookie) are unproven.

### Live in the main player, replays, and the Roku like the Fire TV (2026-10-24/25, owner's round)
- **One player.** Live channels play in `/watch?live=<ch>&name=&game=` (`liveMode`), replays in
  `/watch?replay=<id>&name=` (`replayMode`); `sportsMode` turns off what's the library's: saving
  the place, subtitles lookups, cast, skips, auto-timing, the hearing of appended sound. Live:
  LIVE badge, star, the game's channels where the files would be (switching uses `replaceState`
  and `startLive`), a full bar with "N behind · Go live" past 15 s, `liveSyncPosition`. hls.js gets
  `enableCEA708Captions` + `renderTextTracksNatively: false`, and `CUES_PARSED` feeds the channel's
  own captions (CEA-608) into Catalog's subtitles (ABC had them). `/live/[ch]` now redirects.
- **TV Live chips**: the picked one in the accent color, and a click moves the highlight
  (`tvFocus`), as on the TV library.
- **Right-click on /live**: a game's channels, Save, "More <sport>"; a channel's Watch and Save.
- **Downloads ahead**: own limit in Settings → Storage (`downloadsAheadGb`, 5–100 GB, default 20;
  the general cache got 5 and 10 GB too). `finishedWith(copy)` (DELETE
  `/api/watch/download-ahead?copy=`, from `episodeEnded`, a switch past 90%, a film at 95%, the Roku's
  end): gone 3 min after its last piece was asked for (a minute's timer). Tested: gone in 4 min.
  Playback stats: "On the computer: N% · M past here · K downloading".
- **Replays** (`sources/replays.ts`, `/api/live/replays`, `/api/live/replay?id=&v=`): NFL-Video and
  Basketball-Video (game page → "Server #n (OK|DM|FM)" buttons → an advert page holding the
  `ok.ru/videoembed/<id>` → its `data-options` metadata `hlsManifestUrl`, bound to the computer's
  address, so through the relay; Dailymotion by its metadata API), and SoccerFull (`?sid=`
  versions → `/hls/<id>.m3u8`, pieces = a 1×1 PNG then MPEG-TS, unwrapped in `pictureVideo.ts`).
  A game hours old often only has ok.ru's "mobile" copy (no playlist): the next server is tried,
  else "not ready yet". Dead ends: WatchReplay (stopped mid-September), ReplayZone's ok.ru and
  Dailymotion copies (taken down), Filemoon/Byse (need a click). Tested: an NFL game 1080p,
  2½ h, started 4.6 s, jump to the middle 2.4 s; a soccer match 720p, started 0.3 s.
- **Roku, rebuilt to match the Fire TV**: `NavMenu` (the Fire TV's icons, drawn from its SVGs),
  `ShelfScreen` (banner + rows from `/api/roku/rows`, which builds them with the Fire TV's own
  `src/lib/tv/tiles.ts`, plus each tile's `go`, `actions` (the TV menu's) and `warm`),
  `LibraryScreen`, `LiveScreen` (chips + grid, Replays), `SettingsScreen` (captions, auto-skip,
  autoplay: on by default as on the Fire TV), `ProfileScreen` (faces), `TitleScreen` (Fire TV's
  buttons and words via `/api/roku/title`, seasons/episodes via `/api/roku/season`, which uses the
  player's own numbering where it differs, as the Fire TV does), one `TileItem` for every tile,
  `PlayerScreen` (skips from `/api/roku/skips` with `src/lib/skipMerge.ts`, shared with the web
  player; a fresh link on an error; captions; autoplay). Back: closes the top screen, else opens
  the menu, else goes Home, else leaves. Still never run on a Roku.

### Owner's round, 2026-10-25: live captions, Back, channels by country, the stop log
- **Live captions can't be auto-timed (tried and measured, then taken out).** They're CEA-608 roll-up
  captions typed by a person as the commentators talk. On a CBS NFL game (about 8 minutes heard
  from the player's own downloads, through `hearAppended`): talking 78% of the time, and each line
  shown twice as it rolls up, so a caption is on screen almost all the time (735 s of captions in
  450 s). Subtitle alignment ("talking" vs "a caption showing") found nothing clear and called them
  "don't fit". Each line counted once, from when it first shows: best −2.6 s, not clear. Caption
  text rate vs talking: peak at 4 s late, r = 0.21. First new line after a pause in the talking:
  0.8 s early to 8 s late, about 1.8 s typically. The lag changes line by line. **Built instead:** the
  delay set by hand on live captions is kept on the device (`catalog:liveCaptionDelay`) and used
  for the next game. (Also found: the player handed auto-timing the sound it had already
  downloaded again every time the subtitles changed; `useAppended` now says when it's newly
  started, and only then are they handed over.)
- **Back from live or a replay went to the search** (`goBack` only went back a page with
  `auto=1`). Now `history.back()` when the player was opened from another Catalog page
  (`afterNavigate` with a `from`), else `/live`.
- **Channels by country:** `/api/live/guide` gives `homeCountry` (Where to watch's region as the
  channels' country name, `countryForRegion` in daddylive.ts: "US" → "USA", "GB" → "UK"). `/live`'s
  Channels starts filtered to it until a country is picked by hand that visit (kept in session
  storage only then); a search covers every country. TVs and the Roku have no country picker:
  `countryRank(country, home)` puts the home country's channels first there.
- **SVU's "microbuffer with the whole bar loaded" (7Movies HEVC/Orion copy):** that copy has pieces
  whose picture starts 2 s after the time the playlist gives (S28E3: piece 58 at 5:42.2 starts at
  5:44.3, piece 87 at 8:36.4 starts at 8:38.4), so there's a 2 s hole in what's loaded. hls.js says
  `bufferAppendNoProgress`, the video stops for about 0.1 s and steps over it, and about 3 s of the
  episode are missed. The H.264 copy plays straight through that spot. The HEVC copy isn't
  downloaded ahead on purpose: its pieces come straight from `*.hakunaymatata.com` at
  150–800 Mbps (the stats now say "not needed" for it).
- **The stop log said "No clear cause" every time.** Of the 34 kept, about 25 were switches (another
  source, episode or fresh link), logged as the old video was cleared (position 0, height 0). The
  real ones had fast pieces and 0 s loaded: a piece that hadn't come, which the log never saw (it
  only had pieces that finished). Now (`stopStarted`/`stopEnded` in the player):
  - switches and the load after a jump are left out;
  - a stop is kept when it ends, with how long it lasted (or "still stopped after 30 s");
  - it records the piece being waited for, how long it had been asked for, when it came, and when
    the last piece arrived (`FRAG_LOADING`/`FRAG_LOADED`);
  - it records frames drawn and dropped in the last 10 s, HEVC or not, and a hole in what's loaded
    just ahead or behind;
  - it records the last 30 s of events: jumps, quality and sound-track changes, fresh links,
    decoder rebuilds, the window hidden, and hls.js warnings in plain words (`PLAYER_WARNINGS`);
  - `relayed` now means pieces came through this computer (a relayed playlist's pieces can come
    direct);
  - live and replays are labelled as such (they said "Showbox").

  Settings → Playback reads them, in this order: a hole; dropped frames; window hidden; a change
  just before; a jump; a warning; "not the connection, N s was loaded"; and when it ran out: the
  server stopped answering; a piece hung; a piece took N s; the site was slow sending to this
  computer (by bitrate, or a piece taking 8 s+ when the playlist doesn't say). Old entries with
  nothing in them are labelled as probable switches.

### Owner's second round, 2026-10-25: HEVC downloaded too, picture holes, game pictures, your sports
- **7Movies' HEVC (Orion) copy is downloaded ahead too.** It had been left out because its pieces
  come straight from `*.hakunaymatata.com` at 150–800 Mbps. The owner's point: fast for them isn't
  fast for mom's TVs, and there's little harm. `downloadKindOf` takes every `vidrift:` copy now.
  The relay's `direct()` points a `playsDirect` server's pieces back through the relay when the
  copy is downloaded ahead, so they're served off the disk. Tested: S28E3's picture was 353/411
  pieces and its sound 492/493 about 40 s in (554 MB). A TV only gets the HEVC copy when its
  browser says it can play HEVC (`canPlayHevc`), so mom's buffering was most likely on the H.264
  copy and Movy.
- **"The picture paused but the sound went on, no loading sign" (SVU HEVC, after a jump):** it's
  the copy's 2 s holes. In piece 87 (8:36.43) the third frame has the keyframe's own time, so the
  browser's MSE replaces the keyframe and drops the 2 s until the next one (`ffprobe` of the
  stored piece). With a separate sound track, Chromium plays the sound on over the hole with the
  picture still. Ordinary jumps (7:00, 18:20, 25:00, 31:40) were fine. `stepOverPictureHole`
  (on timeupdate) jumps a hole of ≤3 s in the picture's loaded parts (`trackRanges.video`) once
  it has stayed a hole for 5 s (a piece on its way fills in by then), and notes it in the stop
  log's events. Tested at both holes: no still picture. Rewriting the piece's timestamps was
  judged too risky.
- **Game pictures** (`src/lib/server/teamArt.ts`, `src/lib/GameArt.svelte`):
  - ESPN's public team lists (`site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams`, no
    key) give each team's logo (the `dark` one) and color. DaddyLive's league name picks the list
    (`LEAGUES`); college games of any sport use the basketball schools' list, then football's.
  - The title's two sides are matched by name in order: exact (or the abbreviation, "PSG",
    "AZ"); the nickname ("Clippers": "LA Clippers" lost to the Lakers' "Los Angeles"); then the
    longest name inside.
  - Club words like "Sporting", "Real" and "United" never count alone ("Sporting Braga" got
    Sporting CP).
  - Lists are kept a week in `watch_order_cache` (`espn-teams3:`; bump the number when the name
    building changes). `/api/live/guide` waits at most 4 s for them.
  - 76 of 134 games on a Sunday had logos; the rest show their sport's picture (a ball on the
    sport's color, `SPORT_COLORS`).
  - Computer: a thumbnail on each row. TV: across the top of each box, and Replays now show their
    own picture.
  - Roku: `/api/roku/live` items carry `logos`, `sport`, `sportColor` and `poster`. `TileItem`'s
    `showGameArt` draws the logos on their colors, a replay's picture, or the sport's name on its
    color (the Roku can't show emoji). Game cards are 540×380, two rows. Checked with
    BrighterScript only.
- **Your sports:** per profile (`live_saved` kind `sports`, key `picked`, the list as JSON;
  `liveSports`/`setLiveSports`, `/api/live/sports`; null means it hasn't been asked).
  - The first visit to Live TV asks (computer: a panel; TV: a box, Back closes it and it asks
    again next time). Done, or "Every sport" (an empty list).
  - After that the sport chips, All sports / On now, and Replays only show those, and "+" changes
    them. A search still covers every sport.
  - The Roku has no picker; it follows the profile's picks.

### Owner's third round, 2026-10-25: mini player, a friend's reports, scores, favorites, one click
- **The mini player** (`/watch?mini=1`, its own always-on-top window, 480×270 at first) is the
  same player page, but its CSS hid the volume slider, subtitle timing and every button right of
  the spacer (subtitles, sound, settings), and the top bar with the source picker. A friend found
  "only mute". Now it shows them all, sized down: menus fit the window and scroll
  (`max-height: calc(100vh - 84px)`), the volume slider opens to 76 px, the time hides under
  430 px. The source picker is a snippet (`filePicker`) rendered in the top bar and in the mini
  player's top strip. Fullscreen and picture in picture stay hidden there (it already is one).
  Checked at 480×270 by CDP: subtitles menu, picking subtitles, the timing popup, the volume on
  hover. **Gotcha:** the live channel picker also uses `class="file-pick-wrap"`; cutting the
  file picker out by that class took the wrong block once.
- **A friend's films "stop and go back a few seconds" (3.5.0):** not reproduced. Every place the
  player moves the position by itself was checked: the fresh link (`refreshStream` keeps
  `currentTime`), the decoder rebuild (hls.js `recoverMediaError` restarts at `media.currentTime`),
  the stall nudge (forward), `startLoad(-1)` on `bufferStalledError` (hls.js only moves the
  *download* to its `lastCurrentTime`, the last forward seek, not the picture). None goes back. So
  `noteJumpBack` (on `seeking`) logs any jump back of over a second with no click, key or wheel in
  the 2 s before, as "Went back N s by itself", with the last 30 s of events. Ask for Settings →
  Playback after the friend updates. 3.5.0 already logs frozen-picture recoveries.
- **Hurt Locker microbuffer (a friend on 3.5.0, Showbox):** not looked into (testing Showbox
  plays on the owner's Febbox allowance). This build's stop log will say which kind it was.
- **Live scores** (`src/lib/server/liveScores.ts`): ESPN's scoreboard for each league a game's
  teams were found in (`art.league`; college lists with `groups=80/50` for the whole division),
  matched by the two teams' ESPN names, kept 45 s. `GameScore` {a, b in the title's order, state
  pre/in/post, detail "7:25 - 4th"}. `isOnNow` trusts the state (over is over, overtime is on).
  `/api/live/scores` refreshes them every minute while Live TV is open. The score shows big on the
  game picture (TV), in the row (computer), and in the Roku's card text. 20 NFL/NBA/NHL/soccer
  games had scores on a Sunday afternoon.
- **Favorite teams:** `live_saved` kind `team` (key: ESPN's name; data: name, logo, color),
  `/api/live/teams`, the guide's `teams`. Their games come first in On now and each sport, under
  "Your teams" (a section on the computer, a chip on the TV, a row on the Roku), with a ★. Set
  from a game's right-click menu (computer) or its box (TV menu button). The Roku follows.
- **One click** (`src/lib/server/liveChannelPicks.ts`, the guide's `best`, `bestChannel` /
  `channelsBestFirst` in live.ts): a game plays on the channel that played best for its league
  (+3 per minute-long play, −4 per failure or switch within a minute, half that for the sport),
  else Where to watch's country (+2), else English (+1), else others (−1), in schedule order.
  The player tells it (`tellChannel`): ok after 60 s played, not ok when it gives up or another
  channel is picked within the minute. Kept per computer (`watch_order_cache`
  `live-channel-picks`). TV: OK plays it; the menu button (`catalog:tv-menu`) opens the box
  (channels best first, Save, the teams). Roku: OK plays it; * opens the box. Computer: the
  picture, time and title play it, and its channel buttons list it first. Tested: Ravens–Bengals
  → CBS USA, Texans–Giants → FOX USA.

### 7Movies' HEVC freezes, found and mended (2026-10-25, a friend's Hurt Locker)
The owner saw the picture stop for a few seconds while the sound and subtitles went on, several
times, on a friend's Hurt Locker (7Movies HEVC, 3.5.0). Measured:
- **The holes are real and fixed in place:** all 1,567 pieces downloaded, then stepped through
  in the browser. 11 holes of ~2.4 s each (3:07, 18:21, 28:55 …). SVU S28E3 had 2.
- **The cause:** an hls.js trace at 18:21 shows piece 221 appended straight after 220, cleanly
  joined, and the browser dropping its first 2.4 s (up to the next keyframe). hls.js retried it
  three times ("bufferAppendNoProgress"). In the piece's index (moof/traf/trun, per-frame
  composition offsets), one of the first frames has the keyframe's display time, and a slot a few
  frames later is empty. 1,148 of 1,567 pieces are like that. The browser only sometimes lets the
  later frame replace the keyframe, which is why only 11 make holes. (Earlier notes said "the
  third frame repeats the keyframe's time" was the hole; it's in nearly every piece, so it's the
  cause but not a sure sign.)
- **Also odd but not the cause:** the playlist says every piece is 5.00 s. They're 4.7–4.9 s, with
  some 7.2 s, so the playlist's times drift up to 2 s from the real ones; hls.js corrects as it
  goes.
- **The mend** (`src/lib/server/pieceRepair.ts`, `repairFrameTimes`): in each trun, if exactly one
  non-keyframe has the keyframe's time and exactly one slot on the even frame grid is empty, that
  frame's composition offset is rewritten to the slot. **(Wrong: it was the keyframe that belonged in the slot; see the sixth round below.)** Same size; anything else is left alone.
  The relay applies it to every 7Movies piece it hands over: from the disk, from its read-ahead,
  or fetched (an MP4 piece is read whole for it). The H.264 copy's TS pieces are untouched.
- **Tested:** offline, all 1,148 mended, every piece then clean, sizes the same, still decodes.
  In the browser after clearing its cache: 0 holes in Hurt Locker and in SVU S28E3. Playing
  through 18:15–18:27 had no still picture, and piece 221 went in first time.
  `stepOverPictureHole` stays as the fallback for other copies.
- Browsers keep relayed pieces for 6 h (`max-age=21600`), so someone who watched one just before
  updating can still get an old, faulty piece from their cache for a few hours.

### Owner's fourth round, 2026-10-25 evening
- **Live TV and Replays were slow to open** (3–5 s, then 1.6 s for Replays): each opening could find
  its caches out of date and fetch DaddyLive's schedule, ESPN's lists and scores, and the replay
  sites. Now the schedule, channel list, replays and scoreboards answer from the last copy at
  once and fetch the next one behind it. `hooks.server.ts` warms the schedule (with pictures and
  scores) and the replays 5 s after start and every 10 minutes. The pages show the last guide in
  this window at once (`liveKept` in live.ts) and ask for replays as Live TV opens. Measured:
  0.66 s for the first open right after start, then about 0.01 s.
- **Replays:**
  - A replay opened on the search page until its address came: `startReplay` set `loading = false`
    first. It now loads until then.
  - Rockets–Hawks played only 15 minutes: Basketball-Video's extra "Game" link is a 480p condensed
    game (15.6 min), taken because the full-game servers weren't ready a day after. `/api/live/replay`
    measures each version's length (`lengthOf`). Under 40 minutes is condensed, only played when
    nothing else is, with `condensed` (minutes) shown in a notice and in the versions list.
  - Answers are kept 20 minutes, and a replay pointed at for 0.4 s is looked up ahead
    (`warmReplay`).
  - Replays have no captions (ok.ru copies), so there's nothing to auto-time.
- **No emoji in Catalog** (owner's rule): the sport pictures are photos from Wikimedia Commons,
  cropped 960×540 into `static/sports/<sport>.jpg` (`sportPicture`). They're used in the sports
  picker, for games without team logos, and on the Roku (`sportPicture` in `/api/roku/live`).
  The picker is "Pick the sports Live TV shows", with one line saying what it does.
- **Other countries' games** (`src/lib/server/liveLocal.ts`, `local` on each game): local means a
  channel from Where to watch's country, or one of that country's own leagues (`OWN_LEAGUES`:
  USA, UK, Canada, Australia, Ireland). For the USA: 40 of 133 games kept, 93 hidden. "Other
  countries" (a chip, per device, `catalog:liveAllCountries`) shows the rest; a search finds all.
  Favorite teams always show. The Roku shows local games only.
- **Hurt Locker's auto-timing gave up at 1:50** (a friend, 3.5.0, Showbox). Reproduced with all four
  English files. The talking is quiet under constant noise: picked up during only 40–50% of
  the lines, and at 110–115 min noise read as talking 66% of the time. No 3-minute stretch was
  ever clearly ahead of the next-best delay, so it said "doesn't fit". Yet most stretches
  pointed to about +20 s (this copy has a longer opening).
  - `agreement` in subtitleAlign.ts: when the stretches give no clear answer, a stretch's best
    within ±150 s is taken (every 90 s). If a quarter or more land within 2 s of the whole film's
    best, that's the delay for the whole film. Right files: 36–48%. Wrong ones (another cut,
    lines backwards or scrambled, another video's): 0–4%, and still don't fit.
  - Result: YIFY +19.9 s, circle and DVDRip +21.2/21.4, and devise (a PAL-speed release, found
    by the rate check) +20.9. About 1 s per film, only when the stretches failed.
  - `SubtitleSync`: once a plan has fitted with 15 minutes heard (`fittedWith`), a later "doesn't
    fit" keeps the fitted plan instead of undoing the delay and switching subtitles.
  - Risk: Venom 2-style subtitles for another cut could now fit at one delay where they used to be
    refused. Not tested (no data); the wrong-subtitle tests above passed.
- **"Rate it"** no longer shows in the player at 95% (Hurt Locker's credits are about 6%). The
  player notes 90% watched (`askForRating` → `rateWanted`), and on leaving (`beforeNavigate` →
  `offerRatingOnLeaving`) sets `ratePrompt.offer` (`rateLater.svelte.ts`; not `ratePrompt.svelte.ts`,
  which clashes with `RatePrompt.svelte` on Windows). `RatePrompt.svelte`, in the root layout (not
  on /watch or /tv), shows it bottom right for 30 s. Tested: nothing during 127 Hours at 92%, and
  the card on its page after Back.
- **Roku setup PDF:** `Catalog Roku setup.pdf` (owner's Downloads), made like the Fire TV one
  from an HTML page printed by Edge headless. It covers developer mode (Home×3, Up×2, R L R L R),
  `http://localhost:4173/catalog-roku.zip` on the laptop, upload as `rokudev`, then the remote.
  `npm run roku` refreshes `static/catalog-roku.zip`; it must be run when roku/ changes.

### Owner's fifth round, 2026-10-25 night: replays that wouldn't play, condensed games, places kept
- **Bengals–Ravens said "can't be played yet" with five odd versions** ("Server #1 OK", "Server #2
  DM", "Server #3 FM", "Game", "OK"). Only #2 (Dailymotion) had a video. Its first playlist
  (`cdndirector.dailymotion.com`) answers curl and browsers but gives **403 to Node's own fetch
  whatever the headers**; its real playlists and pieces (`*.dmcdn.net`) are fine. The relay now
  asks hosts matching `BROWSER_ONLY` through the desktop app's browser (`electronFetch`) and
  rewrites that playlist as usual (`servePlaylist`, the relay's playlist code moved into a
  function).
- **`src/lib/server/replayAnswer.ts`** (the replay endpoint's logic):
  - Every version is tried at once and measured, and the same video under two buttons is listed
    once. Names say what it is: "Full game · Dailymotion", "Condensed, 44 min · ok.ru". Versions
    that don't play are '' (the player's menu skips them).
  - Condensed is by sport (`CONDENSED_MINUTES`: football 100, basketball 70, hockey 80, baseball 100,
    soccer 75, else 40). The NFL's condensed games run ~45 min: Bengals–Ravens' 44-minute copy
    was first called "full".
  - A replay with nothing playable is left out of the lists for an hour (`replayNotReady`).
  - `checkNewReplays` (in the 10-minute warm-up) tries the newest (36 h) twelve, three at a time,
    so they're known before they're shown. `condensedOnly` puts "Condensed, N min" on their cards
    (`replayLine`).
- **"Replays start mid-sentence":** the player starts at 0:00 of the file. Bengals–Ravens' upload
  itself opens inside CBS's NFL Today. That's the uploader's recording, not Catalog.
- **Replays keep their place** in `watch_progress` as type `replay` (title, season 0, episode 0,
  the site's picture), and `noteReplayWatched` keeps id → title in `live_saved` kind `replay`
  (the last 12). Continue Watching includes part-way replays (`href` on the item: the computer's
  cards, the TV's tiles via `fromContinue`, the Roku via `goOf` → place `replay`), with no
  library actions on them. The player resumes via `replayPlace`; the Roku starts at the answer's
  `resumeAt` and saves with `m.replayPlan`. Tested: left at 10:12, the card showed 23%, and
  clicking it resumed at 10:12.
- **Recently watched** on Live TV (the guide's `recentReplays` plus `recent` channels): a section
  on the computer's Games (above Your teams), a chip on the TV, a row on the Roku.


### Owner's sixth round, 2026-10-25 late night: SVU stutter, auto-timing flip-flop
**"The video is clearly skipping frames, like rubberbanding" (SVU S28E3, 7Movies HEVC, ~34 min).**
The mend of the round before was wrong, and made it worse.
- **What the frames really are:** the keyframe at the start of each piece is a CRA, and the 1–4
  frames after it in the file are RASL "leading" pictures, which are *shown before it*. Read
  from the video itself: the picture number (POC) in each frame's slice header (`nal_type` 21 =
  CRA, 8/9 = RASL; 8-bit POC LSB, one slice per picture). In 73 of 79 pieces on disk the
  *keyframe* carries a wrong time (two frames early, on top of a leading frame), and the empty
  slot is where the keyframe belongs.
- **The old mend moved the other frame into the slot.** That stopped the 2.4 s holes but showed
  the keyframe and two leading frames out of order once per piece (about every 6 s): a visible
  step back and forward. The unmended copy stutters too (by one frame). Proven with ffprobe: on
  init + mended pieces, frames come out of the decoder in POC order, and their times went back
  twice per piece with the old mend, never with the new one.
- **The mend now** (`pieceRepair.ts`) moves the keyframe into the empty slot. Checked against
  the POC order: 73/73 right. Played in the test app: 0 dropped frames, 600 frames per 25 s, no
  jumps in `requestVideoFrameCallback`'s media times, at 8:36, 18:15 and 33:50, and through
  arrow-key skips back and forward.
- **Cache:** relayed 7Movies piece addresses carry `&mend=2`, so pieces a browser kept (6 h)
  from the old mend aren't used. Bump it if the mend changes again.
- **New seam, mended in the player:** Chromium only keeps a piece's leading frames when that
  piece is appended straight after the piece before it. A piece that starts a run of appends
  (the first after a jump) loses them, so when a run from behind later reaches it, a hole of 2–4
  frames (0.08–0.17 s) is left, and hls.js skipped ~0.46 s there (picture and sound). Tested with
  a plain MSE page: appending 361–363, then 358–360, leaves 2168.083–2168.166; removing and
  re-appending a piece only moves the hole to the next or previous piece (removal takes the next
  piece's leading frames too, and every re-append starts a new run). What works:
  `mendPictureSeam` (watch page, on BUFFER_APPENDED of video): a hole ≤0.3 s right next to the
  piece just appended gets the video flushed from the hole to the end (`BUFFER_FLUSHING` …
  Infinity). hls.js then appends the next piece straight after the one just appended, and the
  rest in order, from the computer's copy. Tested: the two parts joined into one, and playing
  across the join had no jump. Once per hole (`seamsMended`).
- A hole *behind* a run's first piece (when nothing before it is loaded) is harmless: playback
  starts at the keyframe after a jump anyway.
- Bench (scratchpad): `poc.mjs` (POC per frame), `truth.mjs` (mend vs POC order), `mendcat.mjs` +
  ffprobe `frame=pts` (decoder order times), `serve.mjs` + `mse*.js` (plain MSE tests).

**"Auto-timing kept changing between +8.5 and +7.3, never felt right" (same episode).**
- The whole episode heard (`subSync.heardSoFar()` dumped by CDP, replayed with
  `subtitleAlign.ts` in Node): this copy runs ~1.5 s longer at each ad break than the WEB
  subtitles, so the right delay steps up at each act: +1.1, 2.6 (5:20), 4.2 (10:55), 5.6
  (21:53), 7.3 (27:01), 9.0 (34:13), 8.6 (37:46). Each step lands in the 10–30 s gap with no
  lines at the break, so the step places were right. The owner was at the 7.3 → 9.0 break.
- **The fault:** one 3-minute stretch at 35:00 said +8.5 between two +9.0s, and the noise filter
  only dropped answers more than 1 s off, so the plan went 9 → 8.5 → 9 within a minute.
  Stretches overlap by 2½ minutes, so a real change always shows in several in a row: an answer
  ≥0.4 s off both neighbours that agree within 0.4 s is now dropped (`fitAtRate`). Plan after:
  one step per break, no back-and-forth.
- **Checked and ruled out:** the sound track's clock. Orion's audio playlist lists 5.013/5.014 s
  per piece (the pieces are 5.0133 s), so `readSoundTrack`'s EXTINF times are within 0.2 s over
  the episode. (If a copy's EXTINF ever lies, the fix is to take each group's start from its
  first piece's `tfdt`.)

**Live TV's TV shows (owner, same night): "SNL, Family Feud, Jeopardy show a sports picture and say games".**
- DaddyLive's schedule has a "TV Shows 📺" category (about 33 a day: Jeopardy!, Family Feud, FBI,
  The Voice, late-night shows, even "🏈 Monday Night Countdown"), and puts SNL under "Upcoming
  Events" marked 📺. All were sport `other`. Now they're `tv` ("TV shows", 1 hour, color
  `#283a5c`): the category, or 📺 in the title (`readSchedule`), with no league.
- **Pictures** (`src/lib/server/showArt.ts`, called from `withArt`, so the computer, TV and Roku all
  get them): TMDB `/search/tv` by the name without "S43, E31" / "• Live" / "(SNL USA)", an exact
  name match only, its backdrop (w780) else poster, on `game.poster` (GameArt already shows a
  poster first; the Roku's LiveScreen too). Kept a month per name in `watch_order_cache`
  (`show-picture1:`), a miss for a day; four lookups at a time. 26 of 34 found. Without one:
  `static/sports/tv.jpg`, a plain TV set drawn with ffmpeg `drawbox` (a JPG, so the Roku can show it).
- **Wording:** the tab is "Schedule" (was "Games"), "All" (was "All sports"), a TV-shows section
  counts "shows" (`itemWord`), "Nothing called that", "On now" on Channels, the picker is "Pick
  what Live TV shows". Search says "games, shows, teams, channels".
- **Picks made before:** a one-time fix (`live-sports-tv-shows`) adds `tv` to every profile's
  non-empty sports picks, so shows aren't hidden from someone who never saw the choice. An empty
  list (every sport) already includes them.

**"On a slow connection it buffers a lot; a Steam download made Catalog buffer, YouTube didn't" (owner).**
- His stops (installed 3.5.0, Re:Zero S2E21, Showbox 1080p): pieces at 0.4–1.3 Mbps each, three at
  a time, needing 1.9 Mbps. Nothing else of Catalog's was downloading. YouTube copes mostly by
  quietly lowering its quality, which the owner has turned down for Catalog.
- **Measured:** ten big downloads (Hetzner and OVH test files) standing in for Steam, while 7Movies
  pieces were fetched N at a time. Free line: 1 at a time 195 Mbps, 3 at a time 350. Busy line, two
  runs: 1 at a time 5.6 / 15 Mbps, 3: 57 / 20, 6: 57 / 42. Each download only gets its share of a
  busy line, so more at once get more of it (Steam opens many).
- **Change** (`src/lib/fetchAhead.ts`): while the last few pieces each came in at less than 3× the
  speed they play (`aheadNow`, from `PieceNote.seconds` and `ms`), five are fetched ahead instead
  of two. On a free line nothing changes. Only Showbox goes through this loader: 7Movies and Movy
  come through the relay, which already reads six (Movy three) ahead on the computer. **Not yet
  tried on a busy line with Showbox playing** (that uses the owner's Febbox allowance).
