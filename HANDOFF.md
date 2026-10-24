# Handoff — where Catalog stands (2026-10-23, after 3.4.2)

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
| Every lesson, design reason and how each part works (~1,600 lines) | `CATALOG_CONTEXT.md` | No: search it for the part you need |
| One-fact notes: what the owner wants, past bugs, how things work | `C:\Users\BlurA\.claude\projects\C--Users-BlurA-Desktop-catalog\memory\` (index: `MEMORY.md`) | The index, yes |
| What changed in each version | `RELEASE_NOTES.md` (it also ships inside the app) | No |
| Test tools | `scripts/dev/` (see §6) | No |

When something new is learned, put it in the right place:
- **A lesson:** in `CATALOG_CONTEXT.md` and a memory note.
- **A user-facing change:** bullets under `## Unreleased — <title>` in `RELEASE_NOTES.md`.
- **What changed in the current state:** in this file.

---

## 2. Who uses Catalog

- **The owner:** an installed release build on their Windows PC. They update from GitHub
  Releases. They test each new build before it's released.
- **Mom:** her own laptop runs Catalog (main profile = mom). Her **Fire TV** runs the Catalog TV
  app, which shows the laptop's Catalog. She mostly watches Law & Order: SVU and Criminal Minds.
  - **Her laptop's Catalog is installed "for all users".** So every update asks Windows for
    permission, and night installs are skipped.
  - **3.4.2 adds the fix:** Settings → Updates → **Move to just my account** (see §3).
  - The owner lives far away and can't fix things there in person.
- **The owner's little brother:** watches on a TV in mom's house, through mom's laptop, with his
  own profile. His Bleach plays from Aniwave.
- **Friends:** on the GitHub releases, each with their own Febbox account. They report bugs
  through the owner, for example Venom 2's and Deadpool 2's subtitles, and a wrong Febbox
  password that still showed "Logged in".
- **Mac users:** they get a DMG built by GitHub Actions. The app isn't signed. The self-updater
  **has never been tried on a real Mac**.

The owner has limited coding experience: explain plainly and don't make them read code. They
like changing the look themselves (colors and fonts are at the top of `src/app.css`).

---

## 3. Current state

**3.5.0 ("Rate it, mini player, and fewer stops") was released 2026-10-23, late at night, on the
owner's go-ahead** (verification is in the release's own section of this file's history, and below
once done). Everything up to 3.5.0 is committed and tagged. It brought:
- E8-style plain-MP4 Showbox files with sound and length (`crossorigin`, and `main.cjs` replacing
  the CORS header, not doubling it).
- The fetched-ahead piece that failed and hung its track (`fetchAhead.ts`).
- The biggest copy of the wanted quality picked (`pickFile`, `bytesOf`), and the Showbox copy
  picked by hand kept per show.
- Continue Watching "Up next" at 95%; hand-ticked episodes moving on; picked episodes never
  jumping on (`mayMoveOn`).
- The computer's mini player as its own window (`miniPlayer.cjs`).
- Quick rating, status, favourite, times and season/episode dropdowns on a title's page
  (`QuickEdit`); "Rate it" after finishing; "More details" saving only its own fields.
- The library no longer filtering itself on hover; Febbox account switches forgetting the old
  account; local dates.
Details: `CATALOG_CONTEXT.md`, from "Owner's and a friend's reports, 2026-10-23 evening" on.

**Last buffering check before it (2026-10-23 night), desktop build:** SVU on 7Movies and Movy, and
Dungeon Meshi on Aniwave, had no stops in 90 s, with 185–520 s loaded ahead; jumps took under 1 s.
The Marvels on 7Movies stuck at 1:00:30. That one piece trickles from 7Movies' own server
(edge.reelvault.click, about 1.8 of 5.6 MB in 40 s, fetched directly, twice), while its neighbours
came at 47–2,400 Mbps. The relay holds a piece until it's whole, and the player gives up on a piece
with no first byte in 5 s, so it retried the same piece until the stall watch gave up. **Offered, not
built:** after a piece stays stuck, play the same spot from the title's other copy (7Movies Orion,
Movy), or step past the piece.

**Open:** a friend's mini player froze while the sound went on. The pause-button idea turned out
unlikely (there was no such button), so ask what was happening when it froze. Also, cleaning up
old recovery files in `%APPDATA%\Catalog` was declined; don't offer it again.

### What the last four releases brought (details in `RELEASE_NOTES.md`)

**3.4.2 (2026-10-23):**
- **"Move to just my account"** (Settings → Updates, `electron/moveInstall.cjs`). Shown only on
  an all-users install. In order:
  1. it downloads the latest installer and checks it against latest.yml's sha512;
  2. Catalog quits, and a hidden PowerShell helper waits for every Catalog process from the old
     folder to exit (it never force-closes);
  3. one Windows prompt removes the old copy with its own uninstaller (`/S /KEEP_APP_DATA
     /allusers`) and adds a firewall rule for the new exe, so the TVs can still connect;
  4. only if the old exe is really gone, it installs with `/S /currentuser` and starts the new
     copy.

  Saying no to the prompt changes nothing. Every step goes to `%APPDATA%\Catalog\update.log` as
  "move: …". **It was only dry-run tested, and mom's laptop is its first real use.**
- A source that can't play the episode shows a passing message, not a red line that never goes.
- The stream info describes the copy that's playing.
- For an episode with no Showbox copy, the 7Movies and Movy links are fetched when Watch is
  pointed at.

**3.4.1 (2026-10-22):**
- Endings and intros with story over the song (AniSkip `mixed-ed`, Anime Skip "Mixed Credits",
  or 3+ dialogue lines in the subtitles) are never auto-skipped. The TV waits for the end of them.
- Febbox's daily 10 GB "high-speed flow" limit is detected from febbox.com/console and explained.
  The player then goes straight to another HD source until it resets.
- OpenSubtitles downloads fall back to Stremio's copy (`subs5.strem.io`, same file number) when
  OpenSubtitles says the connection's daily limit is "exceeded".
- While another episode loads, the old one is hidden and can't be played (`oldPicture`). A source
  picked mid-load takes over.
- 7Movies and Movy episodes are listed only from 06:00 UTC the day after their US air date
  (`hasAired`).
- A wrong Febbox password is refused (`isSignedIn` asks /console before saving).
- Films only in cinemas show **"In cinemas"** and no source is searched (`metadata/cinemas.ts`,
  TMDB release-date kinds).
- Subtitles made for the playing cut go first (`lastAt` from OpenSubtitles' `SubLastTS`; Deadpool
  2's cinema version and Super Duper Cut).
- "Show details" on the "Keeps stopping to load" prompt, for a photo of what's slow (TV too).

**3.4.0 (2026-10-22):**
- New episodes come back to Continue Watching, marked "New episode".
- Showbox's text-field fix.
- Catalog never switches to the dub by itself.
- Skip Intro/Credits on every source, and on the TV, from AniSkip, Anime Skip, IntroDB and
  Catalog's own sound comparison.
- Episode switching fixes.
- Auto-timing safety: 3 agreeing stretches, revert, and cinema-recording subtitles listed last.
- About 15 more subtitle adverts filtered.
- A background picture.

**3.3.0 (2026-10-20):**
- More like this.
- Faster starts.
- Fetch-ahead and asking again for hung pieces.
- The playback stop log, and updates installing by themselves.

### Waiting on someone

- **Mom's "Move to just my account":** the first real run. If it fails, ask the owner for her
  `update.log`.
- **Mom's constant buffering** (Homeland S8, SVU), not reproduced. Next time she should press
  **Show details** on the buffering prompt and send a photo, or send Settings → Playback.
- **Friends' Deadpool desync and freeze on 3.3.0:** not reproduced. The frozen-picture watch is in
  place.
- **The owner's Dungeon Meshi E6** was falsely marked 98% watched by a bug that's now fixed. They
  can untick it (right-click → Mark not watched).

### Mistakes of mine to not repeat (2026-10-22)

- **I bulk-downloaded about 350 subtitles** to look for adverts. That used up OpenSubtitles'
  daily allowance for the owner's home internet for about 24 h. Survey from `saved_subtitles` in
  a library copy, or a handful of downloads at most.
- **Test playback through the test server signs in to Febbox as the owner.** Streaming several
  1080p episodes ate into their 10 GB a day, and every title went to 360p. Test with API calls,
  not playing video, where you can.

---

## 4. How the owner wants work done

- **Never release to GitHub until the owner says so.** Pack a test build
  (`npm run pack` → `dist-app\win-unpacked`) for them to try first, and tell them to close their
  installed Catalog before opening it. When they say go, release.
- **No slowing things down to fix other things.** They called it "nerfing" and had it reverted.
- **No new accounts, logins or keys** for users: no Trakt; SubDL was removed for this reason.
- **Recommendations must not depend on ratings.** Most people don't rate.
- **Answer the current message.** Don't re-list fixes they've already confirmed.
- **Write out ideas or findings in the message before ending the turn.**
- **When asked for ideas:** measure first, give them numbered with the safest first, and make a
  recommendation. They like "risk free".
- **Make fixes general**, across every title and code path, not one-off patches.
- **Reproduce before fixing**, and say plainly what's proven and what isn't.
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
- **Never point a test at the live library** (`%APPDATA%\Catalog\library.db`). Copy it (with
  Catalog closed) and test on a port other than 4173/5173. The `scripts/dev` tools refuse the
  live path.
- **Never leave a second Catalog installed or running.** Delete `dist-app` after testing. Any
  installer flow must never be able to leave two installs: "only for me" doesn't remove an "all
  users" copy (see `moveInstall.cjs`).
- **Never export the `settings` table** (TMDB key, Febbox sign-in).
- **Febbox rate limit:** never loop lookups over many titles. Bursts of folder listings get a
  Cloudflare 429 that lasts 10–20 minutes and hits the owner's real app too. All listings go
  through the gate in `febboxList.ts`.
- **Never bulk-download from a third-party site** (see §3). Any loop that fetches needs a budget
  first.

---

## 6. How to test

**Dev server** (`.claude/launch.json` → `catalog-test`, port 5199):
- Its committed `CATALOG_DB` points at an *old* session's copy. Make a fresh copy of the live
  library (with Catalog closed) into your own scratchpad, and point `CATALOG_DB` there.
- Restore the file with `git checkout -- .claude/launch.json` before any release, because the
  release commits everything.
- Stop the dev server before `npm run pack` or a release: packing crashes Vite's file watcher.
- It listens on `localhost` (not 127.0.0.1) for Node's fetch. Showbox there is often 360p.

**The desktop-only parts can't run on the dev server:**
- Movy, the Febbox hidden window, `electron/main.cjs` and `moveInstall.cjs`.
- Run them with `npm run build`, then
  `CATALOG_PORT=5299 CATALOG_DB=<copy> npx electron . --user-data-dir=<scratch folder>`, in the
  background. Its pages open in the browser pane at `http://127.0.0.1:5299`.
- Close it with `taskkill /PID <its main electron.exe>`, never `/F`.
- The owner's own running Catalog (port 4173) answers read-only questions too:
  `/api/diagnostics`, `/api/watch/debug?fid=&share_key=`, `/api/watch/skip-times`.

**Player tricks:**
- Slow a lookup on purpose by wrapping `window.fetch` for `/api/watch/stream`, to test anything
  that happens "while loading".
- Compare two episodes by drawing the video to a 32×18 canvas at the same times.
- `window.subSync` (dev builds only) shows auto-timing's plan and how much it has heard.

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
- `tmdbsearch.mjs <copy of library.db> <name>`: TMDB ids for a name.

**Shell gotcha:**
- Backslashes in shell heredocs and `node -e` get mangled: `\\b` became a backspace character,
  and `\d` became `d`.
- Write code that contains backslashes with the file tools (Edit/Write), or as a script file.
- Many files use CRLF line endings.

---

## 7. How to release (only when the owner says so)

1. Stop the dev server and any test desktop app. Restore `.claude/launch.json`. Make sure no
   `dist-app` Catalog is running, then delete `dist-app`.
2. Check that `RELEASE_NOTES.md` has `## Unreleased — <title>` with bullets. Update §3 here.
3. Run `npm run release -- patch` (or `minor`). It builds into `dist-release`, then commits
   (`git add -A`), tags, pushes and uploads. Run it in the background; it takes a few minutes.
4. **Verify:**
   - fetch `https://github.com/r5vx/catalog/releases/latest/download/latest.yml` anonymously;
   - download the file it names and compare the sha512;
   - check the Mac workflow through `api.github.com/repos/r5vx/catalog/actions/runs` (`gh`
     isn't installed) and confirm the DMG, zip and `latest-mac.yml` are on the release.

Anything less has shipped broken before.

---

## 8. Open ideas and loose ends (offered, not built)

**Sources and playback:**
- **Movy is slow** for an episode that's only on its later server (SVU S28E3 took about 20 s;
  E2 took 1 s). The warm-up only helps when Watch is pointed at first.
- **Movy's newest episodes come in 720p only** at first. Nothing to pick.
- **Re:Zero on Aniwave is 720p.** Aniwave's other two servers (BYFMS, DGHG) are players Catalog
  doesn't read. 7Movies and Movy don't have Re:Zero.
- **If Febbox changes its player page again, both readers need fixing:** `fromSourcesList` in
  `src/lib/server/showbox.ts` **and** in `electron/main.cjs`.
- **Starting sooner:** remember "not available" for 3 days on titles over a year old; a
  night-time warm-up of Continue Watching.

**Subtitles:**
- **Auto-timing is mostly Silero time now:** about 2.4 s per 4½ minutes heard. Running 8 parts at
  once only reached 1.7 s, and changed 1–2% of frames, so it was not kept.
- **"Once Upon a Deadpool"** (a re-edit) still lists near Deadpool 2's cinema version: similar
  length.
- **Re:Zero English-dub captions:** transcribe the dub on the laptop (Whisper).

**Other:**
- **Browse's "trending" row** shows films in cinemas (Clayface). They now say "In cinemas";
  hiding them from Browse was offered, not done.
- **More like this:** background work for Continue Watching; TV-show picks are weaker than
  films'.
- **The brother's Roku** can't run the TV app. A Roku channel was offered, not built.

**When buffering is reported:** read the stop log first (`/api/diagnostics` → `playbackStops`,
Settings → Playback, or a photo of **Show details**), then change things.
