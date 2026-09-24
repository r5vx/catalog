# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

## 2.1.1 — 2026-09-24

- **Continue watching tab.** A Watching tab in the library shows what
  you were watching, with posters, progress bars and time left. Click to
  resume at the exact episode. Hover and hit X to dismiss.
- **Subtitles stick across episodes.** Pick a subtitle once and Catalog
  finds the matching one for each new episode, keeping the same delay.
- **Anime shows in the right shelf.** Anime no longer appears under
  "Series" in Browse.
- **Fuzzier search in Browse.** Typos, missing spaces and phonetic
  misspellings are forgiven.
- **Watch progress grouped by title.** Episodes are grouped under
  collapsible title headers. Remove individual episodes or an entire
  title at once.
- **Mark completed / rewatched from Watching tab.** Hover a watching card
  to mark it completed or add a rewatch.
- **Fullscreen improvements.** Player bar overlays the video, top bar
  stays visible while your mouse is over it.
- **Loading screen shows what's happening.** The spinner says what step
  it's on so you know it hasn't frozen.
- **Movies at 93 %+ auto-clear from watch progress.**
- **Continue watching ignores brief visits.** Under two minutes doesn't count.
- **Next Episode button.** Appears near the end of an episode so you can
  jump to the next one without opening the sidebar.
- **Watched episodes highlighted.** Checkmarks and coloured borders in
  the sidebar.
- **Sync progress to library.** Updates the season/episode reached on
  your library entry from the player.
- **Quick-add to library.** Adds the title instantly from the player bar.
- **Per-episode cast.** The cast sidebar shows cast for the specific
  episode, including guest stars.
- **Right-click menu on library entries.** Watch, Edit, Mark completed,
  Rewatched +1 or Remove.
- **Faster repeat loads.** 30-minute cache means re-opening a title
  loads in under a second.
- **Auto-fix wrong cast.** Mismatched entries are detected and corrected
  automatically.
- **Video recovers from expired streams.** Pausing a long time and
  coming back no longer gives a permanent error.
- **Poison Mode.** An easter egg in Settings > Personalization that
  replaces all the UI text with giblet vocabulary. You know who this
  is for.

## 2.1.0 — 2026-09-21 — Wide layout and better search

- **Wide layout option.** Switch between centered and wide layout in
  Settings > Personalization.
- **Fullscreen hides Catalog UI.**
- **More trending actors.** Around 60 instead of 12, and they open
  inside the app.
- **Add to library defaults to "completed".**
- **Better showbox search.** Checks both autocomplete and full search,
  finding titles the autocomplete alone missed.
- **Smarter title matching.** Exact matches preferred, alternative
  lookups verified.
- **Fixed episode listing for many titles.** Shows like The 100 and
  The Pitt now load correctly.

## 2.0.0 — 2026-09-20 — Built-in player

- **Watch inside Catalog.** A ▶ Watch button plays titles in a built-in
  player — no separate window.
- **Custom video player.** Play/pause, skip ±10s, volume (up to 200%),
  seek bar, picture in picture, fullscreen. Keyboard shortcuts included.
- **Quality picker.** 720p, 1080p, 2160p etc.
- **Episode sidebar for TV shows.** Season/episode list with TMDB
  episode titles.
- **Subtitles.** Auto-searched from OpenSubtitles, grouped by language.
  Supports SRT and ASS/SSA. Delay adjustment and file upload.
- **"Wrong show?" button.** Go back to search if auto-resolve picks
  the wrong title.
- **Watch progress saved automatically.** Remembers where you left off
  across sessions.
- **Settings → Watch Progress.** View and delete saved positions.
- **Smarter anime title matching.** Alternative and romaji title lookups.
- **Browse search ranks popular results first.**
- **Trending actors.** Photos and what they're known for.
- **Watch elsewhere.** Dropdown for Miruro (anime) or CineJoy
  (movies & TV).
- **Cast sidebar.** Actors and characters in the player.
- **Theme picker.** System, Light, Dark or Black (OLED).
- **Collapsible update history.**

## 1.7.0 — 2026-09-17 — Infinite browse

- **Browse keeps going.** Every shelf has a Show more button, as many
  times as you like.
- **Trending now / All time** toggle.

## 1.6.1 — 2026-09-16 — Update fixes

- **Update notification works behind a PIN.**
- **Fixed updates that could report failure while still working.**
- Installing an update now says so on screen.

## 1.6.0 — 2026-09-16 — Browse and where to watch

- **Browse.** Find something new — trending titles, synopsis, cast and
  scores on everything.
- **Where to watch.** Streaming, free, rental and purchase info for
  your country.
- **Shared catalogs are usable.** Sort, filter, and add from someone
  else's list.

## 1.5.0 — 2026-09-16 — Better updates

- **Updates install themselves properly now.**
- **Library link** on every page.
- Progress indicator while runtimes and scores fill in.

## 1.4.0 — 2026-09-16 — Clickable actors

- Auto-filling runtimes, box office and scores.
- **Every actor is clickable now.**
- **Personalization settings** with sort option toggling.
- Attention dots on Services and Updates.

## 1.3.0 — 2026-09-16 — Sorting that works

- **Sorting by "Longest" now works.** Missing information fills in
  runtimes and scores.
- **Sort value shows on each card.**
- Update notifications with Not now and Don't ask again.

## 1.2.2 — 2026-09-16 — Automatic updates fixed

- **Fixed automatic updates, which never worked.** Every earlier version
  was missing the file that tells Catalog where to look.

## 1.2.1 — 2026-09-16

- Fixed updates stopping at "Waiting for Catalog to close."

## 1.2.0 — 2026-09-16 — In-app update progress

- Update progress bar in the app instead of a console window.
- Settings → Updates lists what changed in each version.

## 1.1.0 — 2026-09-16 — Sharing and scores

- **Sorting** by IMDb, Rotten Tomatoes, Metacritic or box office.
- **Share your catalog** with a friend and see what you've both watched.
- **Lock a note** behind your PIN.
- Better cast lists for series.
- Save as PDF works.

## 1.0.1 — 2026-09-15

- IMDb, Rotten Tomatoes, Metacritic, age rating, awards and box office
  (with an OMDb key).

## 1.0.0 — 2026-09-15

- First release.
