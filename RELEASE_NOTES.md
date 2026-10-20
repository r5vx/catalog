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

## 3.3.0 — 2026-10-20 — More like this, faster starts, less buffering, and hands-free updates

### New
- **Titles**: More like this under every film, show and anime (and on the TV), matched on taste, topic, genre, director and series together; watched ones are marked
- **Titles**: a Show watched switch beside More like this hides what you've seen, and Show more at the end of the row adds more
- **Titles**: right-click a More like this poster to watch it, open it, or add it to the library
- **Player**: Playback stats (in the player's settings) show how fast each piece is arriving, from which server, how much is loaded ahead, and what else is downloading
- **Settings**: Playback lists every time a video stopped to load — on this computer or a TV watching through it — with those numbers and a best guess at why

### Improved
- **Player**: videos start sooner: a title's page starts finding the video a moment after it opens (as does the TV's highlight resting on Play or an episode), and a show's episode link is fetched while the rest is still loading
- **Titles**: More like this shows up sooner: it starts as a title's page opens, and is kept for a month once worked out
- **Titles**: More like this marks anime you've watched or are watching too, and shows each anime once rather than once per season (Frieren)
- **Subtitles**: SubDL taken out of Services: one key fewer, and subtitles come from OpenSubtitles and Addic7ed as before
- **Updates**: install by themselves with no click needed — at night, or once one has waited 6 hours, whenever nothing has played for half an hour (on unless turned off in Settings → Updates)
- **TV**: after Catalog updates, the TV shows Reload (and reloads by itself if the remote isn't touched for 10 minutes), so the TV app never needs force-stopping

### Fixed
- **Player**: Showbox videos start several seconds sooner in the app: it reads Febbox's new player page straight away instead of waiting on a hidden window first (Primetime took 12 seconds)
- **Player**: Showbox videos that loaded forever play again: Febbox changed its player page, and Catalog picked an old sample link out of it instead of the real one
- **App**: closing Catalog closes it completely, even while it's looking something up in the background — opening it again no longer shows "Object has been destroyed"
- **Player**: less stopping to load when a site's servers are busy (evenings): the next pieces of the video are fetched ahead, three at a time instead of one, on every source — by the player for Showbox, by the computer for 7Movies, Aniwave and Movy
- **Player**: a video piece the site doesn't answer for is asked for again after 4 seconds, instead of the video waiting up to 30 seconds or more (one SVU piece took 53 seconds)
- **Player**: the progress-bar pictures no longer download sound they never use (half their downloads)
- **Player**: Movy videos no longer have pieces refused when the progress-bar pictures are being made
- **Subtitles**: captions that showed nothing (Madagascar) work again: when OpenSubtitles sent back an error page instead of the file, Catalog kept it as the subtitles; now it's thrown away, the next file is tried, and picking one that can't be loaded says so
- **Subtitles**: captions come back on when an English film is resumed (Madagascar 2) — only anime in English leaves plain subtitles off
- **Subtitles**: another advert taken out of captions ("Watch Online Movies and Series for FREE")
- **Player**: the settings gear lights up while its menu is open, like the other buttons

## 3.2.0 — 2026-10-17 — Movy, smoother 7Movies on TVs, and Mac updates without Terminal

### New
- **Player**: Movy as a fourth source, mostly for older films the other sources don't have, up to 1080p (found by the computer Catalog runs on, so TVs get it too)
- **Updates**: on a Mac, Catalog downloads and installs its updates itself, with no Terminal step (from this version on)

### Improved
- **Watch**: while it checks whether something can be watched, each site shows under the button as it's looked through (Showbox, 7Movies, Aniwave, Movy), all at once; Watch appears the moment one has it, and the row stays to show which sites do
- **Player**: when Showbox doesn't have something, every other source is asked at once instead of one after another

### Fixed
- **Player**: 7Movies episodes that kept stopping to load on a TV (SVU's newest) play smoothly: their long video pieces come in short parts (and if that ever gets stuck, the video goes back to whole pieces by itself)
- **Player**: a TV on slow Wi-Fi no longer has video pieces cut off partway and downloaded again
- **TV**: the top bar in the player hides again while watching
- **TV**: a show's page opens with all its seasons (all of Bleach's) straight away, kept from last time, instead of only after opening an episode

## 3.1.0 — 2026-10-17 — Whole-episode subtitle timing, Skip Intro for more shows, and right-click to paste

### New
- **Player**: Skip Intro and Skip Credits for episodes AniSkip doesn't have, found by comparing the episode's sound with the next one's
- **Library**: search finds anime by either name ("Dungeon Meshi" finds Delicious in Dungeon), and films by their original titles
- **Subtitles**: Bold in the captions menu's Look
- **Player**: the copy you pick (Aniwave with subtitles in the picture, say) stays picked for the show's next episodes
- **Typing**: right-click in any text box for Cut, Copy, Paste, Select All, Undo and Redo, and right-click selected text to copy it (desktop app)
- **Notes**: lists as in Google Docs: "- " or "1. " at the start of a line starts one, Enter goes on to the next bullet or number, Enter on an empty one ends it, Tab and Shift+Tab move an item in and out; lists typed out by hand carry on numbering too

### Improved
- **Subtitles**: auto-timing is on to start with, hears the whole episode at once (about 20 seconds) instead of waiting minutes, and times each part on its own, so a break cut differently no longer throws it off
- **Subtitles**: Reset goes back to auto-timing's delay after moving it by hand
- **Subtitles**: auto-timing works on every source (Aniwave, 7Movies, Showbox's low-quality copies) from the sound the player downloads anyway, nothing extra
- **Subtitles**: auto-timing spots subtitles made for another speed (DVD subtitles that drift further off as a film goes on) and stretches them to fit
- **Subtitles**: an episode heard once is remembered, so watching it again (or on another screen) is timed straight away
- **Subtitles**: switching subtitles with auto-timing on re-times them straight away
- **Subtitles**: when the subtitles Catalog picked by itself don't match the video, it switches to ones that do (with auto-timing on)
- **Player**: when a video keeps stopping to load, asks whether to try a fresh link, drop to a lower quality, or keep loading
- **Player**: a Showbox file that only comes in 360p plays from another source's HD copy instead, and says so
- **Player**: anime plays in Japanese to start with (the dub once you've picked it); films with a Japanese dub don't
- **Watch**: the availability check answers within about 12 seconds, and a slow "no" turns into ▶ Watch if the title shows up a moment later
- **Player**: Skip Intro goes away as the intro ends, not several seconds after
- **Subtitles**: the captions menu lists five files to start with, with Show more for the rest
- **Subtitles**: captions turned off for a show stay off for it, and never come on over subtitles in the picture
- **TV**: Up from the player's buttons highlights the progress bar, where left and right skip 10 seconds
- **TV**: auto-timing works on the TV (the computer hears the episode for it)
- **TV**: Skip Intro takes the highlight when it appears, so OK skips
- **TV**: Auto-skip is on to start with, and works for shows AniSkip doesn't know (the computer finds the intro)
- **Notes**: deleting a page that was never written on goes for good, instead of into Recently deleted
- **Player**: a film watched to the end is marked completed (added to the library if it isn't there), as a show is when its last episode ends; only when most of it actually played, so skipping to the end doesn't count (with Autosync on)

### Fixed
- **Subtitles**: AnimeTosho no longer offers another show's subtitles (Thousand-Year Blood War's for Bleach)
- **Subtitles**: subtitle sites' adverts and credits ("Watch Online Movies and Series for FREE www.osdb.link", "Support us and become VIP member") are taken out, without moving the rest
- **Febbox**: signing in with an email code no longer gets covered by a debug screen halfway through
- **Player (Mac)**: menus no longer vanish while subtitles are showing
- **Watch**: no longer freezes on "Searching…" for some titles
- **Showbox**: files no longer vanish when Febbox is refusing for a moment (Spider-Man: Brand New Day): the last list it gave is used, or another source plays and Showbox's files join when Febbox allows
- **Showbox**: Catalog asks Febbox far less often (folders two at a time, recent answers reused), so it's refused much less
- **7Movies**: its HD copies play again (they'd moved to a server Catalog wouldn't fetch from): Law & Order: SVU S28E2, Madagascar
- **Sidebar**: the Continue Watching count goes down as soon as something is taken off it
- **Where to watch**: no longer stuck on "Checking…" when a service is listed twice (Astro Boy)

## 3.0.7 — 2026-10-12 — Browse without AniList, a sidebar, auto-timing for subtitles, and a much smaller library file

### New
- **Sidebar**: every part of the library, Browse and Settings in a sidebar on every page, with the layout wide; it's the new look, and Settings → Personalization → Layout turns either back (the library's tabs show again without the sidebar)
- **Storage**: Settings → Storage shows what Catalog keeps to load faster, lets you choose how much (100 MB to 2 GB, each kind with its own share so none crowds out the rest), and clears it
- **Subtitles**: "Auto-timing" in the captions menu (off to start) listens to the episode and moves subtitles that are early or late to match the talking, and keeps following them if they jump
- **Where to watch**: each service shows its name and opens it, searching for the title

### Improved
- **Library**: a title's page has the big Watch button under the scores, the same as from Browse
- **Library**: the tabs have their own icons instead of emoji
- **Library**: the sidebar's sections are the library's tabs, with their counts: drag to move them, right-click to hide one, "…" to bring hidden ones back
- **Library**: Friends, Watch list and Notes no longer show the "Watched … of …" boxes
- **Posters**: sharper on high-resolution and scaled screens (a bigger copy is used where the screen needs it)
- **Anime**: titles added from AniList move to TMDB's copy by themselves (your ratings, notes and progress stay), so Skip Intro, cast and voice actors no longer need AniList either; Skip Intro's lookups come from Kitsu
- **Library file**: subtitle files kept with fonts and animated song lyrics inside are slimmed (one was 32 MB, now 235 KB), and the space is given back: the library went from 190 MB to under 10 MB
- **Subtitles**
  - Every episode of a long show finds its subtitles: only the first hundred of the show's were looked through before (Bleach went from 2 English to 4, and other languages)
  - Long anime numbered differently by the player (Bleach S6E13 is episode 122) are searched under both numbers
  - Subtitles that run on well past the end of the video (made for a different copy, so they drift) are passed over for one that fits
- **Browse**
  - Titles open and go back in a couple of seconds at most; the IMDb and Rotten Tomatoes scores held them up for as long as fifteen
  - "Show more" asks for its pages together, and says so if they don't come, instead of spinning or saying that's everything
  - Trending actors are the stars of what's trending this week, not TMDB's list (which had people from two 1998 films at the top)
  - Anime comes from TMDB, like films and TV, so Browse and search no longer wait on AniList (which turns Catalog away after thirty questions a minute); ecchi is still left out

### Fixed
- **Subtitles**: one-episode specials like One Piece Heroines play as films and find their subtitles (they had none), wherever they're played from: the library, Browse, people's pages, a friend's list, the TV
- **Browse**: no Watch for something that isn't out yet (VisionQuest), and adding something whose release date is still to come always makes it "Want to watch", however it's added
- **People**: anime voice actors show the other anime they're in again (AniList changed how it answers, and every one had nothing)
- **People**: an actor's page no longer says 404 while AniList is busy; their other roles are kept for a week
- **People**: back from an actor opened in Browse's Actors goes back there, not to the library, however many titles and actors you went through

## 3.0.6 — 2026-10-11 — Subtitles your way

### New
- **Subtitles**: choose how they look in the captions menu — with or without the dark box, and four sizes

### Improved
- **TV**: no "Upload subtitle file", since there's no file to pick on a TV

## 3.0.5 — 2026-10-11 — Night updates, family-friendly browsing and Bleach's seasons on the TV

### New
- **Updates** can install by themselves at night (off unless turned on; 4 AM, or another hour): Settings → Updates, or Updates on the TV

### Improved
- Catalog looks for updates every four hours while it's open, not only when it starts
- Browsing anime leaves out ecchi (suggestive) shows; searching still finds them
- **TV**: subtitle timing (sooner or later, half a second at a time) at the top of the captions menu

### Fixed
- **TV**
  - OK sometimes brought up the buttons instead of pausing, and they wouldn't go away
  - A show the player splits into its own seasons (Bleach: 18) shows those seasons and episodes on its page, not TMDB's two

## 3.0.4 — 2026-10-11 — Faster resuming, previews and a better TV

### Improved
- **Player**
  - Resuming starts loading right where you left off, in the quality that plays: no waiting for the start to load first
  - The progress-bar preview works like a streaming app's: pictures across the whole video are gathered while it plays, so moving along the bar shows one at once
  - Dragging along the progress bar or fast-forwarding marks where you were, with its time
  - Preview pictures are kept, so a video opened again shows them from the first second; the poster shows until there's one
  - The computer gets the next episode's pictures ready, and makes them for whatever a TV is playing
  - On the TV, fast-forward shows the picture of where it's got to
- Settings → Watch on TV says plainly that the TV layout is only for the TV app
- **TV**
  - "Who's watching?" every time the TV app opens, and again after it's been left for half an hour (TV app 1.3)
  - Watch again on Home, and rows by kind (Comedy, Drama, Romance…) in Movies, TV Shows and Anime
  - The menu button (☰) on a poster: mark it watched, remove it, take it off Continue Watching, add it to My List
  - Updates in Settings: which Catalog this is, check for and install updates, what's new
  - Continue Watching opens the show's page (Resume and its episodes) instead of playing straight away
  - Back on Home opens the menu even on the old TV app
  - Sharper big pictures behind the title
  - With the menu open, the whole screen dims (it was a dark box in the middle)
  - Settings has a gear
  - Holding an arrow moves along a row as it goes, not only after letting go
- A title's page opens even when AniList is busy (right after Catalog starts), from what was saved last time
- **Updates**
  - Installed "for all users" (Windows asks permission): the installer shows its window instead of failing unseen, and closing Catalog no longer tries
  - An update that didn't install says so, with a link to download it

## 3.0.3 — 2026-10-10 — 7Movies, episodes and the remote on the TV

### New
- **7Movies**, a second place to watch films and TV
  - Asked alongside Showbox for everything: its copies are in the file list for every film and episode
  - Plays what Showbox doesn't have, or hasn't got yet (Thor: Love and Thunder, the newest SVU)
  - When a copy won't play, the next source's is tried by itself
  - HEVC copies only on TVs and computers that can play them
- **TV**
  - A show's seasons and episodes on its page: pick one to start there
  - Fast-forward and rewind with one press; press again for faster, play/pause to stop
  - The Next Episode button counts down and is highlighted, so OK plays it at once

### Improved
- **TV**
  - Back on a menu screen opens the menu, then goes Home, instead of leaving Catalog
  - Captions on from the start for everything
  - Ten seconds into an anime's closing credits, the next episode starts
  - TV app 1.2 for Back and fast-forward (reinstall it once from Downloader)

### Fixed
- Every open page asked for updates hundreds of times a second
- **TV**
  - A highlighted poster no longer covers its name in My Library and Search
  - An episode that sticks in its last seconds moves on instead of starting again

## 3.0.2 — 2026-10-10 — TV layout and profiles

### New
- **TV layout** on the Fire TV, like Netflix
  - Menu down the side: Search, Home, Movies, TV Shows, Anime, My Library
  - Rows of posters with a big banner about the highlighted one
  - One big, bright highlight that's easy to follow from the sofa
  - Its own on-screen keyboard for searching
  - Title screens with Resume, From the start and My List
- **Profiles** on the TV: "Who's watching?" when the TV app opens
  - Everyone gets their own Continue Watching, episodes watched and My List
  - Add, rename, recolour or delete them from the picture at the top of the menu
  - The computer's own library stays the first profile's
- Number keys for the PIN on the TV
- Switch it on or off in Settings → Watch on TV, and preview it on the computer
- A picture of where you are when hovering or dragging the progress bar
- Rename a friend's catalog
- Finishing a film from a show's Specials marks the film watched (with Autosync)

### Improved
- **Player on the TV**
  - Only the buttons a remote needs
  - Autoplay and Autosync on from the start
  - The picture gets the whole screen; Episodes opens the list
- The TV app's icon is a plain pink tile (reinstall it once from Downloader)

### Fixed
- Older series found on Showbox (Law & Order: Special Victims Unit)
- A finished show leaves Continue Watching
- Reopening a finished last episode starts it from the beginning, not the end
- Episodes that arrive at 360p get a better-quality link

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
