# Handoff: where Catalog stands (2026-10-26, 3.6.0 released, test build of the next round)

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
| Every lesson, design reason and how each part works (~2,100 lines) | `CATALOG_CONTEXT.md` | No: search it for the part you need |
| One-fact notes: what the owner wants, past bugs, how things work | `C:\Users\BlurA\.claude\projects\C--Users-BlurA-Desktop-catalog\memory\` (index: `MEMORY.md`) | The index, yes |
| What changed in each version | `RELEASE_NOTES.md` (it also ships inside the app) | No |
| The Roku app: how it works, how to install it | `roku/README.md` | No |
| The Fire TV app | `android/README.md` | No |
| Test tools | `scripts/dev/` (see §6) | No |

When something new is learned, put it in the right place:
- **A lesson:** in `CATALOG_CONTEXT.md` and a memory note.
- **A user-facing change:** bullets under `## Unreleased — <title>` in `RELEASE_NOTES.md`.
- **What changed in the current state:** in this file.

---

## 2. Who uses Catalog

- **The owner:** an installed release build on their Windows PC. They update from GitHub
  Releases. They test each new build (from `dist-app`) before it's released.
- **Mom:** her own laptop runs Catalog (main profile = mom). It serves **four or more TVs** in her
  house through the **Fire TV** app, so one Febbox account's 10 GB a day runs out; that's why more
  accounts were added (§3). She mostly watches Law & Order: SVU and Criminal Minds. Her install
  was "for all users"; 3.4.2 added Settings → Updates → **Move to just my account**, whose first
  real run is hers. The owner lives far away and can't fix things there in person.
- **The owner's little brother:** watches on a TV in mom's house, through mom's laptop, with his
  own profile. His Bleach plays from Aniwave. A **Roku** TV in the family is why the Roku app
  exists.
- **Friends:** on the GitHub releases, each with their own Febbox account. They report bugs
  through the owner.
- **Mac users:** they get a DMG built by GitHub Actions. The app isn't signed. The self-updater
  **has never been tried on a real Mac**.

The owner has limited coding experience: explain plainly and don't make them read code. They
like changing the look themselves (colors and fonts are at the top of `src/app.css`).

---

## 3. Current state

**Released: 3.6.0 ("Live TV and replays, more Showbox accounts, and Roku"), 2026-10-25 late
night, on the owner's go-ahead** (before it, 3.5.0 on 2026-10-23). The owner hadn't tried the
last round in a packed build before saying release (SVU stutter mend, seam reload, auto-timing
noise, TV shows, busy-line fetch-ahead). Every change since 3.5.0 is in `CATALOG_CONTEXT.md`
from "After 3.5.0" to the end, round by round. What's in it:

**Live TV** (`sources/daddylive.ts`, `src/lib/live.ts`, `/live`, `/tv/live`, `/api/live/*`). Only
while the desktop app runs (it reads each channel in a hidden window).
- DaddyLive's ~900 channels and its schedule of games by sport. Plays in Catalog's own player
  (`/watch?live=`), with the game's other channels, LIVE / Go live, and the channel's own captions.
- **Pictures:** both teams' logos on their colors from ESPN's free team lists (`teamArt.ts`,
  `GameArt.svelte`), else a photo of the sport (`static/sports/`, Wikimedia Commons). **No emoji in
  Catalog, ever** (the owner's rule).
- **Live scores** from ESPN scoreboards (`liveScores.ts`), refreshed every minute; ESPN's state
  decides "On now".
- **Per profile** (`live_saved` table): saved games/channels, sports picked the first time Live TV
  opens ("+" changes them), favorite teams (Your teams), Recently watched (replays + channels).
- **Shown in your country only** by default (`liveLocal.ts`: Where to watch's country's channels or
  leagues); an "Other countries" chip shows the rest; Channels starts filtered the same way.
- **One click** plays a game on its best channel, learned from what played well
  (`liveChannelPicks.ts`). TV: OK plays, the menu button opens the channel box. Roku: OK plays, * opens it.
- **Kept ready:** the schedule, logos, scores and replays answer from the last copy and refresh in
  the background (`hooks.server.ts` warms them 5 s after start and every 10 minutes). Opening is
  ~0.01 s.
- Live captions arrive 0–8 s late (typed live); auto-timing can't fix that (measured). The delay set
  by hand is remembered per device.

**TV shows on Live TV:** the schedule's TV Shows (Jeopardy!, Family Feud, SNL) are their own kind
(`tv`, "TV shows"), with each show's TMDB picture (`showArt.ts`) or a plain TV picture; the tab
is "Schedule". Added once to profiles that had picked their sports.

**Replays** (`sources/replays.ts`, `replayAnswer.ts`, `/watch?replay=`):
- NFL-Video / Basketball-Video (ok.ru and Dailymotion copies) and SoccerFull.
- Every version is tried; only playable ones are listed, named "Full game · Dailymotion" or
  "Condensed, 44 min · ok.ru" (condensed by sport). The full game is picked first.
- A replay with nothing playable is hidden for an hour. The newest are checked in the background.
- **Dailymotion's first playlist refuses Node's fetch** (403), so the relay asks it through the
  app's browser (`electronFetch`, `BROWSER_ONLY` in the relay).
- **Places are kept** (`watch_progress` type "replay"): they show in Continue Watching and resume,
  on the computer, TV and Roku.
- Uploads often start mid-sentence: that's the uploader's recording (the player starts at 0:00).

**Player:**
- **Downloads ahead:** 7Movies (both copies, HEVC too) and Movy episodes go onto the computer as
  they play, plus the next one (`episodeDownloads.ts`, Settings → Storage limit, 20 GB).
- **7Movies HEVC freezes and stutter fixed:** each piece's keyframe has the wrong time (on top of a
  "leading" frame shown before it), so the browser sometimes dropped 2.4 s of picture, and frames
  showed out of order. The relay moves the keyframe into its right slot (`pieceRepair.ts`;
  checked against the video's own frame numbers, 2026-10-25 late night: the first mend moved the
  wrong frame and made a visible stutter every 6 s). Piece addresses carry `&mend=2`.
  `mendPictureSeam` reloads the picture where a part loaded after a jump meets an older one (the
  browser drops leading frames at the start of a run). A hole of 3 s or less in any copy is
  stepped over (`stepOverPictureHole`).
- **Busy connection:** while Showbox pieces come in slowly (another big download on the line),
  five are fetched ahead instead of two (`fetchAhead.ts`; measured: more downloads at once get a
  bigger share of a busy line). Not tried yet on a busy line with Showbox playing.
- **Auto-timing:** a lone stretch ≥0.4 s off two agreeing neighbours is dropped (SVU S28E3 went
  9 → 8.5 → 9 within a minute). TV copies with longer ad breaks step by ~1.5 s at each break; that's right.
- **Stop log rebuilt** (Settings → Playback, `/api/diagnostics` → `playbackStops`): each stop is kept
  with how long it lasted, the piece waited on, frames dropped, holes, the 30 s before, and
  "Went back N s by itself". Switches no longer count.
- **Auto-timing:** a stretch-agreement fallback for films with quiet talking (Hurt Locker), and
  once the timing has fitted for 15 minutes it is never undone.
- **Mini player:** every control (volume, subtitles, timing, settings, source picker).
- **Rate it** shows after leaving the player (bottom right of the next page), not during the film.
- Back from live or a replay goes to Live TV. Replays open on a loading screen.

**Other:**
- More Febbox accounts (`febboxAccounts.ts`; never tried with a real second account).
- **Roku app** (`roku/`, `npm run roku` → zip, also served at `/catalog-roku.zip`; guide:
  `Catalog Roku setup.pdf` in the owner's Downloads). Same rows, pictures, Live TV, scores,
  replays and places as the Fire TV. **Never run on a real Roku**: checked with BrighterScript
  only.
- TV: Back closes an open menu first; auto-timing from plain AAC (untested on a real Fire TV).

**Before any release:** run `npm run roku` if `roku/` changed (`static/catalog-roku.zip` ships
with it), `.claude/launch.json` must be the committed version, and `dist-app` deleted.

### Next round (2026-10-26, packed in `dist-app`, not released)

Under `## Unreleased` in `RELEASE_NOTES.md`; details in `CATALOG_CONTEXT.md` "After 3.6.0":
- Showbox links: Febbox asked directly after 3 s alongside the hidden window (Penguins 23.6 s → 3.6 s).
- A show keeps its source: another source only after the picked one fails or 15 s (Re:Zero on Aniwave).
- Live TV: a game not on yet shows its start time and waits; listings kept on disk and fetched
  through the app's browser when plain fetch fails; two channel reads at once no longer clash.
- Auto-skip skips recaps; TV Up from the progress bar goes to Skip Intro/Recap/Next Episode.
- Films in cinemas can be watched, with a warning under Watch.
- **Downloads** (films, episodes, replays; never Showbox; 720p+): a dialog picks quality and
  captions; Downloads page, play offline with auto-timing, save to a phone. Not tried on a real
  iPhone. Details in CATALOG_CONTEXT.md "Downloads".
- **Statuses Rewatching and Caught up**, set by the player too (see CATALOG_CONTEXT.md).

### Waiting on someone

- **The friend with 0 games and 0 channels:** the exact error text (a photo), and
  `/api/diagnostics` → `liveTv` from his computer once he has the next build.

- **The owner's use of 3.6.0:** SVU on 7Movies HEVC (smooth, no skip after jumps), auto-timing on
  SVU, Live TV's TV shows, and Showbox while another download runs (that change is untested
  with Showbox playing).
- **A real Roku:** the owner installs it with the PDF; expect a first round of fixes.
- **Mom's laptop:** the owner reinstalled Catalog for her user only (2026-10-25). Make sure the old
  "for all users" copy is uninstalled (two copies corrupt the library). Her updates are now
  automatic (checked every 4 h, installed on close or overnight).
- **Mom's buffering:** once she has this build, read her stop log (it now says whether the site or
  the house Wi-Fi was slow). Moving her laptop to Ethernet waits on that.
- **A friend's reports (he's on 3.5.0):** "a film stops and goes back a few seconds" was not
  reproduced; after he updates, ask for Settings → Playback (look for "Went back … by itself").

### Mistakes of mine to not repeat

- **Bulk-downloading about 350 subtitles** used up OpenSubtitles' daily allowance for the owner's
  home internet for about 24 h. Survey from `saved_subtitles` in a library copy, or a handful of
  downloads at most.
- **Test playback signs in to Febbox as the owner.** Streaming several 1080p episodes ate into
  their 10 GB a day. Test on 7Movies/Movy, or with API calls instead of playing video.
- **Declined, don't offer again:** cleaning up old recovery files in `%APPDATA%\Catalog`;
  Radarr/Sonarr-style features.

---

## 4. How the owner wants work done

- **Never release to GitHub until the owner says so.** Pack a test build
  (`npm run pack` → `dist-app\win-unpacked`) for them to try first, and tell them to close their
  installed Catalog before opening it. A major change gets tested by them before release.
- **No slowing things down to fix other things.** They called it "nerfing" and had it reverted.
- **No new accounts, logins or keys** for users.
- **Recommendations must not depend on ratings.** Most people don't rate.
- **Answer the current message.** Don't re-list fixes they've already confirmed.
- **Write out ideas or findings in the message before ending the turn.**
- **When asked for ideas:** measure first, give them numbered with the safest first, and make a
  recommendation.
- **Make fixes general**, across every title, source and code path, not one-off patches.
- **Keep the TVs alike:** the Fire TV and Roku apps should look and behave the same; a fix found
  on one goes to the other.
- **Reproduce before fixing**, and say plainly what's proven and what isn't.
- **Wording:**
  - American spelling and "mom";
  - "Football" means American football; soccer is "Soccer";
  - no chatty UI text, and the app never mentions Claude;
  - **no emoji anywhere in the app** ("so terrible"): real pictures or the app's own icons;
  - release notes are one short line each under New / Improved / Fixed, grouped by area, with a
    title on `## Unreleased — <title>`.

---

## 5. Things that must never happen (from CLAUDE.md, with why)

- **Never force-close `Catalog.exe`.** It has corrupted the library. Ask the owner to close it.
  `taskkill` without `/F` is a normal close, and is OK only for a *test* copy you started.
- **Never point a test at the live library** (`%APPDATA%\Catalog\library.db`). Copy it (with
  Catalog closed) and test on a port other than 4173/5173.
- **Never leave a second Catalog installed or running.** Delete `dist-app` after testing.
- **Never export the `settings` table** (TMDB key, Febbox sign-ins, now several).
- **Febbox rate limit:** never loop lookups over many titles. Bursts of folder listings get a
  Cloudflare 429 that lasts 10–20 minutes and hits the owner's real app too. All listings go
  through the gate in `febboxList.ts`.
- **Never bulk-download from a third-party site** (subtitles, replays, live sites). Any loop that
  fetches needs a budget first.
- **Never enter the owner's passwords** (Febbox, the Roku's developer password): they sign in
  themselves.

---

## 6. How to test

**Dev server** (`.claude/launch.json` → `catalog-test`, port 5199):
- Its committed `CATALOG_DB` points at an *old* session's copy. Make a fresh copy of the live
  library (with Catalog closed) into your own scratchpad, and point `CATALOG_DB` there.
- Restore the file with `git checkout -- .claude/launch.json` before any release, because the
  release commits everything.
- Stop the dev server before `npm run pack` or a release: packing crashes Vite's file watcher.
- It listens on `localhost` (not 127.0.0.1). Febbox listings and anything Electron does
  (Live TV, Movy, the Febbox hidden window) don't work there.

**The desktop test app** (for Live TV, Movy, Febbox, `electron/*.cjs`):
- `npm run build`, then, in the background:
  `CATALOG_PORT=5299 CATALOG_DB=<copy> npx electron . --user-data-dir=<scratch folder> --remote-debugging-port=9333`.
- Drive it with small Node scripts over the DevTools protocol (`http://127.0.0.1:9333/json` →
  the page's WebSocket → `Runtime.evaluate`, `Page.navigate`, `Page.captureScreenshot`). To see
  requests from players inside other sites' frames, use `Target.setAutoAttach` with `flatten`.
- Close it with `taskkill /PID <its main electron.exe>` (the one without `--type=`), never `/F`.
- The owner's own running Catalog (port 4173) answers read-only questions too:
  `/api/diagnostics`, `/api/watch/debug?fid=&share_key=`, `/api/watch/skip-times`.

**The Roku app** can't be run here. Check it with BrighterScript's compiler:
`npx brighterscript --root-dir roku --create-package false` (no errors means the code is sound,
not that it looks right), and call its `/api/roku/*` endpoints with
`User-Agent: CatalogTV/1.0 (Roku)` and `Cookie: catalog_profile=0`.

**Player tricks:**
- Slow a lookup on purpose by wrapping `window.fetch` for `/api/watch/stream`.
- Playback stats (Settings → Playback stats) show the source, what's loaded ahead, each piece's
  speed, and what the computer has downloaded.
- `window.subSync` (dev builds only) shows auto-timing's plan.

**Browser pane quirks:** when it's hidden, there are no focus events and no animation frames;
screenshots can time out, so check with `get_page_text` / JavaScript.

**Tools** (`scripts/dev/`, never packaged): `evalrecs.mjs` (More like this), `availtime.mjs`
(Watch check timings), `tvsim.mjs` (pull pieces like a TV), `cold.mjs` (whole-piece timing),
`pagetest.cjs` (the Febbox page reader), `tmdbsearch.mjs` (TMDB ids).

**Learned 2026-10-25:**
- The test desktop app (above) with `--user-data-dir` in the scratchpad and the library copy
  beside it: downloads ahead then land next to the copy, not in the owner's folder. Delete the
  user-data folder afterwards (its browser cache grew to 2.6 GB).
- A small CDP helper script (nav / eval a file / screenshot / `Emulation.setDeviceMetricsOverride`
  for the mini player's 480×270 / `Network.clearBrowserCache`) did all the UI testing.
- To see what the player does, expose it for the test build only (`window.__testHls`,
  `window.subSync`), marked `TEMP-TEST`, and remove it before packing.
- Node 24 runs `.ts` files directly: copy `src/lib/subtitleAlign.ts` to the scratchpad and import it
  to work out auto-timing offline from a dump of `subSync.heardSoFar()` and the cues.
- `ffprobe` on init + a stored piece (`downloads-ahead/<sha1(copy)[0:16]>/<n>`) shows frame times.

**Shell gotchas:**
- Backslashes in shell heredocs, `node -e` and Python strings get mangled: `\b` became a backspace
  character and `\s` became `s`. Write code with backslashes through the file tools, or as a
  script file. Some long heredocs fail outright in this shell; use a script file then.
- BrightScript reserves `sub` and `box` as names.
- Many files use CRLF line endings.

---

## 7. How to release (only when the owner says so)

1. Stop the dev server and any test desktop app. Restore `.claude/launch.json`. Make sure no
   `dist-app` Catalog is running, then delete `dist-app`.
2. Check that `RELEASE_NOTES.md` has `## Unreleased — <title>` with bullets. Update §3 here.
3. Run `npm run release -- patch` (or `minor`; this build is a `minor`). It builds into
   `dist-release`, then commits (`git add -A`), tags, pushes and uploads. Run it in the
   background; it takes a few minutes.
4. **Verify:**
   - fetch `https://github.com/r5vx/catalog/releases/latest/download/latest.yml` anonymously;
   - download the file it names and compare the sha512;
   - check the Mac workflow through `api.github.com/repos/r5vx/catalog/actions/runs` (`gh`
     isn't installed; GH_TOKEN is in `.env`) and confirm the DMG, zip and `latest-mac.yml` are
     on the release.

Anything less has shipped broken before.

---

## 8. Open ideas and loose ends (offered, not built)

**Live TV and replays:**
- Live TV ideas not built yet: a notice when a saved game starts; two games at once on the computer;
  a "Live now" row on the TV home.
- A "skip to kickoff" for replays would need the game's start found in the video; not reliable.
- Replays have no NHL or MLB source that works today (MLBLive is behind a Cloudflare check;
  WatchReplay stopped updating). Their Filemoon/Byse servers need a click in the player.
- Live TV needs the desktop app; a phone or TV on its own can't read a channel.

**Sources and playback:**
- **Movy is slow** for an episode only on its later server, and its newest episodes are 720p at
  first.
- **Re:Zero on Aniwave is 720p.** Aniwave's other servers are players Catalog doesn't read.
- **If Febbox changes its player page again, both readers need fixing:** `fromSourcesList` in
  `src/lib/server/showbox.ts` **and** in `electron/main.cjs`.
- **Stuck piece:** after a piece stays stuck, play the same spot from the title's other copy, or
  step past it.

**Subtitles:**
- Auto-timing is mostly Silero time (about 2.4 s per 4½ minutes heard).
- Re:Zero English-dub captions: transcribe the dub on the laptop (Whisper).

**Roku:** subtitle auto-timing is on the Fire TV only. Everything else there is unproven until
it runs on a Roku.

**iPhone without a PC (researched 2026-10-26, owner wants it; dad has an iPhone):**
- Possible for the core: Showbox search, Febbox lists and links (the direct ask works without the
  hidden window: Penguins 3.6 s), subtitles, downloads. Needs a native app with its own small relay
  (Febbox's video wants a Referer; iOS's player has no supported way to add one).
- Hard or later: Movy, Live TV, anime.nexus (read in a hidden browser), auto-timing, skip finder.
- Install: no App Store (rejected). SideStore + free Apple ID (7-day signing refreshed on the phone,
  3 apps max, first setup on a PC), or $99/year ad hoc (100 iPhones, a year, no review).
- Build: on GitHub Actions' Macs (as the DMG is), unsigned .ipa; test only on the owner's iPhone 13 Pro Max.
- Node on iPhone (nodejs-mobile) is Node 18, JIT-less, community kept: not a way to reuse the server.
- Tailscale "not working off home Wi-Fi": the iPhone's Tailscale was offline 14 days; the PC side
  (listens on 0.0.0.0, firewall allows, Tailscale network Private) is fine. Use http://100.124.201.118:4173.

**Other:**
- Browse's "trending" shows films still in cinemas (marked "In cinemas"); hiding them was offered.
- More like this: TV-show picks are weaker than films'.

**When buffering is reported:** read the stop log first (`/api/diagnostics` → `playbackStops`,
Settings → Playback, or a photo of **Show details**), then change things.
