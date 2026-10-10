# What's new

Notes for the next release go under **Unreleased**, aimed at whoever is using
the app — what changed for them, not what changed in the code. Sort them under
`### New`, `### Improved` and `### Fixed`, one short line each (no show names
unless they help), and put changes to one part of the app together under its
name: `- **Player**` with the changes indented beneath it.
Name the update on the heading line: `## Unreleased — Skip Intro and faster loading`.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number, date and that name. It refuses to run
without both.

## Unreleased

## 3.0.1 — 2026-10-10 — Official subtitles, films and fixes

### New
- **Subtitles**
  - Official English subtitles for anime, found automatically
  - English CC on the dub, following it word for word
  - Kept on your computer while you watch, for instant loading
  - Menu shows English only; add others from "More languages"
- **Anime**
  - OVAs, specials and films in the Specials tab, in release order
  - Anime films Showbox doesn't have play from Aniwave
  - Japanese audio with burned-in subtitles when there's no clean copy
- **Auto-skip** in the player skips intros and end credits by itself
- A warning when Showbox isn't signed in or its sign-in has stopped working
- A renewed Showbox sign-in is picked up by itself
- Diagnostics lists slow or refused lookups to other sites

### Improved
- **Speed**
  - Next episode starts straight away, from Aniwave too
  - Subtitles in seconds, Browse at once, search no longer waits on AniList
- Library cards are tidier and line up: status, what they're sorted by and how far you've got
- Update history rewritten short, sorted into New, Improved and Fixed
- **Watch Progress** folds watched episodes away
- The file button always says where the video comes from
- Search and Browse know a show is in your library from either site

### Fixed
- **Player**
  - Paused videos stay paused
  - Pausing after switching file no longer switches back
  - Your place shows inside intros and credits
  - Rewinding while paused moves the progress bar
  - Finishing an episode shows the next one in Continue Watching
  - Reopening a finished episode no longer resets it
- **Subtitles**
  - None switched on over the dub unless picked
  - Films get their own subtitles, not another film's
  - Blu-ray picture subtitles no longer show as blank
- **Episodes**
  - Seasons over 50 episodes list every episode
  - Long shows numbered properly (Black Clover)
  - Showbox hiccups no longer hide its files
- Watching an anime film opens the film, not the show
- Continue Watching posters from the right title

## 3.0.0 — 2026-10-09 — Catalog 3.0: a second source, dub captions, watch lists and TV

### New
- **Aniwave**
  - Second source for anime, in the same player and episode list
  - Plays on the computer, phone and TV
  - Shows Showbox doesn't have play straight from Aniwave
- **Player**
  - File button lists every copy and where it comes from
  - Accurate English dub captions (English CC)
  - Anime in Japanese starts with subtitles on
  - Autosync: adds the show, moves your episode on, marks it completed
  - "✓ Mark as completed" for anything not finished yet
  - Right-click an episode to mark it, everything before it, or a season watched
- **Watch lists**
  - Franchises in release order, with progress and Up next
  - Ready-made lists: MCU, Ultimate Marvel, Star Wars, DC Universe, Ultimate DC
  - Skip a title, show or hide extras, "↓ Jump to it"
- **Notes**
  - Search, tags, pins and sorting
  - Recently deleted (kept 7 days) and version history
  - Right-click a note to open, pin, tag or delete it
- **Library**
  - Hide, drag and reset the tabs
  - "⋯" buttons open the right-click options everywhere
  - Filters are remembered, even after closing
  - Stats as tiles, "↑ Back to top" on every list
- **Catalog on a Fire TV**, driven by the remote (Settings → Watch on TV)
- Episodes not out yet show greyed out with their air date

### Improved
- **Search and Browse**
  - One card per anime; its seasons, OVAs and specials fold into it
  - The main series comes before its later seasons
  - No stalling when AniList is busy
- **Seasons**
  - Shows Showbox splits in two are one list (JoJo's Steel Ball Run)
  - Anime parts with their own names are seasons of one show
  - Seasons added one by one in your library are merged (backed up first)
  - Episode names for shows TMDB counts as one long season
- **Player**
  - The picture fills the screen, under a top bar that hides
  - Watch button turns green much sooner
  - Autoplay waits for the very last frame
  - A closed episode list stays closed
- More English subtitles from SubDL
- Library, Notes and Watch list share one header
- A thin bar shows while a page loads
- Catalog's own confirm box for deleting
- "Not available" instead of "Not on Showbox"

### Fixed
- **Subtitles**
  - Season packs give the episode you're on, not episode 1
  - An episode's subtitle list no longer comes up empty
- **Continue Watching**
  - Posters for shows that had none
  - Removing a show keeps its watched episodes
  - Text lines up on every card
- JoJo's Bizarre Adventure is found on Showbox
- Notes keep their last keystrokes and move to the top right away
- Catalog reopens after updating
- A title page says when AniList is busy, not "Nothing found"
- Anime series are labelled Anime, not "TV Short" or "ONA"
- Quality labels no longer crowd the episode names

## 2.1.10 — 2026-10-05 — Skip Intro and smoother playback

### New
- **Skip Intro and Skip Recap** for anime, with intros marked on the progress bar
- **Next episode** button in the player
- Bigger subtitle delay steps (±0.5s and ±5s)

### Improved
- **Speed**
  - Continue Watching starts loading when you hover a card
  - Shows are remembered between sessions
  - The next episode loads ahead
  - Resuming no longer loads episode 1 first
- Lighter on the network while watching

### Fixed
- **Player**
  - Stalled videos get a fresh link, then show Retry instead of spinning
  - Error messages show below the top bar
  - The cursor hides properly in fullscreen
- **Subtitles**
  - Tags like `\an8` no longer show in the text
  - Lines meant for the top appear there; overlapping lines show together

## 2.1.9 — 2026-10-04 — Better search and Browse

### New
- Remove from library anywhere, by right-click or the × on a poster
- Release notes have titles
- "TV Series" tab in Browse

### Improved
- **Search and Browse**
  - Results rank by popularity
  - Obscure titles filtered out of trending and popular
  - Anime keeps going on "Show more"
  - Anime filters (year, sort, genre) work
  - Filters load faster
  - Actors moved into Browse
- **Watch**
  - Matches the year and sequel number strictly
  - Season and part titles open at the right season
  - Unavailable titles say so
- Friends page remembers where you were
- Posters load faster
- The cursor hides in fullscreen

### Fixed
- Error pages have a back button
- Newest first no longer shows empty shelves
- The actors page works again
- Anime films stay out of the Films tab
- Anime years show properly
- Browse survives AniList slowing it down

## 2.1.8 — 2026-10-03 — Stats and spacing

### Improved
- Library stats are easier to read

## 2.1.7 — 2026-10-03 — Browse overhaul and HEVC fix

### New
- **Friends tab** in your library, from a friend's shared catalog
- "+ Add" and "Watchlist" on hover in Browse
- Back to top button in Browse

### Improved
- **Browse**
  - Whole cards are clickable
  - Remembers your scroll and what you expanded
  - 60 titles per shelf and per "Show more"
  - "All time" shows real classics
  - Search forgives spaces and finds longer titles
  - Filters grouped in one dropdown
- **Library**
  - Stats show watched vs total per category
  - Year range moved into the Filter panel
- **Title pages**
  - Adding keeps you on the page
  - Watch button checks first, and says when it's not available
- Settings save as you change them
- Episode list scrolls to where you are
- Anime sorted under Anime everywhere, existing entries included

### Fixed
- 4K HEVC files play instead of failing
- Watch no longer opens a different title ("Peace" ≠ "War and Peace")
- Right-click menus stay on screen
- Unreleased films no longer show in Browse
- File errors show clearly over the video
- The filter dropdown stays open while selecting text
- Music and specials no longer outrank films and series

## 2.1.6 — 2026-10-02 — Continue Watching and player fixes

### New
- **Autoplay** the next episode
- Watched button in the player for "want to watch" films
- Mac: right-click → Open, and a fix-quarantine button

### Improved
- **Player**
  - Five minutes buffered ahead
  - Switching quality is instant and prepared ahead
  - Episode list follows the playing episode
  - Finished episodes resume on the next one
- **Continue Watching** keeps a show until it's finished, with "Up next"
- Smoother updates with a clear restart message
- Better search results ("jojo")
- Undo in Notes goes one step at a time

### Fixed
- **Player**
  - Seeking no longer snaps back
  - Arrow-key seeking doesn't build up lag
  - Smooth while another app is focused
  - Fresh link after a long pause, no endless loading
  - A file that won't play reverts instead of loading forever
- Continue Watching no longer breaks on bad data
- Typing in the library search keeps every letter

## 2.1.5 — 2026-09-27 — Black screen fix and PiP subtitles

### New
- Subtitles in picture-in-picture
- Fit / Fill for ultrawide screens
- Right-click menu in Browse

### Improved
- Smoother playback on large files
- Snappier seeking
- Poison mode saves instantly

### Fixed
- A black screen now says what went wrong
- The Watch search bar keeps every letter
- Watched episodes stay green
- Nearly finished episodes stay in Continue Watching

## 2.1.4 — 2026-09-26 — Subtitle improvements

### New
- Addic7ed subtitles for TV shows

### Improved
- The captions button shows which subtitle is on
- "Wrong one?" moved to Settings

## 2.1.3 — 2026-09-26 — Cleaner player UI

### Improved
- Files in a dropdown, highest quality picked first
- Hover a subtitle to see its full name
- Tidier player bar

### Fixed
- Subtitles for other episodes are filtered out

## 2.1.2 — 2026-09-26 — Full quality streams

### New
- **SubDL subtitles** (with a free key), labelled by source
- Resolution picker and stream info in the player
- Watched episodes marked with a green dot

### Improved
- **Player**
  - Full-quality streams, not the 360p preview
  - 10–15 seconds faster to load
  - Switching file keeps playing until the new one is ready
  - Every file listed, even at the same quality
- **Continue Watching**
  - Shows the next episode after one is finished
  - Catches short visits
  - Stays on the Notes page
- More subtitles found for anime
- Library search forgives punctuation ("Xmen", "rezero")

### Fixed
- Watched episodes are remembered
- Continue Watching posters for near-matching titles
- Subtitles on iPhone fullscreen, not doubled on desktop
- The progress bar resets between episodes
- Skipping to the end shows the last frame
- Buffering retries by itself
- Note image resize handle stays put
- Mac update errors are readable

## 2.1.1 — 2026-09-24 — Subtitle search and player polish

### New
- **Continue Watching** tab with posters, progress and time left
- **Player**
  - Next Episode button near the end
  - Watched episodes highlighted
  - Sync progress and quick-add to library
  - Cast for each episode
- Right-click menu on library entries
- Poison Mode (Settings → Personalization)

### Improved
- Subtitles carry over to the next episode, delay included
- Fuzzier search in Browse
- Watch progress grouped by title
- Fullscreen keeps the top bar while your mouse is on it
- Loading screen says what it's doing
- Repeat loads in under a second

### Fixed
- Expired streams recover after a long pause
- Wrong cast is corrected automatically
- Anime no longer under "Series" in Browse

## 2.1.0 — 2026-09-21 — Wide layout and better search

### New
- Wide layout option
- Fullscreen hides Catalog's own bars

### Improved
- Showbox search finds more titles
- Exact title matches preferred
- About 60 trending actors, opening inside the app
- Adding to library defaults to Completed

### Fixed
- Episode lists for shows like The 100 and The Pitt

## 2.0.0 — 2026-09-20 — Built-in player

### New
- **Built-in player**
  - ▶ Watch plays inside Catalog
  - Volume up to 200%, picture in picture, keyboard shortcuts
  - Quality picker and episode list with names
  - Subtitles from OpenSubtitles, with delay and upload
  - Your place is saved
  - "Wrong show?" to pick again
  - Cast in the player
- Trending actors
- Watch elsewhere (Miruro, CineJoy)
- Theme picker, including Black (OLED)
- Collapsible update history

## 1.7.0 — 2026-09-17 — Infinite browse

### New
- "Show more" on every Browse shelf
- Trending now / All time

## 1.6.1 — 2026-09-16 — Update fixes

### Fixed
- Update notices show behind a PIN
- Updates no longer report failure while working
- Installing an update says so

## 1.6.0 — 2026-09-16 — Browse and where to watch

### New
- **Browse**: trending titles with synopsis, cast and scores
- **Where to watch** in your country
- Sort, filter and add from a shared catalog

## 1.5.0 — 2026-09-16 — Better updates

### New
- Library link on every page
- Progress shown while details fill in

### Fixed
- Updates install properly

## 1.4.0 — 2026-09-16 — Clickable actors

### New
- Every actor is clickable
- Personalization settings
- Dots on Services and Updates when they need you

### Improved
- Runtimes, box office and scores fill in by themselves

## 1.3.0 — 2026-09-16 — Sorting that works

### New
- The sorted-by value shows on each card
- Update notices with "Not now" and "Don't ask again"

### Fixed
- Sorting by Longest

## 1.2.2 — 2026-09-16 — Automatic updates fixed

### Fixed
- Automatic updates, which had never worked

## 1.2.1 — 2026-09-16

### Fixed
- Updates stuck at "Waiting for Catalog to close"

## 1.2.0 — 2026-09-16 — In-app update progress

### New
- Update progress inside the app
- Settings → Updates lists what changed

## 1.1.0 — 2026-09-16 — Sharing and scores

### New
- Sort by IMDb, Rotten Tomatoes, Metacritic or box office
- Share your catalog with a friend
- Lock a note behind your PIN

### Improved
- Better cast lists for series

### Fixed
- Save as PDF

## 1.0.1 — 2026-09-15

### New
- IMDb, Rotten Tomatoes, Metacritic, age rating, awards and box office

## 1.0.0 — 2026-09-15

### New
- First release
