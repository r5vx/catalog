# Catalog

A personal library of everything you've watched. Runs on your own PC.

## Installing it

Download **Catalog-Setup.exe** from the
[latest release](https://github.com/r5vx/catalog/releases/latest) and run it.

Windows will say the publisher is unknown, because the installer isn't signed —
a certificate costs a few hundred a year and this is a personal project. Click
**More info**, then **Run anyway**.

After that it's a normal app: a shortcut on your desktop, no browser, no
terminal. It checks for a new version each time it opens and updates itself
quietly in the background.

Your library is yours alone. It lives in a file on your own PC, nothing is
uploaded anywhere, and there is no account to make.

## Opening it

Double-click **Catalog** on your desktop. That's it.

To work on the code instead, `npm run dev` and open <http://localhost:5173>.
Both use the same library, so it doesn't matter which one you add things in.

## Turning on movie and TV search

Anime works out of the box. Movies and TV need a free TMDB key:

1. Sign up at <https://www.themoviedb.org>
2. Settings → API → request an API key (choose personal use)
3. In Catalog, click the **⚙** button → paste it under **Movie and TV search**

That page shows you **two** credentials and doesn't explain the difference.
**Either one works** — paste whichever you have:

- **API Key** — 32 letters and numbers
- **API Read Access Token** — much longer, starts with `eyJ`

It's checked against TMDB before saving, so a typo or a stray space gets caught
immediately. It's stored in your library file, in a table that every export and
backup deliberately skips — so it never ends up on GitHub.

## Adding things

- **Search** — type a title, it fills in poster, year, episode count and
  category automatically. Anime lands in Anime, films in Movies. The dropdown
  beside each result overrides the guess; it's outlined when the guess is shaky.
- **Import a list** — paste a whole Notes list, one title per line. Bullets and
  numbering are cleaned up. Every match is shown for you to check before
  anything saves, and re-importing won't create duplicates.
- **Manual add** — for anything the databases don't have.

**Only the title is ever required.** Rating, dates, rewatches and notes are all
optional. Search-adds assume you watched it today; bulk imports leave the date
empty on purpose.

## Getting your list out

Settings → **Export**. Pick a category and a status, then choose a shape:

| | |
| --- | --- |
| **Printable / PDF** | a clean page — print it and choose "Save as PDF" |
| **Spreadsheet** | a CSV for Excel, Numbers or Google Sheets |
| **Plain list** | numbered text, grouped by category |
| **Full backup** | everything, in one file `npm run restore` can read back |

The filters apply to the first three. The full backup ignores them on purpose:
restoring a filtered one would quietly delete everything it left out.

## Using it on your phone

Your PC has to be awake — the app is running *on it*.

**One-time setup:**

1. Tailscale is already installed on the PC. Open it and sign in (any Google or
   Microsoft account works, it's free).
2. Install Tailscale on your iPhone from the App Store and sign in with the
   **same account**.
3. On the PC, the Tailscale menu shows this machine's address — something like
   `100.x.y.z`.

**Then, on your phone:**

1. Make sure Catalog is open on the PC.
2. In Safari, go to `http://100.x.y.z:4173` (use `:5173` if you're running
   `npm run dev` instead).
3. Share button → **Add to Home Screen**. You get the pink circle icon and it
   opens without any browser chrome.

Tailscale is an encrypted link between only your own devices — nothing is
exposed to the public internet and there's no router setup.

**Worth knowing:** the app also answers on your home wifi, so anyone on your
network could open it. If that bothers you, set a **PIN lock** in Settings.

## Backups

Set up and running already. Every night at 3am, and any time you run
`npm run backup`:

| Layer | What | Where |
| --- | --- | --- |
| Readable export | `library.json` | `%APPDATA%\Catalog\backups\` |
| Fast restore | last 14 database copies | `backups\snapshots\` |
| Offsite | git push | needs the step below |

**Restoring** — `npm run restore` previews what's in the backup and changes
nothing; `npm run restore -- --write` rebuilds your library from it. Your
current library is moved aside first, never deleted. This has been tested end to
end, not just written.

### Turning on the offsite copy

The backups folder is already a git repo with one commit in it. You just need
somewhere to push it:

1. Make a **private** repo on GitHub called `catalog-backups` — no README, no
   .gitignore, empty.
2. Run these two commands, with your username in place of `YOU`:

```bash
git -C "$APPDATA/Catalog/backups" remote add origin https://github.com/YOU/catalog-backups.git
git -C "$APPDATA/Catalog/backups" push -u origin main
```

After that the nightly backup pushes on its own. Only `library.json` goes up —
the database snapshots are gitignored because binary files bloat a repo and
can't be read back by hand.

A private repo is private, not secret. That's fine for a watch history; just
don't put anything in your notes you'd mind GitHub holding.

## Releasing a new version

Double-click **Release Catalog.bat**, or run `npm run release`. It bumps the
version, builds an installer, commits, tags, pushes, and uploads the release.
Everyone who has Catalog installed gets it the next time they open the app.

```
npm run release              1.0.0 -> 1.0.1
npm run release -- minor     1.0.0 -> 1.1.0
npm run release -- major     1.0.0 -> 2.0.0
```

Publishing needs a GitHub token in a `.env` file at the project root:

```
GH_TOKEN=github_pat_...
```

Make one at <https://github.com/settings/tokens> with permission to write
repository contents. `.env` is gitignored, so it never leaves this PC. Without a
token the installer is still built and the script tells you which two files to
upload by hand — the `.exe` **and** `latest.yml`. The `.yml` is what tells an
installed Catalog that a new version exists; a release without it updates
nobody.

## Checking what the app is doing

If something looks wrong — a key that won't save, a PIN that won't stick — open
<http://127.0.0.1:4173/api/diagnostics> while Catalog is running. It says which
files the app is reading and writing, and whether a key and PIN are stored. It
reports paths and yes/no answers only, never the key or the PIN itself, and it
works even when the PIN lock is misbehaving.

## Where everything is

| What | Where |
| --- | --- |
| **Your library** | `%APPDATA%\Catalog\library.db` |
| **The look of the app** | `src/app.css` — every colour and font is a variable at the top |
| **The app icon** | `scripts/make-icon.mjs` — change `PINK`, run `npm run icon` |
| **The library page** | `src/routes/+page.svelte` and `+page.server.ts` |
| **Search and adding** | `src/routes/entry/new/+page.svelte` |
| **Bulk import** | `src/routes/import/+page.svelte` |
| **Settings** | `src/routes/settings/+page.svelte` |
| **Where titles come from** | `src/lib/server/metadata/` — AniList and TMDB |
| **Every database query** | `src/lib/server/db/queries.ts`, as plain SQL |
| **Statuses and sort options** | `src/lib/constants.ts` |
| **The PIN lock** | `src/hooks.server.ts` |

## Commands

```
npm run dev        work on it, with live reload
npm run app        run the desktop app from source
npm run pack       rebuild the desktop app in dist-app/win-unpacked
npm run icon       redraw the app icon
npm run refresh    check your series for episodes you haven't seen
npm run backfill   fill in public ratings for older entries
npm run release    build and publish a new version for everyone
npm run backup     back up right now
npm run restore    preview a restore (add -- --write to actually do it)
npm run check      check for type errors
```

After `npm run pack`, your desktop shortcut points at the rebuilt app
automatically.

## Things to know

- **No database to install.** SQLite is built into Node, so there is nothing to
  compile, ever. The only runtime dependency in the whole project is
  `electron-updater`, and it exists solely so installed copies can update
  themselves.
- **Categories aren't hardcoded.** Movies, TV Shows and Anime are rows in the
  `categories` table. Add "Games" or "Books" and the tabs, filters and dropdowns
  all pick it up with no code changes.
- **Filters live in the URL**, so any view is a link you can bookmark.
- **`npm run installer`** builds a Windows installer, but needs Developer Mode
  on (Settings → System → For developers). The app works fine without it.
- **To stop the nightly backup:** Task Scheduler → delete "Catalog Backup".

## Where this is going

1. ~~Skeleton and database~~ ✅
2. ~~Metadata search and import~~ ✅
3. ~~Your own fields~~ ✅
4. ~~Search, sort, filter~~ ✅
5. ~~Phone access~~ ✅ — sign in to Tailscale to finish
6. ~~Move your Notes lists in~~ ✅
7. *(dropped — no password vault)*
8. ~~Backups~~ ✅ — add a GitHub remote to finish the offsite layer
