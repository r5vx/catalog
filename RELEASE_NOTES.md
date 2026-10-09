# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
Name the update on the heading line: `## Unreleased — Skip Intro and faster loading`.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number, date and that name. It refuses to run
without both.

## Unreleased

## 3.0.0 — 2026-10-09 — Catalog 3.0: a second source, dub captions, watch lists and TV

- **A second place to watch anime: Aniwave.** Episodes Showbox doesn't
  have now play from Aniwave in Catalog's own player, in the same episode
  list, on the computer, your phone and the TV. A show that isn't on
  Showbox at all, like Kaiju Girl Caramelise, plays straight from Aniwave.
  Shows Showbox splits into different seasons than usual, like Re:Zero,
  get Aniwave's copies too.
- **Every copy in one place.** The file button lists each episode's
  Showbox files and Aniwave's Japanese-audio and English-dub versions, with
  where each comes from. Showbox's play first; picking an Aniwave version
  keeps that audio for the next episodes.
- **Accurate English dub captions.** Anime gets anime.nexus's subtitles at
  the top of the list: on the English dub, its "English CC", which follows
  the dub word for word; on Japanese audio, its English translation.
- **Anime in Japanese starts with subtitles on**, using Catalog's own
  subtitles, so the size, style and delay are yours to change.
- **"Not available" instead of "Not on Showbox"**, now that there's more
  than one source.
- **The picture fills the screen.** The video now uses the whole screen,
  under the top bar (which hides while playing), so there's no black strip
  at the top or bars at the sides. Fill is the new default; picking Fit
  in the player's settings makes Fit your default for everything.
- **The file button has an arrow**, so it's clear it opens a list. The
  full file name is in the player's settings, under Stream info.
- **Autosync** replaces the Sync button, next to Autoplay. While it's on,
  a minute into an episode a show that isn't in your library is added as
  watching, your entry moves forward to the episode you're on (never
  back), and finishing the last episode marks it completed.
- **The Watch button turns green much sooner**: Showbox and Aniwave are
  asked at the same time, from the moment the page opens, and the answer
  is remembered.
- **Episode names for every season** of shows TMDB counts as one long
  season, like Re:Zero.
- **Posters in Continue Watching** for shows that had none.
- **A title page says when AniList is busy** instead of "Nothing found".
- **More English subtitles from SubDL.** It's now asked for English on its
  own, so shows where it had mostly other languages show its English ones.

- **Search your notes.** A search box on the Notes page finds pages by
  title or by what's written in them. Locked pages only match on their
  title — what's inside stays hidden.
- **Edited notes go to the top right away.** Leaving a note straight
  after typing no longer shows the old order, and the last few
  keystrokes are never lost.
- **Autoplay waits for the very end.** The next episode starts only once
  the last frame has played, so endings aren't cut off.
- **Removing a show from Continue Watching keeps its progress.** The
  card is hidden, but the green ticks on watched episodes stay. Watching
  it again brings the card back.
- **Searching a show finds the show first.** "saiki k" now puts the
  main series ahead of its season 2.
- **Tidier episode list.** Quality labels no longer crowd the episode
  names.
- **Library stats as tiles.** The numbers at the top of the library are
  now a row of tiles — watched overall, then each category.
- **Right captions for the right episode.** Season-pack subtitles now
  give you the episode you're on instead of always episode 1, and the
  automatic caption pick no longer grabs a file for a different episode.
- **Captions don't go missing.** An episode could end up with an empty
  caption list; it now asks once per episode, and opening the captions
  menu tries again if the list is empty.
- **Pages show they're loading.** A thin bar at the top appears while a
  page loads, so a click never looks ignored.
- **Anime series are labelled Anime.** Shows like Saiki K. no longer say
  "TV Short" or "ONA".
- **Continue Watching text lines up.** The spacing around the dots is
  the same on every card.
- **One card per anime, not one per season.** Search and Browse show a
  show once — later seasons fold into it; films, OVAs and specials keep
  their own cards.
  Owning any season counts as owning the show, and adding season 2 of
  something you have opens the one you already have.
- **Seasons in your library are merged.** If an anime was added season
  by season, those entries become one (keeping your status, rating and
  notes). A backup of the library is saved first.
- **Watch list.** A new tab where you add franchises and see them in
  release order: how far through you are and what's up next. Search for
  any film series (Harry Potter, John Wick, Fast & Furious…), or pick a
  full list that mixes films and series: the MCU, Ultimate Marvel (with
  X-Men, the Spider-Man films, the Netflix shows and more) or Star Wars.
  Search puts the most popular series first, and the add panel opens on
  a grid of popular franchises. Each list has an Up next card, a
  timeline by year or a poster wall, and a progress ring.
  Right-click a title to watch it or add it to your library, and coming
  back from a title returns you to where you were in the list.
  Marvel's One-Shots are optional extras, hidden unless you turn on
  "Show extras", and ticking one off keeps it out of Movies.
- **Notes list shows when each page was last edited**; the date it was
  created is inside the note.
- **Watch lists open instantly.** Release dates and posters are saved,
  so they no longer have to be looked up each time the app starts.
- **Library, Notes and Watch list share one header**, so switching
  between those tabs no longer makes everything jump. Settings and
  Browse are there on every one of them.
- **Search bar with the button beside it** on Notes (+ New page) and
  Watch list (+ Add watch list). On Watch list the same bar filters
  your lists, or finds franchises while adding.
- **"✓ Mark as completed" in the player** for anything in your library
  that isn't completed yet. It used to just say "In library".
- **Finishing something you'd marked Want to watch moves it to the top
  of Recently added**, instead of leaving it where it was when you listed it.
- **Hide tabs you don't use.** Right-click a tab (Movies, Notes,
  Friends…) to hide it; right-click the empty space beside the tabs to
  bring it back. A hidden category's count box goes too.
- **Settings' back link returns you to where you were**: the same page,
  scrolled to the same spot.
- **"↑ Back to top" on the library, Notes and Watch list pages**, like
  Browse has.
- **Library filters stay put.** The status, sort, tags and years you
  choose are kept, even after closing the app, until you change them.
- **Drag the tabs to reorder them.** Movies, Anime, Notes and the rest
  stay in the order you put them.
- **Recently deleted for notes.** A deleted page waits there for 7 days
  before it's gone, so it can be restored, or deleted for good sooner.
- **Version history for notes.** Earlier versions are kept as you edit,
  and always just before most of a page is deleted, so a wiped page can
  be brought back.
- **Pin notes to the top**, whatever order the list is in.
- **Sort notes** by last edited, date created or name A–Z, next to
  + New page. The choice is remembered.
- **Tags for notes.** Tag pages ("School", "Work"…) and pick a tag above
  the list to see only those. A page made while a tag is picked gets it.
  Right-click a tag to rename or delete it.
- **Right-click a note** to open, pin, tag or delete it.
- **Catalog's own confirm box** instead of the plain Windows-style one,
  for deleting notes and library entries.
- **Reset tab order** when right-clicking the tabs.
- **Skip a title in a watch list**, from the Up next card or by
  right-clicking it. Skipped titles aren't counted and are remembered.
  **"↓ Jump to it"** scrolls the list to where you're up to.
- **Specials are extras too**: Werewolf by Night and the Guardians
  Holiday Special are optional, like the One-Shots.
- **DC watch lists**: DC Universe (the new James Gunn universe) and
  Ultimate DC, everything DC on screen since 2000 — the films, the
  Arrowverse, Smallville, Gotham, Titans, Peacemaker and the rest.
- **Right-click on a person's page** to watch or add their films and
  shows, and in Recently deleted to restore or delete for good.
- **Anime split into parts with different names are one show**, the way
  Showbox has them: JoJo's Bizarre Adventure's Stardust Crusaders,
  Diamond is Unbreakable and so on are now seasons of one card.
- **Fixed: JoJo's Bizarre Adventure said it wasn't on Showbox.** Titles
  with "(TV)" on the end are now found.
- **Right-click an episode in the player** to mark it watched or not,
  mark everything up to it, or a whole season.
- **Watch lists count a show once**: its seasons together are one title
  in "x of y watched".
- **"⋯" buttons** on library cards, Browse, Friends, notes, watch lists,
  people's pages and the player's episode list open the same options as
  right-clicking. They appear when you hover over something. One at the
  end of the tabs shows how to hide and move them.
- **Shows Showbox splits in two are one list.** JoJo's Bizarre Adventure's
  separate Steel Ball Run entry now fills in season 6, so the newest
  episodes are in the same place as the rest.
- **Episodes that aren't out yet show in the list, greyed out**, with the
  date they air (or "Not on Showbox yet").
- **Catalog reopens after updating.** Its window shows even if the first
  page load fails, and the background server no longer lingers after
  Catalog closes (which could leave an old version answering).
- **A closed episode list stays closed** the next time you open that show.
- **Catalog on a Fire TV.** A small TV app shows the Catalog that's open
  on a computer in the same house, driven by the remote: arrows move
  around, OK opens, Back goes back, the menu button opens a title's
  options, and play/pause and fast-forward/rewind work in the player.
  Settings → Watch on TV has the setup steps and the address to type into
  Downloader on the TV.
- **Search no longer stalls for seconds** when AniList is busy: it shows
  what TMDB has straight away and leaves AniList alone until it's ready,
  and repeat searches are remembered for a few minutes.
- **OVAs and specials are part of their show's card** in search and
  Browse, under a Specials season in the player when Showbox has them.
  Films still have their own cards.

## 2.1.10 — 2026-10-05 — Skip Intro and smoother playback

- **Skip Intro for anime.** A Skip Intro button appears during the
  opening, and Skip Recap during recaps, using community-submitted
  timestamps. When the end credits start, Next Episode shows up right
  away. The intro and credits are marked in yellow on the progress bar.
- **Next episode button.** A ⏭ button in the player controls jumps to
  the next episode without opening the episode list.
- **Bigger subtitle delay steps.** The delay menu has labelled −5s,
  −0.5s, +0.5s and +5s buttons for subtitles that are way off.
- **Continue Watching opens faster.** Hovering a card starts finding
  the episode in the background, so it's usually ready by the time you
  click.
- **Shows are remembered between sessions.** After restarting Catalog,
  shows you've watched open without searching Showbox again.
- **No more endless loading.** If a video stalls or its link goes stale,
  the player gets a fresh one by itself. If that keeps failing it stops
  and shows a Retry button instead of spinning forever.
- **Next episode loads ahead.** Near the end of an episode, the next
  one's link is fetched in the background, so autoplay starts faster.
- **Faster resume.** Continuing a series no longer fetches episode 1
  first before the episode you're actually on.
- **Player errors are visible.** Messages in the player were hidden
  behind the top bar; they now show below it.
- **Cleaner subtitles.** Tags like `\an8` no longer show up in the text;
  lines meant for the top of the screen now appear there, and
  overlapping lines show together.
- **Cursor hides properly in fullscreen**, wherever the mouse is resting
  — including over the episode list.
- **Lighter on the network while watching.** The cast panel was asking
  for the same cast over and over for shows with no cast listed.

## 2.1.9 — 2026-10-04 — Better search and Browse

- **Search results rank by popularity.** Searching "Die Hard" now puts
  the 1988 classic and its sequels at the top, not obscure foreign films
  that happen to share the name.
- **No more random obscure titles in Browse.** Trending and popular
  shelves now filter out titles with very few ratings.
- **Release notes have titles.** Every update on the Updates page now
  shows a descriptive name, not just a version number.
- **Cursor hides in fullscreen.** The mouse cursor disappears after a
  few seconds of inactivity in fullscreen, so it doesn't cover the
  video.
- **Anime keeps going.** "Show more" on the Anime shelf no longer runs
  out after two clicks — once trending is exhausted it continues with
  the full AniList catalog.
- **Anime filters work.** Year range, sort, and genre filters in Browse
  now apply to the Anime tab too, not just Films and Series.
- **Error pages have a back button.** If a title page fails to load,
  you can go back instead of restarting the app.
- **Newest first sort works.** Browse no longer shows empty shelves
  when sorting by release date — new titles with few ratings are
  no longer filtered out.
- **Remove from library everywhere.** Right-click any title in Library,
  Browse, or Friends to remove it. A hover × button also appears on
  the poster.
- **Stricter watch matching.** Clicking Watch now passes the year, so
  "Face to Face" (1946) doesn't land on the 2019 version. Sequel
  numbers are matched strictly — "Edgerunners 2" won't match
  "Edgerunners".
- **Friends page remembers state.** Navigating away and back keeps
  the selected friend, filters, and scroll position.
- **Actors page works again.** Clicking trending actors no longer
  gives a 404.
- **Actors moved into Browse.** The actors page is now a tab inside
  Browse instead of a separate page.
- **Unavailable titles say so.** Clicking Watch on a title that
  Showbox doesn't have now says "unavailable on Showbox" instead of
  the generic "no link available."
- **No random actors in trending.** People with fewer than two known
  credits are filtered out of the trending actors list.
- **Detective Conan stays in Anime.** Anime films no longer appear in
  the Films tab.
- **Anime year shows correctly.** Sorting anime by date no longer
  shows "----" for the year.
- **Faster filter changes.** Switching filters in Browse loads one
  page instead of three, so results appear faster.
- **Faster image loading.** Anime and movie poster images connect
  sooner thanks to DNS preconnect hints.
- **Season and part titles work in Watch.** Searching for
  "Apothecary Diaries Season 3" now finds the show and opens at
  the right season, instead of saying not found.
- **Anime shows "Anime" not "TV".** Browse cards for anime series
  now say "Anime" instead of the confusing "TV" label.
- **Old Actors page redirects to Browse.** The standalone /people
  page now redirects to the Actors tab in Browse.
- **"TV Series" tab in Browse.** "Series" is now labelled "TV Series"
  for clarity.
- **Better year matching.** Titles with the same name but different
  eras (like "Face to Face" 1946 vs 2019) are matched correctly —
  old shows don't steal modern results and vice versa.
- **Browse survives rate limits.** Heavy scrolling through anime
  no longer wipes the page blank when AniList throttles requests.
  Title pages also retry instead of showing a 404.

## 2.1.8 — 2026-10-03 — Stats and spacing

- **Stats line is easier to read.** The watched/total counts per
  category are spaced out instead of crammed together.

## 2.1.7 — 2026-10-03 — Browse overhaul and HEVC fix

- **Browse cards are fully clickable.** Clicking anywhere on a card
  opens the title — not just the poster or the name text.
- **Browse remembers your scroll position.** Coming back from a title
  page puts you right where you left off.
- **Back to top button.** A floating arrow appears in Browse when you
  scroll down.
- **Adding from a title page stays on the page.** You no longer get
  sent away to the library entry — the button says "Added!" with a
  link if you want it.
- **Right-click menu stays on screen.** Context menus near the right
  edge no longer get cropped.
- **Show more loads 60 titles.** Each click fetches three pages
  instead of one.
- **Anime classified correctly.** Japanese animated titles from TMDB
  (like Hunter x Hunter) now land under Anime, not Series.
- **No unreleased movies in Browse.** Films that haven't come out yet
  no longer appear in trending or popular. The Watch button is also
  hidden on title pages for unreleased titles.
- **Quality switch error is visible.** The error message when a file
  can't be played now shows as a clear toast over the video instead
  of a barely-visible bar.
- **Browse starts with 60 titles per shelf.** The initial load now
  matches what "Show more" gives, so you see three times as much
  before needing to click.
- **"Show more" state preserved.** Coming back from a title page
  restores everything you expanded, not just the scroll position.
- **"All time" shows real classics.** The popular list no longer mixes
  in obscure regional titles — only well-known films, series and anime.
- **Settings auto-save.** Theme, layout, sorting and region all apply
  instantly when you pick them. No more Save buttons.
- **Completed counts per category.** The library header now shows how
  many you've completed in each category (Movies, TV Shows, Anime).
- **Anime never runs out in Browse.** "Show more" on the Anime shelf
  now keeps going with popular titles once the trending list is
  exhausted.
- **Watch button always visible.** Title pages check Showbox in the
  background — if the title isn't available, the button turns red and
  says "Not available on Showbox" instead of disappearing.
- **Friends tab in your library.** Import a friend's shared catalog and
  browse it right from the library. See what they've watched, filter by
  category, search their titles, and add anything to your library with
  one click. Friends persist between sessions — no need to re-import.
- **Clicking titles works from everywhere.** Titles that are already in
  your library (like Peacemaker) no longer reset your position — they
  open the title page with an "In your library" link instead.
- **Watch button doesn't flash.** The button now shows "Checking
  availability…" while loading, instead of flashing.
- **Browse search is more forgiving.** "peace maker" (with a space) now
  finds Peacemaker. The search also tries separate movie and TV lookups
  for broader results.
- **Browse filters match the library.** Sort and year filters are now
  inline dropdowns in the toolbar, the same style as the library page.
- **Add from Browse on hover.** Hovering a card shows "+ Add" and
  "Watchlist" buttons so you don't have to right-click.
- **Back to top is clearer.** The button is bigger and says "Back to
  top" instead of just showing an arrow.
- **Search finds compound titles.** Typing "peace" now finds
  "Peacemaker" — the search tries a broader lookup so single-word
  titles that start with your query don't get missed.
- **Popular titles rank higher.** Obscure titles with no poster no
  longer outrank well-known ones just because the name matches exactly.
- **Episode list scrolls to where you are.** Opening a show from
  Continue Watching now scrolls the episode sidebar to the episode
  you're on, instead of starting at the top.
- **Friends tab hides watchlists by default.** Their planned/want-to-
  watch titles are hidden unless you pick "Their watchlist" from the
  filter. No more wading through titles they haven't actually seen.
- **Year range lives inside the filter dropdown.** The From/To year
  fields moved out of the toolbar and into the Filter panel in both
  the library and Browse, reducing clutter.
- **Library stats show watched vs total.** The header now reads
  "386 watched / 397 in library · 264 / 269 Movies · …" so you can
  see at a glance how many you've actually watched per category.
- **Filter dropdown stays open while selecting text.** Highlighting a
  year value no longer closes the dropdown when your mouse leaves the
  panel.
- **4K HEVC files play instead of failing.** Files whose highest
  quality level uses HEVC (unsupported in Electron) now fall back to
  the best H.264 level automatically, instead of showing "file cannot
  be played."
- **Browse filters consolidated.** Genre, year range, and clear-all
  are grouped in a single "Filter" dropdown button.
- **Compact stats line.** The library header now shows per-category
  counts and the overall completed ratio in one line.
- **Anime classified correctly everywhere.** Japanese animated shows
  (like Apothecary Diaries, Shangri-La Frontier) are now properly
  categorised as Anime, not TV Shows — in the library, in Browse
  results, and in search. Existing mis-categorised entries are
  fixed automatically on startup.
- **Episode sidebar scrolls on resume.** Opening a show from Continue
  Watching now reliably scrolls the sidebar to the current episode.
- **Better stream error diagnostics.** When a file fails to play,
  the error now shows exactly what went wrong (HTTP status, error
  type) in the debug details, making it easier to diagnose.
- **Music and specials sink to the bottom.** Music videos, OVAs, TV
  shorts, and specials no longer outrank real films and series in
  search results.
- **Watch button won't send you to a different title.** Clicking Watch
  on "Peace" no longer opens "War and Peace" — the match is stricter
  now and says "not available" when Showbox doesn't have it.

## 2.1.6 — 2026-10-02 — Continue Watching and player fixes

- **Continue Watching fixed.** The tab no longer breaks the library
  when an episode has bad data. Phantom entries are filtered out.
- **TV shows never vanish from Continue Watching.** Finishing an
  episode no longer makes the show disappear — it stays until you
  dismiss it or finish the series. The next episode shows as "Up next."
- **Search bar fixed (for real).** Typing in the library search no
  longer loses letters mid-word.
- **Smoother seeking.** Dragging the progress bar no longer snaps
  back while the video loads.
- **Faster arrow-key seeking.** Spamming the arrow keys no longer
  builds up lag — each seek cancels the previous download.
- **Video stays smooth in the background.** Catalog no longer gets
  choppy when another app (like a game) is focused.
- **Library shows completed count.** The All tab now shows how many
  titles you've completed out of the total.
- **Mark as watched while playing.** Movies tagged "want to watch"
  get a Watched button in the player bar.
- **Better undo in Notes.** Ctrl+Z undoes one step at a time instead
  of wiping out a whole paragraph. The toolbar now has a "Normal"
  button to switch back from a heading.
- **Mac: right-click to open.** The Mac build is now ad-hoc signed,
  so you can right-click → Open instead of using Terminal.
- **Mac: fix quarantine button.** Mac users see a button in Settings →
  Updates that removes the quarantine flag automatically.
- **Bigger buffer.** The player now preloads up to 5 minutes ahead
  (and keeps 90 seconds behind) so playback is smoother on good connections.
- **Autoplay next episode.** TV shows and anime have an autoplay toggle
  in the player bar — when enabled, the next episode starts automatically
  with 5 seconds left.
- **Smoother updates.** The "update ready" banner now reliably appears,
  the progress bar animates while downloading, and the app shows a clear
  message before restarting to install.
- **Resume across seasons.** If you finished an episode (95%+), opening
  it from Continue Watching now takes you straight to the next episode
  instead of restarting the old one.
- **Episode sidebar auto-scrolls.** The sidebar scrolls to center the
  playing episode, and switching seasons updates automatically when
  autoplay crosses into a new season.
- **Stale stream recovery.** If you leave the player paused for hours and
  come back, it now silently refreshes the stream instead of showing an
  infinite loading screen.
- **Faster quality switching.** Stream URLs are cached so switching back to
  a quality you already used is instant. Other qualities prefetch in the
  background while you watch, so switching is ready before you click.
- **Better search results.** Searching "jojo" now puts JoJo's Bizarre
  Adventure near the top instead of burying it behind obscure matches.
- **Quality switch timeout.** If a file can't be played after switching
  quality, the player shows an error and reverts to what was playing
  instead of loading forever.

## 2.1.5 — 2026-09-27 — Black screen fix and PiP subtitles

- **Black screen now shows an error.** If the video can't load (e.g.
  expired login), the player tells you instead of showing nothing.
- **Search bar fixed.** Letters no longer disappear while typing in
  the Watch search bar.
- **Watched episodes stay green.** Completed episode highlights no
  longer vanish after leaving and coming back.
- **Subtitles in picture-in-picture.** Captions now show in the PiP
  popup window.
- **Aspect ratio setting.** A Fit / Fill toggle in player settings
  for ultrawide monitors — Fill crops to fill the screen.
- **Right-click menu in Browse.** Right-click any title to watch it,
  view details, or add it to your library.
- **Smoother playback on large files.** Bigger buffer and automatic
  retry on glitchy segments.
- **Poison mode auto-saves.** The toggle saves instantly — no more
  Save button.
- **Continue Watching keeps near-finished episodes.** TV episodes
  no longer vanish at 90% — threshold raised to 95%.
- **Seeking feels snappier.** The progress bar jumps to the new
  position immediately instead of snapping back while it loads.
  Arrow keys respond faster too.

## 2.1.4 — 2026-09-26 — Subtitle improvements

- **Active subtitle name shown.** The captions button shows which
  subtitle is loaded instead of generic text.
- **"Wrong one?" moved to Settings.** Frees up space in the player
  bar — find it in Settings > Other.
- **Addic7ed subtitles.** TV shows now also search Addic7ed (via
  Gestdown) for more subtitle options.

## 2.1.3 — 2026-09-26 — Cleaner player UI

- **Cleaner player bar.** Removed the "Logged in" label. Quality
  files are now a dropdown instead of a row of buttons.
- **Highest quality selected by default.** The player picks the
  largest quality and file size automatically.
- **Subtitle tooltips.** Hover a subtitle to see the full name.
- **Wrong-episode subtitles filtered.** SubDL results for other
  episodes and season packs are now filtered out.

## 2.1.2 — 2026-09-26 — Full quality streams

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

## 2.1.1 — 2026-09-24 — Subtitle search and player polish

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
