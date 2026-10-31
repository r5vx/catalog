# Handoff: where Catalog stands (2026-10-31 early morning, 3.7.0 released, test build of the next round in `dist-app`)

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
  by hand is remembered per device. The owner keeps asking for it (2026-10-30: Kent State vs Sacramento
  State was "pretty much perfect" at −5.5 s by hand): **built 2026-10-31**, see §3 "2026-10-31".

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

### 3.7.0 ("Downloads, Rewatching and Caught up, and faster Showbox starts"), released 2026-10-26 night on the owner's go-ahead

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

### Next round (2026-10-28 to 10-30, packed in `dist-app`, not released, nothing committed)

Everything below is in the working tree only (`git status` shows it all uncommitted) and packed in
`dist-app\win-unpacked`. **The owner hasn't said release.** When they do, follow §7; the release
title is already on `## Unreleased — Catalog as a phone app, offline downloads, and mini player fixes`.
The phone setup guide is `Catalog phone setup.pdf` in the owner's Downloads (source
`scripts/dev/phone-guide.html`).


Under `## Unreleased` in `RELEASE_NOTES.md`; details in `CATALOG_CONTEXT.md` "Mini player round (2026-10-28)":
- Live TV in the library header on phones and narrow windows (it was only in the sidebar, hidden under 900 px).
- Mini player: level `screen-saver` (not `floating`) plus a re-raise on blur; no 16:9 lock; dragged by its
  title only (edges free to resize); fullscreen button (not on top while fullscreen).
- Mini player Back to Catalog: opens the video when Catalog's window moved to another page.
- Mini player start: exact place (`place=`), even past 95 %; shows the big player's last picture
  (`catalog:miniStill`) until it plays.
- Mini player captions near the bottom (10 px; 52 px while the controls show).
- **Phone profiles** (`hooks.server.ts` `profileFor`/`mustPickProfile`, `/profiles`): any device that
  isn't the computer itself (`onThisComputer`: Electron UA or loopback, unless Tailscale's proxy
  headers say otherwise) is asked "Who's watching?" once when there's more than one profile; kept in
  the `catalog_profile` cookie; the initial at the top of the library changes it. Continue Watching,
  places, episode ticks and own list follow the profile; **the library grid is still the household's.**
- **Offline phone app:** `static/sw.js` (registered only on https non-localhost; serves
  `static/offline.html` when a page can't be had, 8 s cap), Downloads → Keep on this phone
  (`phoneKeep.svelte.ts` + `phoneKeep.worker.ts`: OPFS `kept/<id>.mp4|vtt|jpg|json`, sync access
  handle, Range resume), Play uses the kept copy, places from offline (`catalog:keptPlaces`) sent back
  on the next online open. Tested in the browser pane on localhost (keep, play with captions, place
  saved) and the service worker in headless Edge (server stopped → offline page).
- **Settings → Phones** (`tailscale.ts`, `/api/phone-address`): runs `tailscale serve --bg
  http://127.0.0.1:<port>`; passes on Tailscale's "enable HTTPS" link; QR code (`qrcode-generator`).
- **Skips:** TheIntroDB added (`theintrodb.ts`, no key, 5,000/day, `duration_ms` picks the cut); per
  part the more-submitted of IntroDB/TheIntroDB wins; when TheIntroDB's version is >20 s off this
  copy's length, neither is used (Chernobyl E5 on 7Movies is Sky's cut: no recap; HBO's has one).
- **Preview pictures per cut** (`previewStrips.ts`): kept by episode + length/10 s (±10 s shared);
  strips kept before without a length are no longer read. The computer's /strip-maker makes them
  from the copy asked for (`fid`, `share`: playing, or `pickFor(next.files)`), its length from the
  playlist. Chernobyl E5: Showbox (HBO) pictures were shown over 7Movies (Sky).
- **Rewatching for shows with no episode noted** (405 Completed entries have none, added by hand):
  starting any episode of a Completed one now sets Rewatching (it set Watching: Chernobyl, so the
  rewatch wasn't counted). Tested on Arcane in a copy.
- Volume: kept per title per device (`catalog:volume:<title>`, 100% not kept), up to 300% (gain +
  limiter past 100%); the slider's left half is 0–100%. A saved boost waits for the first click
  (the page's audio is silent before one). Another title on the same page goes back to 100%.
- Episode list has its own Hide button; "Timing subtitles to the video…" note while auto-timing works.
- Skips (`skipMerge.ts`, player and Roku): a recap and an intro that overlap or touch are one skip.
  IntroDB parts known to be wrong are left out (`WRONG` in `introdb.ts`: Chernobyl's intros).
  A blanket "no intros under 15 s" was tried and the owner rejected it (real short intros exist).
- Subtitles: the kind put on for a show is kept per device (`catalog:showSubs:<title>`) and goes on
  for any episode however opened; same-release matching (`releaseOf`); carried-over ones count as
  automatic (so a mismatch tries the others) and start at delay 0 under auto-timing.
- **A piece missing on a copy's server: the episode's other copy plays on** (player,
  `switchFromMissingPiece` / `copyInstead` / `pieceRefused`). She-Hulk S1E1 on 7Movies' H.264 copy had
  piece #6 (0:36–0:42) refused with 502 for hours (also straight from edge.reelvault.click); hls.js
  retried, then `refreshStream` brought the same hole back forever. Now a piece refused (5xx/404)
  three times while the video waits on it, or one hls.js gives up on, switches copy at the same
  spot (`changeToFile(other, true)`, toast "This copy is missing a part on its server: switched to
  X"). **Never skips seconds (the owner's rule: skipping was built first and rejected).** Only a copy
  with the same audio label, without burned-in subtitles (unless the current one has them), playable
  here, Showbox only if Febbox's allowance isn't used up, not one already left this episode
  (`copiesLeft`, cleared per episode); the same source's other copy first. None: fresh link as before.
  Tested in a fresh headless Edge with a temporary relay switch refusing one piece at both qualities:
  switched to 7Movies HEVC at 32:25 and played on. Testing gotchas: the browser keeps relay pieces
  6 h and the player loads 5 min ahead, so every rerun needs a fresh profile and an unloaded spot;
  piece length varies (6–9.7 s); Edge's request log holds 250 entries unless raised.
  **hls.js dropped to the copy's lower quality by itself when a piece failed** (the "quality changed"
  in the stop log), and stayed on automatic quality after. **Fixed 2026-10-30 evening** (owner: "i dont
  want it dropping quality automatically ever"): `holdLevel` in the player (`autoLevelCapping` and
  `minAutoBitrate` pinned to the picked quality, `preserveManualLevelOnError`), so a piece failed 5
  times is fatal to hls.js and the player's own recovery runs (other copy at the same spot, or a fresh
  link). Proven with hls.js 1.7.3 on a two-quality test video with one 720p piece refused: before, every
  piece after it was 360p; after, none, and a fatal fragLoadError. Roku: `/api/roku/play` gives
  `minBandwidth` (the playlist's top H.264, kbps) → `content.MinBandwidth`; untried on a Roku.
  The missing-piece copy switch can still land on a lower-quality copy (with its toast).
- **Same-length copies share intro and credits** (`skipFinder.ts` `fromDownloads`, `SAME_LENGTH` 3 s):
  a copy heard from downloads (Movy, 7Movies H.264, Aniwave) takes the episode's other copy's found
  parts at once when their lengths match, instead of first hearing the intro (opened past the intro,
  Movy's She-Hulk E1 never got its credits). Not tried on Movy here (Movy needs the desktop app).
- **Cursor in fullscreen** (not reproduced, a friend's report): controls hiding after 3 s of no mouse
  movement now also sets the cursor idle (its own timer could be out of step), entering/leaving
  fullscreen starts the idle time, and a window that fills the screen counts as fullscreen.
### The 2026-10-30 session (four rounds; same test build, not released, nothing committed)

Details of each in `CATALOG_CONTEXT.md`: "She-Hulk round (2026-10-30…)", "Owner's round 2", "Owner's
round 3", "Roku preview pictures". All under `## Unreleased` in `RELEASE_NOTES.md`.

**Subtitles**
- **Carried-over subtitles keep their language.** She-Hulk E5 got German: its German file was named
  exactly like E4's English one (`…1080p.WEB.h264-KOGi.srt`; E5's English ones say 720p). Every match
  step now compares the language; within a release a hearing-impaired file only follows a
  hearing-impaired one. "Doesn't match, try others" tries the language showing, not always English.
- **Captions on carry to the next episode, however they went on** (before: only ones picked from the
  menu). Owner: "if the user has captions on in a previous episode … they are gonna want them on." No
  match from the same release → the first of that language, then the first English (up to 4 tried),
  timed by auto-timing. Ones restored with a saved place are kept as the show's kind
  (`catalog:showSubs:`). Checked: She-Hulk E2 (GLHF) → E3 (GLHF) → E4 (no GLHF: first English).
- **Quick swaps:** a slow earlier pick no longer lands after the one chosen (`subLoads`); a menu pick
  starts at delay 0 under auto-timing. **Retime** button in the captions menu (auto-timing on).
- **Right-click a caption → Copy caption** (captions take clicks now; click/double-click still pause and
  go fullscreen).
- **Captions follow each video frame** (`requestVideoFrameCallback`): `currentTime` only moved every
  ~0.27 s, so captions came up to a quarter second late (owner: "half a second late, slow to appear",
  Venom 3 and She-Hulk E8). Measured after: 10–80 ms. E8's saved +0.5 s delay did **not** come from
  auto-timing (its plan is +0.1 s with the whole episode heard); cause unknown.
- **The delay panel's hints were backwards** ("+0.5s … push them earlier" made them later). Fixed.

**Player and audio**
- **Japanese or the dub is remembered per anime** (`catalog:showAudio:<title>`, then the old device-wide
  `catalog:animeAudio`). Dungeon Meshi E10 went to the dub (and its captions came off) because the one
  device-wide choice was most likely Re:Zero's English; E9's file was Japanese-only, E10's has both with
  English as its default. Set by an audio pick, the language heard on a two-language copy at an episode
  switch, or a Japanese-only copy when the show has no choice yet.
- **Waits after a jump are logged** when still loading 8 s later (`watchJumpLoad`, "After a jump:" in
  Settings → Playback). Skip Intro on Dungeon Meshi E10 "loading for a while" had left nothing.
- **Mini player:** the big player's handed-over picture goes once the mini player's own is ready, even
  paused. Re-checked: the mini page started 14 s before the end of an episode played to the end
  (3.7.0 restarted films opened in their last 5%: the friend's Venom 3 "default picture").
- **She-Hulk on 7Movies HEVC looks bad at 1080p:** the source. 1920×1080 at ~1 Mbps (CDN folder
  `…_1080_h265_966`, pieces 0.3–0.5 Mbps); the H.264 copy is 720p. Not a Catalog bug.

**Skips**
- **Black credit rolls from the preview pictures** (`creditRoll.ts`, `withCreditRoll` in skipMerge.ts):
  pictures with no colour and mostly dark, with names, running to the end. Joined to credits found just
  before (≤15 s), else their own part, so a scene between is never skipped. She-Hulk E2: intro, animated
  credits 23:47–24:27, roll 25:20–27:45, the minute's scene between left alone. The strip gathers the
  last 9 minutes at full detail right after its one-a-minute pass.
- **Skip finder** compares up to 3 episodes while the credits are missing, hears the last 7 minutes
  (was 5), never replaces kept parts with poorer ones; copies kept without credits are compared once
  more per device (`catalog:creditsAgain:`). She-Hulk's animated credits song repeats in only some
  episodes (E1/E2, E2/E6, E4/E6); E3 and E5 share it with none.
- Two "credits" parts broke the progress bar (keyed by kind); keyed by kind + start now.

**Library and Live TV**
- **Mark as completed leaves Continue Watching**, from every screen (`hideCompletedFromContinueWatching`
  in the `complete` action); the player stops saving that episode's place once marked. Another episode
  played brings it back.
- **Live TV showed 0 games after Catalog was closed a day:** the kept schedule had only ended games and
  was answered at once; now the fresh one is waited for (checked: 280 games in 2 s), and the page asks
  again after 20 s when it gets none.

**Roku**
- **Preview pictures while fast-forwarding** (`/api/roku/bif`, `bif.ts`, `HDBifUrl` in
  `PlayerScreen.brs`): a BIF built from the computer's kept pictures; `/api/roku/play` asks the computer
  to make them for the copy played. Checked as the Roku on She-Hulk E2 (167 pictures, valid file);
  **not tried on a real Roku.** `static/catalog-roku.zip` rebuilt.

**Not reproduced / left:** She-Hulk E6 without highlights (owner said forget it); Dungeon Meshi's
900 MB file slow after switching back (Showbox, the owner's allowance); where E8's +0.5 s came from.
- **Not reproduced: the choppy mini player while a fullscreen app is focused.** A test fullscreen window
  over it left it at 24 fps with no dropped frames, but Windows wouldn't give that window focus.
  Waiting on the owner's test with their real game.

### 2026-10-30 evening (same test build, repacked; not released, nothing committed)

- **No automatic quality drops** (see the Player bullet on the missing-piece switch above).
- **Live TV shared between screens** (`liveShare.ts`, relay `kind === 'live'`, `/api/live/playlist`): each
  live piece is fetched from the site once for every screen asking within a minute (kept in memory, 250 MB
  cap), keyed by its address minus signing parameters; each channel's playlist is shared for 2 s, so one
  failure moves the channel to the next player server once, not once per screen. Replays' pieces share too
  (playlists, `.m3u8`, are left to the relay as before). For the Super Bowl at mom's (4+ TVs on one game).
  **Tested** in the desktop test app with an empty library: 5 pretend TVs on ESPN USA for 45 s asked for 45
  pieces, the site was asked 9 times, every TV got identical bytes, no errors; the real player then played
  ESPN USA live 30 s at 720p and an NFL Dailymotion replay 35 s with no stops.
- **Mom's TV "couldn't reach Catalog" (2026-10-30):** Windows had switched her Wi-Fi to **Public**; Catalog's
  firewall permission is Private/Domain only, so the laptop worked and the TVs couldn't connect (Look again
  found nothing: the UDP discovery is blocked too). She set it back to Private. Not the release. Fixes
  offered, not built: a notice on the laptop when the network is Public, with a button that sets it to
  Private (one Windows prompt). TV app changes need sideloading on each TV, so fixes go on the laptop.
- **Backup live site and replay sites researched** (2026-10-30; see §8 "Live TV and replays").

### 2026-10-30 night (same test build, repacked; not released, nothing committed)

- **Public network notice** (`networkType.ts`, `NetworkBanner.svelte`, `/api/desktop/network`, layout's
  `publicNetwork`): on the computer's own window only, when `Get-NetConnectionProfile` says a home network
  (not Tailscale/virtual ones) is Public: "TVs can't connect to Catalog…", **Set to Private** (one Windows
  prompt: `Start-Process powershell -Verb RunAs` → `Set-NetConnectionProfile`), **Not now** (that network's
  name kept in `publicNetworkOk`, never shown again). Checked every minute. Tested in the test app: shows on
  the computer, not at the LAN address, Not now hides it for good. **Set to Private never pressed** (it would
  change the owner's PC). **The owner's own Ethernet (4812Elmolino) is Public**, so they'll see it too.
- **Mom's SVU S28E4 buffering** (photos): 7Movies has no E4 yet, so Movy (5–8 Mbps) plays instead of her
  usual 7Movies HEVC (1.0–2.0 Mbps), and her TV got 5–11 then 1.9–3.7 Mbps from the laptop. Fixed: TVs fetch
  relayed pieces ahead too (`fetchAhead.ts` `onTheComputer`; "0 of the last 6 from memory" before), and
  "Play on 7Movies" in "Keeps stopping to load" only shows once that copy answered (`askCopy`,
  `emptyCopies`, also kept out of the missing-piece switch). How much the fetch-ahead helps on her Wi-Fi is
  unproven; the real fix there is her laptop on Ethernet. Details in CATALOG_CONTEXT.md.
- **SportsBite removed (owner, 2026-10-31: "just get rid of sportsbite").** It only gives its player to
  non-browser requests, so it can't be played without getting around its check. Live TV is DaddyLive alone
  again, read straight from `daddylive.ts` (the merging layer was taken out; its files are in the session's
  scratch folder, not the repo). Kept: each try at a channel's playlist is logged (`/api/diagnostics` →
  `liveTv.recentTries`: player server, "played" or why not).
- **Watch-Wrestling.eu not built:** its source buttons post an encrypted form to techradan.com, which bounces
  to a disguised news page (profitfinderz.com) holding 12 Dailymotion players, 11 of them decoys. Built to
  stop programs reading it; getting past it means faking clicks and picking the visible player. Not done.

### 2026-10-31 (built and tested in the test app; released the same night on the owner's go-ahead, see §3.8)

- **Live captions time themselves to the commentary** (owner: "a 5 second listen … then keeps dialing it
  in"; Live TV only, other auto-timing untouched). The computer's hidden `/caption-timer` page hears each
  watched channel with Whisper base.en and matches words to its captions (`src/lib/liveCaptionTiming.ts`),
  `/api/live/caption-delay` hands every screen the delay, the player applies it every 3 s unless it was changed
  by hand (Reset returns to it). First answer within seconds (from the ~36 s a channel's playlist already
  lists), firmer as it hears more; the last value per channel is kept for next time. Tested on ESPN/ESPN2:
  5.0–5.3 s, 10 s heard in ~2 s. **Not tried:** mom's laptop's speed, a phone, a real Fire TV. The model
  (~75 MB) downloads from Hugging Face the first time; ~22 MB of speech engine is in the installer now.
  Details in CATALOG_CONTEXT.md "Live captions timed by their words, built".
- **SportsBite removed** (see the 2026-10-30 night bullet).

### Waiting on someone

- **The owner trying the test build** (close the installed Catalog first, then open
  `dist-app\win-unpacked\Catalog.exe`): mini player (move, resize, fullscreen, over a fullscreen game,
  Back to Catalog from another page, opening on the last picture), volume up to 300% and kept per
  show, Chernobyl's skips and previews, She-Hulk E1 on 7Movies past 0:36, Movy's credits, the cursor
  in fullscreen, the episode list's Hide, the "Timing subtitles" note, subtitles carried to the
  next episode. From 2026-10-30: captions timing (Venom 3 late in the film), captions staying on
  across episodes, Retime and Copy caption, Dungeon Meshi staying in Japanese, She-Hulk's end credits
  (animated part and black roll), Live TV after a day closed, Mark as completed leaving Continue
  Watching, and any "After a jump" stops in Settings → Playback. Then delete `dist-app` (never leave a
  second Catalog).
- **The phone app on a real iPhone:** never run on one. The owner's own iPhone + PC first: Settings →
  Phones → Turn on (asks Tailscale to enable HTTPS once; this changes their Tailscale, so only on
  their say-so), then the PDF's Part 2. Unproven: `tailscale serve` keeping the Host header (POST
  forms' same-origin check), OPFS saving a multi-GB file on iOS, playback from it, places sent back.
  Then dad's iPhone on mom's laptop.

- **The friend with 0 games and 0 channels:** the exact error text (a photo), and
  `/api/diagnostics` → `liveTv` from his computer once he has the next build.

- **The owner's use of 3.6.0:** SVU on 7Movies HEVC (smooth, no skip after jumps), auto-timing on
  SVU, Live TV's TV shows, and Showbox while another download runs (that change is untested
  with Showbox playing).
- **A real Roku:** the owner installs it with the PDF; expect a first round of fixes. Preview pictures
  (BIF) are new there too.
- **Mom's laptop:** the owner reinstalled Catalog for her user only (2026-10-25). Make sure the old
  "for all users" copy is uninstalled (two copies corrupt the library). Her updates are now
  automatic (checked every 4 h, installed on close or overnight).
- **Mom's buffering:** once she has this build, read her stop log (it now says whether the site or
  the house Wi-Fi was slow). Her photos of SVU S28E4 (2026-10-30) already show the house Wi-Fi: pieces from
  the laptop reached the TV at 1.9–11 Mbps. **Her laptop on Ethernet** is the real fix; the owner was told.
- **Mom's Wi-Fi went Public (2026-10-30):** she set it back to Private herself. The next build tells her on the
  laptop with a Set to Private button. Never tried on her laptop.
- **SVU S28E4 on 7Movies:** 7Movies had nothing for E4 on 2026-10-30 night; once it does, she's back on its
  1.6 Mbps HEVC copy by herself.
- **What to try in the test build from 2026-10-30 evening/night:** the Public-network notice (the owner's
  Ethernet is Public, so it shows for them), TVs over Wi-Fi on a Movy episode (Playback stats: "From memory"
  should be most of the last 6), Live TV unchanged, "Keeps stopping to load" offering
  another source only when it has the episode.
- **A friend's reports (he's on 3.5.0):** "a film stops and goes back a few seconds" was not
  reproduced; after he updates, ask for Settings → Playback (look for "Went back … by itself").

### Mistakes of mine to not repeat

- **A temporary test line glued onto the next line (2026-10-31):** removing then re-adding a `// TEMP-TEST`
  line with the editor in a CRLF file left `// TEMP-TEST	const answer = …` on one line, so the comment ate
  the real code and every live playlist answered "Internal Error". Caught in the test app before packing.
  After removing a temporary line, look at the lines around it (`sed -n`), and grep for TEMP-TEST before
  every pack.
- **Bot checks (2026-10-30):** making requests pass for a browser's (headers) or picking a site's real player
  out of decoys is getting around the site's protection: refused, and not to be tried another way.

- **On-screen tests while the owner is at the PC (2026-10-28):** a test fullscreen window covered their
  screen for 12 s and the test mini player played over their Re:Zero. Check the foreground window first
  (their Catalog playing = they're watching), start the test app with `--mute-audio`, and close the
  mini player straight after.

- **Headless Edge left running (2026-10-30):** killing the Node script's spawned msedge didn't close the
  browser; two test pages kept playing and saving She-Hulk's place every 10 s into the test library, which
  made the Continue Watching fix look broken. Close every msedge whose command line has the scratch
  profile after such a test (never the owner's Edge).
- **Reading the live library while Catalog was open:** check `tasklist` right before copying, and copy
  `library.db` with its `-wal`/`-shm`. A test server answering from a copy writes fresh Live TV listings
  into that copy, which looks like the owner's app wrote them (compare timestamps before concluding).

- **Bulk-downloading about 350 subtitles** used up OpenSubtitles' daily allowance for the owner's
  home internet for about 24 h. Survey from `saved_subtitles` in a library copy, or a handful of
  downloads at most.
- **Test playback signs in to Febbox as the owner.** Streaming several 1080p episodes ate into
  their 10 GB a day. Test on 7Movies/Movy, or with API calls instead of playing video.
- **Declined, don't offer again:** cleaning up old recovery files in `%APPDATA%\Catalog`;
  Radarr/Sonarr-style features; doing away with the TMDB/OMDb keys (built-in key, keyless IMDb
  ratings: researched and dropped by the owner, 2026-10-28).

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

**Learned 2026-10-30:**
- **The browser pane draws nothing while the Claude window is behind other windows** (no animation or
  video frames at all, screenshots time out). Anything frame-driven (caption timing, the frame clock)
  is measured in headless Edge instead: `msedge --headless=new --mute-audio
  --autoplay-policy=no-user-gesture-required --remote-debugging-port=9444 --user-data-dir=<scratch>`,
  driven over CDP from a Node script (nothing on screen). Close it afterwards (see §3 Mistakes).
- **ffmpeg through the test relay** (endings' sound, frames for contact sheets) needs
  `-extension_picky 0 -allowed_segment_extensions ALL`: the relay's piece addresses have no extension.
- Endings compared offline: pull the last minutes' sound to 8 kHz float32 with ffmpeg, then
  `fingerprint`/`longestShared` from a copy of `introFinder.ts` (blank each found run, look again).
- `window.subSync` (dev) has `heardSoFar()` and `cues()`: replaying `fitDelays` on partly masked speech
  shows what auto-timing would have said with less heard.
- A new API route needs `npx svelte-kit sync` before svelte-check stops reporting `./$types` errors.
- Roku endpoints can be asked as the Roku with `User-Agent: CatalogTV/1.0 (Roku)` and
  `Cookie: catalog_profile=0`; a BIF can be checked by reading its header and index with Node.

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
- **Live caption timing by matching words: built 2026-10-31 (§3); the measurements behind it:** Auto-timing
  compares *when someone is talking* with *when a caption shows*; on a game the commentators talk ~78% of the
  time and roll-up captions are on screen almost all the time, so there's nothing to line up (2026-10-25).
  Matching the *words* does work. **Test:** 10.5 min of Kent State vs Sacramento State on ESPN2 (the game the
  owner set to −5.5 s by hand), recorded through the test app; captions read from the video's own CEA-608
  bytes (CC1; ffmpeg's `subcc` found none, so a small reader of the H.264 "GA94" SEI was written); Whisper
  base.en (q8, transformers.js 3.7.5 in Node) heard 1,087 words in **60 s** for the 10.5 min (Ryzen 7 5800X);
  three-word runs matched: **773 matches, captions 5.28 s late (middle half 5.10–5.49 s)**, every minute
  5.21–5.34, and every one-minute estimate 5.2–5.4. So one minute of listening gives the delay, and it holds.
  **Owner's terms:** Live TV only for now; never touch auto-timing elsewhere until it's proven here.
  **To build:** on the computer (a hidden page like /speech-maker, or the server reading the 608 bytes from the
  relayed pieces plus a hidden page for the sound), per channel being watched with captions, hear ~60 s, match,
  serve the delay to every screen on that channel (TVs and Roku too); recheck every few minutes. Model: base.en
  q8 is ~75 MB to download once (tiny.en ~40 MB, untested here). Unknown: speed on mom's laptop. The test tools
  are in `scripts/dev/caption-timing/` (README there says how to rerun it).
  **Faster than a minute (owner: "waiting 1 minute with desynced captions is kinda annoying", measured
  2026-10-31 with `window.mjs` on the same recording):** an answer needs 3 matching runs that agree. 5 s of
  sound: answer 65% of the time (92% of answers within 0.3 s); 10 s: 84% (96%); 20 s: 92% (99%); 30 s: 96% (99%);
  misses are ad breaks. **And no waiting is needed for the sound:** every live playlist already lists ~36 s of
  the recent past (6 pieces; ESPN, ESPN2, ABC, FOX checked), so the computer can hear those the moment a
  channel opens: an answer in a few seconds (download + ~3 s of Whisper here; more on mom's laptop), often
  before the picture starts. Plan offered: (1) start from the delay last found for that channel; (2) hear the
  listed past at once; (3) recheck now and then.
- A "skip to kickoff" for replays would need the game's start found in the video; not reliable.
- Replays have no NHL or MLB source that works today (MLBLive is behind a Cloudflare check;
  WatchReplay stopped updating). Their Filemoon/Byse servers need a click in the player.
- Live TV needs the desktop app; a phone or TV on its own can't read a channel.
- **Backup live site:** SportsBite was built and removed (2026-10-31; see §3). Others checked 2026-10-30:
  NTV and zlive are script-built apps with no open data; StreamSports99's .ru didn't answer; Famelack and
  EasyWebTV are free iptv-org channels (no ESPN/ABC/FOX games); IPTV Web and TVCL sit behind Cloudflare's
  check. None is a backup today. Super Bowl LXI (Feb 2027) is on ABC/ESPN.
- **Replay sites (researched 2026-10-30, not built):** Watch-Wrestling.eu (wrestling/MMA) looked worth doing
  but its videos sit behind an encrypted form, a disguised page and decoy players (see §3, 2026-10-30 night):
  not built. YouTube's official channels: legal, mostly highlights,
  some full games (CBS Sports, AEW); playing YouTube in Catalog's player is fragile. No: Footballia (free
  account needed), NASCAR Classics (paid), 1Max (links through advert redirect pages), RealFights and
  FullRaces (Cloudflare check), 720pier (torrents, Russian forum). Basketball-Video is already in.

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

**Roku:** subtitle auto-timing is on the Fire TV only, and the black-roll credits (from preview
pictures) on the computer and Fire TV only (the Roku gets only the sound-found ones). Everything else
there is unproven until it runs on a Roku.

**Skips:** only the longest shared run between two episodes is taken, so a long ending is sometimes
found in part (She-Hulk E2's ~1:35 animated credits as their last 40 s); joining nearby runs on the
same line-up would fix that. Kept strips can hold pictures past the copy's end (E2 at 1665 s had 1860
and 1920); ignored for the roll, cause not looked into.

**Picture quality:** 7Movies' "HD" copies can be starved (She-Hulk HEVC ~1 Mbps at 1080p); showing a
copy's real bitrate in the copy picker is an idea only (not offered yet).

**iPhone without a PC (researched 2026-10-26, owner wants it; dad has an iPhone):**
- Possible for the core: Showbox search, Febbox lists and links (the direct ask works without the
  hidden window: Penguins 3.6 s), subtitles, downloads. Needs a native app with its own small relay
  (Febbox's video wants a Referer; iOS's player has no supported way to add one).
- Hard or later: Movy, Live TV, anime.nexus (read in a hidden browser), auto-timing, skip finder.
- Install: no App Store (rejected). SideStore + free Apple ID (7-day signing refreshed on the phone,
  3 apps max, first setup on a PC), or $99/year ad hoc (100 iPhones, a year, no review).
- Build: on GitHub Actions' Macs (as the DMG is), unsigned .ipa; test only on the owner's iPhone 13 Pro Max.
- Node on iPhone (nodejs-mobile) is Node 18, JIT-less, community kept: not a way to reuse the server.
- **Downloads with no connection (dad, 2026-10-28):** Tailscale works on mobile data too, but with no
  connection at all the phone can't reach the PC, so only what's saved on the phone plays. Offered,
  safest first: (1) Save to this device → Files app (built, untried on an iPhone; Files may not show
  captions); (2) VLC for iOS (free) with the MP4 and its .srt; (3) captions built into the saved MP4
  (tx3g track; unknown whether Files shows them); (4) Catalog as a home-screen web app that keeps
  downloads offline (needs Tailscale's free HTTPS name, a bigger build); (5) SideStore native app.
- **The owner chose option 4 (2026-10-28): Catalog as an offline home-screen app.** Plan given: Tailscale
  HTTPS name (`tailscale serve`), web app manifest + service worker, Downloads kept in the phone's
  storage (OPFS; up to 60% of the disk, `navigator.storage.persist()`), played in Catalog's player
  offline with captions and places synced back later. Web apps can't download in the background
  (keep it open while saving). First step proposed: a prototype that keeps one replay on the iPhone
  and plays it in airplane mode. Not started.
- **Dad's phone goes to mom's laptop** (not the owner's PC), so his phone and his TV profile share
  places. **Built 2026-10-28 (test build):** phone profiles, the offline phone app, Settings → Phones.
  Guide: `Catalog phone setup.pdf` in the owner's Downloads (source `scripts/dev/phone-guide.html`,
  printed with headless Edge `--print-to-pdf`). Not tried on a real iPhone or over a real
  `tailscale serve` (HTTPS isn't on in the owner's tailnet; the button would change their Tailscale).
- Tailscale "not working off home Wi-Fi": the iPhone's Tailscale was offline 14 days; the PC side
  (listens on 0.0.0.0, firewall allows, Tailscale network Private) is fine. Use http://100.124.201.118:4173.

**Other:**
- Browse's "trending" shows films still in cinemas (marked "In cinemas"); hiding them was offered.
- More like this: TV-show picks are weaker than films'.

**When buffering is reported:** read the stop log first (`/api/diagnostics` → `playbackStops`,
Settings → Playback, or a photo of **Show details**), then change things.
