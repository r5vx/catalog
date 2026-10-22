# Handoff — where Catalog stands (2026-10-21)

For starting a new conversation. **New Claude: read this first, then `CLAUDE.md` (the rules)
and `CATALOG_CONTEXT.md` (the hard-won lessons and how every piece works).** This file is a
snapshot plus a map. The long-term memory folder (below) loads by itself and holds one fact per
note.

**Owner, to start a new conversation:** open Claude Code in this folder and say something like
*"Read HANDOFF.md, then …"* followed by what you want. Nothing else is needed.

---

## 1. Where everything is written down

| What | Where | Loaded by itself? |
| --- | --- | --- |
| The rules that must never be broken | `CLAUDE.md` | Yes |
| Every lesson, design reason and how each part works (~1,400 lines) | `CATALOG_CONTEXT.md` | No: read the parts you need |
| One-fact notes: what the owner wants, past bugs, how things work | `C:\Users\BlurA\.claude\projects\C--Users-BlurA-Desktop-catalog\memory\` (index: `MEMORY.md`) | The index, yes |
| What changed in each version | `RELEASE_NOTES.md` (it also ships inside the app) | No |
| Test tools | `scripts/dev/` (see §6) | No |

When something new is learned, put it in the right place: a lesson goes in `CATALOG_CONTEXT.md`
and a memory note. A user-facing change gets bullets under `## Unreleased — <title>` in
`RELEASE_NOTES.md`.

---

## 2. Who uses Catalog

- **The owner:** installed release build on their Windows PC. They update from GitHub Releases.
- **Mom:** her own laptop runs Catalog (main profile = mom). Her **Fire TV** runs the Catalog TV
  app, which shows the laptop's Catalog. The owner lives far away and can't fix things there in
  person.
- **The owner's little brother:** watches on a TV in mom's house, through mom's laptop, with his
  own profile. His Bleach plays from Aniwave.
- **A friend of the owner's** suggested "More like this".
- **Mac users:** they get a DMG built by GitHub Actions. The app isn't signed. A self-updater
  was added in 3.2 but **has never been tried on a real Mac**.

The owner has limited coding experience: explain plainly and don't make them read code. They
like changing the look themselves (colors and fonts are at the top of `src/app.css`).

---

## 3. Current state

**3.3.0 was released 2026-10-20 and verified:**
- `latest.yml` was fetched anonymously and the installer's sha512 matched;
- the Mac build succeeded (DMG, zip and `latest-mac.yml`).

**3.4.0 ("New episodes in Continue Watching") was released 2026-10-22 on the owner's go-ahead.**
The owner tested the 2026-10-22 test build first. Venom 2's subtitles fitted from the first line,
and Dungeon Meshi E5's intro and credits were right. What it brought (details in
`RELEASE_NOTES.md` and `CATALOG_CONTEXT.md`):
- New episodes come back to Continue Watching, marked "New episode". Shows leave only when caught
  up or removed.
- The Showbox fix for Febbox's text folder listings (every show had lost Showbox on 3.3.0).
- Catalog never switches to the English dub by itself.
- Skip Intro/Credits on every source and on the TV, found from the player's own downloads. Anime
  Skip (the owner's client ID, 60 requests a minute) and IntroDB were added beside AniSkip.
- Episode switching fixed: the old episode replayed and progress was saved onto the wrong one. A
  slow source no longer holds an episode up.
- Auto-timing:
  - it needs three agreeing stretches;
  - it puts subtitles back when they stop fitting;
  - cinema-recording subtitles are listed last;
  - it starts listening as soon as the video plays.
- About 15 more kinds of subtitle adverts and credits are filtered.
- OpenSubtitles is left alone for 3 h once it says the day's download limit is reached.
- A background picture, scrambled subtitle files refused, a frozen-picture watch, and the
  full-screen top bar.

**On 2026-10-22 I used up OpenSubtitles' daily download allowance on the owner's home connection.**
I bulk-downloaded about 350 files to look for adverts. The block lifts after about 24 h. Never do
that again (see `CATALOG_CONTEXT.md` → "OpenSubtitles' daily download limit").

The episode-switching bug falsely marked the owner's Dungeon Meshi E6 as 98% watched. They can
untick it (right-click E6 → Mark not watched). Friends' Deadpool freeze on 3.3.0 wasn't
reproduced; ask for their Settings → Playback if it happens again.

Not built (offered before): bulk "watched up to here" on the TV title page, and a page for setting
where you are in many shows. The owner didn't want a separate new-episodes page.

`npm run release` commits everything with `git add -A`: anything changed after a release goes in
with the next one.

What 3.3.0 brought (details in `RELEASE_NOTES.md` and `CATALOG_CONTEXT.md`):

- **More like this** under every title, on the computer and the TV (`src/lib/server/recommendations.ts`):
  - films use MovieLens "loved by the same people" data (`data/film-neighbours.bin`) plus TMDB
    topics, genre, director and series, scored together;
  - anime uses AniList's own recommendations, with one card per show;
  - there's a Show watched switch, Show more, and a right-click menu;
  - results are kept 30 days, and work starts as the page loads.
- **Faster starts:**
  - a title's page starts finding the video 0.5 s after it's known to be watchable;
  - a show's episode link is fetched during the lookup;
  - the packed app now reads Febbox's new player page directly. Before, every Showbox video
    waited 6–8 s on a hidden window, and Primetime took 12 s.
- **Less buffering:**
  - video pieces are fetched ahead, 3 at once;
  - a piece the site doesn't answer is asked for again after 4 s, and 12 s of silence counts as
    hung. One SVU piece had hung for 53 s.
  - The owner **rejected** any fix that slows other things down ("nerfing").
- **Playback stop log** (Settings → Playback) and a **Playback stats** toggle in the player.
- **Updates install by themselves** when nothing has played for 30 min. The TV shows **Reload**
  after an update.
- **Removed:** SubDL (one less key).
- **Caption fixes:** an error page had been cached as Madagascar's captions; another advert is
  filtered out; captions come back on when a film is resumed.
- **Fixed:** "Object has been destroyed" when quitting.

**Not verified on real hardware:**
- whether mom's Fire TV buffers less (ask for a photo of Settings → Playback on her laptop if
  she buffers);
- the Mac self-update;
- the packed app's Febbox reading inside a **signed-in** app (it was tested on the real page,
  but not in the owner's own install).

---

## 4. How the owner wants work done

- **Never release to GitHub until the owner says so.** Pack a test build
  (`npm run pack` → `dist-app\win-unpacked`) for them to try first. When they say go, release.
  They've said this many times, often in capitals.
- **No slowing things down to fix other things.** They called it "nerfing" and had it reverted.
- **No new accounts, logins or keys** for users: no Trakt; SubDL was removed for this reason.
- **Recommendations must not depend on ratings.** Most people don't rate.
- **Answer the current message.** Don't re-list fixes they've already confirmed.
- **Write out ideas or findings in the message before ending the turn.** Twice they got a
  "build 1 and 2?" with no ideas shown.
- **When asked for ideas:** measure first, give them numbered with the safest first, and make a
  recommendation. They like "risk free".
- **Make fixes general**, across every title and code path, not one-off patches.
- **Wording:**
  - American spelling, and "mom" (never "mum");
  - no chatty UI text, and the app never mentions Claude;
  - release notes are one short line each under New / Improved / Fixed, grouped by area, with a
    title on `## Unreleased — <title>`.
- Site-integration work (new video sources like Movy) needed **manual permission mode**; auto
  mode refused it.

---

## 5. Things that must never happen (from CLAUDE.md, with why)

- **Never force-close `Catalog.exe`.** It has corrupted the library. Ask the owner to close it.
  `taskkill` without `/F` is a normal close, and is OK only for a *test* copy you started.
- **Never point a test at the live library** (`%APPDATA%\Catalog\library.db`). Copy it and test
  on a port other than 4173/5173. The `scripts/dev` tools refuse the live path.
- **Never leave a second Catalog installed or running.** Delete `dist-app` after testing.
- **Never export the `settings` table** (TMDB key).
- **Febbox rate limit:** never loop lookups over many titles. Bursts of folder listings get a
  Cloudflare 429 that lasts 10–20 minutes and hits the owner's real app too. All listings go
  through the gate in `febboxList.ts`.

---

## 6. How to test

**Dev server** (`.claude/launch.json` → `catalog-test`, port 5199):
- Its `CATALOG_DB` points at an *old* session's copy. Make a fresh copy of the live library
  (with Catalog closed) into your own scratchpad, and point `CATALOG_DB` there.
- Restore the file with `git checkout -- .claude/launch.json` before any release, because the
  release commits everything.
- Stop the dev server before `npm run pack` or a release: packing crashes Vite's file watcher.

**The desktop-only parts can't run on the dev server:**
- Movy, the Febbox hidden window, and `electron/main.cjs`.
- Run them with `npm run build`, then `electron .` with `CATALOG_PORT=5299`, `CATALOG_DB=<copy>`
  and `--user-data-dir=<scratch folder>`.
- That test copy isn't signed in to Febbox, so its link lookups fall back to the saved key.

**Browser pane quirks:**
- when it's hidden, there are no focus events and no animation frames;
- check with `get_page_text` / JavaScript rather than screenshots.

**Tools** (`scripts/dev/`, never packaged):
- `evalrecs.mjs`: More like this for a list of titles. Judge by a broad spread, never one title.
- `availtime.mjs`: how long each source's Watch check takes.
- `tvsim.mjs`: pulls video pieces through the relay one by one, like a TV. 20x faster than real
  time or better is healthy.
- `cold.mjs`: whole-piece timing, to tell a slow site from a slow relay.
- `pagetest.cjs`: runs the desktop app's Febbox page reader on the real page.
- `tmdbsearch.mjs`: TMDB ids for a name.

**Shell gotcha:** backslashes in shell heredocs get mangled (`\\b` became a backspace character
and broke a file). Write code with the file tools, not `python - <<EOF` or `node -e`, whenever it
contains backslashes. Many files use CRLF line endings.

---

## 7. How to release (only when the owner says so)

1. Stop the dev server. Restore `.claude/launch.json`. Make sure no `dist-app` Catalog is
   running, then delete `dist-app`.
2. Check that `RELEASE_NOTES.md` has `## Unreleased — <title>` with bullets.
3. Run `npm run release -- minor` (or `patch`). It builds into `dist-release`, then commits,
   tags, pushes and uploads.
4. **Verify:**
   - fetch `https://github.com/r5vx/catalog/releases/latest/download/latest.yml` anonymously;
   - download the file it names and compare the sha512;
   - check the Mac workflow through `api.github.com/repos/r5vx/catalog/actions/runs` (`gh`
     isn't installed) and confirm the DMG, zip and `latest-mac.yml` are on the release.

Anything less has shipped broken before.

---

## 8. Open ideas and loose ends (offered, not built)

**Starting videos sooner:**
- remember "not available" for 3 days on titles over a year old, with a Check again button;
- a night-time warm-up of Continue Watching;
- cutting 7Movies' slow "no" short: **advised against**, because it would hide real copies.

**More like this:**
- work out recommendations in the background for Continue Watching and the watchlist;
- ask TMDB 16 at a time instead of 8;
- TV-show picks are weaker than films, because no free "what people watch" data exists for
  shows. Wicked is so-so.

**Other:**
- Re:Zero English-dub captions: transcribe the dub on the laptop (Whisper). Offered, not built.
- The brother's Roku can't run the TV app. A Roku channel was offered, not built.
- If Febbox changes its player page again, **both** readers need fixing: `fromSourcesList` in
  `src/lib/server/showbox.ts` **and** in `electron/main.cjs`. Missing the second cost every
  Showbox start 6–8 s.

**When buffering is reported:** read the stop log first (`/api/diagnostics` → `playbackStops`,
or Settings → Playback), then change things.
