# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

## 2.1.4 — 2026-09-26

- **Cleaner player bar.** Removed the "Logged in" label. Quality
  files are now a dropdown instead of a row of buttons.
- **Highest quality selected by default.** The player picks the
  largest quality and file size automatically.
- **Subtitle tooltips.** Hover a subtitle to see the full name.
- **Wrong-episode subtitles filtered.** SubDL results for other
  episodes and season packs are now filtered out.
- **Active subtitle name shown.** The captions button shows which
  subtitle is loaded instead of generic text.
- **"Wrong one?" moved to Settings.** Frees up space in the player
  bar — find it in Settings > Other.
- **Addic7ed subtitles.** TV shows now also search Addic7ed (via
  Gestdown) for more subtitle options.

## 2.1.2 — 2026-09-26

- **Better video quality.** The player now uses a direct full-quality
  stream instead of the low-quality preview URL. Should fix the
  360p-only playback.
- **Faster loading.** Removed unnecessary network polling that added
  10–15 seconds to every video load.
- **Watched episodes actually show.** Previously, completed episodes
  were deleted from the database so the sidebar never knew they were
  watched. Now they stay tracked, and episodes before your library
  position also show as watched.
- **File picker shows every file.** Multiple files at the same quality
  (different codecs or sizes) now appear as separate choices instead
  of being collapsed into one.
- **Resolution picker.** When the stream offers multiple renditions
  (360p, 720p, 1080p, etc.) a Resolution section appears in player
  settings so you can lock a specific one. Shows the actual playing
  resolution when only one rendition is available.
- **Continue Watching posters.** Titles that don't exactly match the
  library name (e.g. "Backrooms" vs "The Backrooms") now find their
  poster instead of showing a grey rectangle.
- **Image resize handle stays put.** Dragging the resize handle on a
  note image no longer makes it disappear.
- **Library search forgives punctuation.** Searching "Xmen" now finds
  "X-Men", "Spiderman" finds "Spider-Man", etc.
- **Continue Watching shows on the Notes page.** The tab no longer
  disappears when you navigate to Notes.
- **Captions on iPhone.** Subtitles now show in iOS fullscreen via native
  text tracks. No longer duplicated on desktop.
- **Continue Watching posters for non-library titles.** Shows like
  "Backrooms" that aren't in your library now keep their poster in
  Continue Watching instead of showing a grey rectangle.
- **Stream debug info.** The settings popup shows stream info so you can
  see what quality the player is actually getting.
- **Mac update error fixed.** The updates page shows a clear message
  instead of a raw error on Mac.
- **Seamless quality switching.** Changing the video file no longer
  freezes the player with a "Switching quality" dialog — the old
  stream keeps playing until the new one is ready.
- **Settings popup cleaned up.** Removed the duplicate file-type
  list from settings (the top-bar buttons already cover it).
- **Watch Next stays visible.** The Next Episode button no longer
  vanishes the instant the episode finishes playing.
- **Continue Watching shows the next episode.** When you finish a
  TV episode, the next one appears in Continue Watching instead
  of the show disappearing. Only goes away once the series is over.
- **Search finds "Re:Zero" from "rezero".** Punctuation and spaces
  are now fully stripped for matching, so run-together searches work.
- **Stream info shortened.** The settings popup no longer shows the
  full stream URL — just a truncated preview with a Copy button.
- **Progress bar resets properly.** Switching episodes no longer
  leaves the bar pinned at the old episode's position.
- **Skip to end shows the last frame.** Skipping forward near the
  end of a video now lands just before the end so it renders.
- **Quality switch shows a toast.** A small "Switching quality…"
  label appears near the top while the new stream loads.
- **Green dot for watched episodes.** Replaced the checkmark with
  a green dot — and rewatching no longer removes the indicator.
- **Buffering recovery.** If the player is stuck buffering for 12
  seconds it automatically retries.
- **More subtitles found.** Subtitle search now tries multiple name
  variations (e.g. "re zero" and "rezero"), which finds subs that
  were missed before — especially for anime titles.
- **SubDL subtitles (optional).** Drop a free key from subdl.com
  into Settings > Services and the player searches SubDL alongside
  OpenSubtitles, giving you more subtitle options.
- **Subtitle source labels.** Each subtitle in the picker shows
  where it came from (OpenSubtitles or SubDL).
- **Continue Watching catches short visits.** TV episodes show up
  immediately. Movies need 30 seconds instead of 2 minutes.

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
