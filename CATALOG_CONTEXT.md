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
| **Zero runtime dependencies** | `dependencies` in package.json is empty, deliberately |

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

### Settings page order
Colour, Export, Movie and TV search, PIN lock, Updates, Your files — most-used
first, set-once things after. A row of jump-link chips under the heading covers
the scrolling. Section ids (`#colour`, `#export`, …) are what the chips target.

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

## Sharing it with other people — open, 2026-09-15

The user wants friends to be able to install Catalog and **keep getting updates**
as it changes. Nothing has been built for this yet. What's already true:

- The project is **not a git repository** — `git init` is step one.
- **No secrets are in the source.** The TMDB key and PIN hash live in the
  `settings` table inside `%APPDATA%\Catalog\library.db`, and `.env` is ignored.
  A public repo is therefore safe.
- The database path is **per Windows user**, so a friend gets their own empty
  library automatically. Nothing to change there.
- The current updater (`Update Catalog.bat` → `npm run pack`) rebuilds **from a
  source checkout**. A friend who installs an .exe has no source, no
  `node_modules` and no npm, so it cannot work for them. They need
  `electron-updater` against GitHub Releases instead — which means the first
  real entry in `dependencies`, currently deliberately empty.
- `scripts/backup.mjs` pushes to `r5vx/catalog-backups`, which is **the user's**
  repo. Friends can't use it. For them, Settings → Export → full backup is the
  substitute.
- Each friend needs **their own free TMDB key**. Bundling the user's key into a
  public repo would get it scraped and disabled. Settings already handles this;
  a first-run screen would make it obvious.

## Working style the user wants

- **Don't over-explain in the UI.** They called the chatty copy out; it was cut.
- **Answer the current message**, not things from several messages ago.
- They have limited coding experience and depend on me to write it, but want to
  be able to change the UI themselves — readability beats cleverness.
- Styling tokens all live at the top of `src/app.css`.
- Every database query is plain SQL in `src/lib/server/db/queries.ts`.
