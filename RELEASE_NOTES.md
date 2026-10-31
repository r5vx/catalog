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

## 3.8.0 — 2026-10-31 — Catalog as a phone app, live captions timed by themselves, and mini player fixes

### New
- **Phones**: Catalog as an app on a phone's Home Screen (Settings → Phones gives the address and a code to scan)
- **Phones**: downloads can be kept on the phone and played with no connection, with captions
- **Phones**: each phone asks who's watching the first time, and keeps that person's Continue Watching and places
- **Mini player**: a fullscreen button, to fill one screen with it while using Catalog on another
- **Player**: a Hide button at the top of the episode list
- **Roku**: preview pictures while fast-forwarding and rewinding
- **Subtitles**: "Timing subtitles to the video…" shows while auto-timing works on them
- **Subtitles**: right-click a caption to copy it
- **Subtitles**: a Retime button in the captions menu works out the timing again
- **Player**: volume goes up to 300% for quiet videos, with loud parts kept from crackling
- **Live TV**: captions time themselves to the commentary, within seconds of a channel opening and more exactly as you watch
- **TV**: the computer says when Windows has set its network to Public (TVs can't connect then), with a button to set it back to Private

### Improved
- **Mini player**: opens on the picture and time it left off at instead of a black loading screen
- **Mini player**: resizes freely from any edge (it no longer grows diagonally when one side is dragged)
- **Mini player**: dragged by its title; the edges are left free for resizing
- **Subtitles**: the kind picked for a show goes on for each of its episodes, however the episode is opened
- **Subtitles**: the next episode's are picked from the same release when its file names differ, and timed on their own
- **Skips**: a recap and an intro back to back are one skip
- **Skips**: times also come from TheIntroDB, and from whichever site more people agree on
- **Skips**: black end credits are found from the progress bar's preview pictures, for any show or film
- **Skips**: end credits are looked for in more episodes when the next one's ending song is different
- **Player**: Japanese or the dub is remembered for each anime, not one choice for all of them
- **Subtitles**: captions appear right on time instead of up to a quarter second late
- **Library**: marking a show or film completed takes it out of Continue Watching
- **Player**: the volume set for a film or show is remembered on that device, and carries on to the next episode
- **Live TV**: several TVs on the same channel share one download of it, so a big game doesn't load the connection once per TV

### Fixed
- **Live TV**: missing on phones and narrow windows; it is now next to Browse and Downloads
- **Mini player**: no longer disappears behind a fullscreen game or app when clicked, and stays above it
- **Mini player**: Back to Catalog opens the video in Catalog when another page was opened meanwhile (it used to just close)
- **Mini player**: starts at the exact spot, even in the end credits (it used to start the film over)
- **Mini player**: captions sit at the bottom instead of the middle
- **Skips**: Chernobyl no longer has false intros (its title card was marked as one)
- **Skips**: no recap or intro taken from another cut of the episode (another country's version, say)
- **Subtitles**: ones carried on from the last episode that don't match are swapped for ones that do
- **Subtitles**: ones carried on to the next episode stay in the same language (a file named alike in German could go on)
- **Subtitles**: switching subtitles quickly shows the last one picked, timed afresh
- **Subtitles**: captions on in one episode stay on in the next, even when no file from the same release is found
- **Live TV**: no longer shows 0 games for a while after Catalog was closed for a day
- **Player**: an anime watched in Japanese no longer switches to the dub on an episode whose file has both
- **Subtitles**: the delay buttons' hints said the opposite of what they do
- **Mini player**: the picture handed over from the big player goes as soon as the video is ready, even paused
- **Player**: the progress bar's preview pictures match the copy playing (another cut's pictures showed before)
- **Library**: rewatching a show finished before episodes were kept marks it Rewatching, and counts the rewatch at the end
- **Player**: when a source's server is missing part of a video, the episode's other copy (same language, no subtitles in the picture) plays on from the same spot instead of buffering forever
- **Player**: the mouse pointer hides with the controls in fullscreen
- **Skips**: a copy the same length as another of the episode gets its intro and credits at once (Movy's credits were missing)
- **Player**: quality never drops by itself when part of a video fails to load; it stays on the quality picked (TVs and Roku too)
- **TV**: videos coming through the computer (Movy, 7Movies, Aniwave) load several parts at once over Wi-Fi, so heavier copies stop buffering
- **Player**: "Keeps stopping to load" only offers another source once that source has the episode

## 3.7.0 — 2026-10-27 — Downloads, Rewatching and Caught up, and faster Showbox starts

### New
- **Downloads**: download a film, episode or replay from the player to watch without the internet; pick its quality (720p and up) and its captions
- **Downloads**: captions auto-time on a download too, with no internet
- **Downloads**: a Downloads page to play them, delete them, or save one onto a phone (an iPhone keeps it in the Files app)
- **Downloads**: never from Showbox, so Febbox's daily allowance isn't used up; while Showbox plays, the same episode comes from 7Movies or Movy
- **Live TV**: opening a game that hasn't started shows when it starts, with Watch the channel now and Save; it plays by itself when the game begins (Roku: OK opens the game's box)
- **Library**: two new statuses: Rewatching, and Caught up (seen every episode out so far, more still coming)
- **Library**: starting a finished show again marks it Rewatching; finishing the latest episode of a show still airing marks it Caught up; finishing a rewatch counts it
- **Watch**: films still in cinemas can be watched when a source has them, with a note that copies are likely recorded in a cinema

### Improved
- **Player**: Showbox videos start much faster when Febbox's player page is slow to answer (a film that took 24 s now takes about 4)
- **Player**: a show keeps to the source you watch it on; another source only takes over when yours fails or takes over 15 s
- **Player**: auto-skip skips recaps too (computer, Fire TV and Roku)
- **TV**: Up from the progress bar goes to Skip Intro, Skip Recap or Next Episode when one is showing
- **Live TV**: the schedule and channels are kept, so they still show when the site can't be reached for a while

### Fixed
- **Live TV**: Schedule and Channels showing 0 on a computer that couldn't reach the site; it's now also asked through Catalog's own browser
- **Live TV**: two channels being looked up at the same time could both fail to play

## 3.6.0 — 2026-10-26 — Live TV and replays, more Showbox accounts, and Roku

### New
- **Live TV**: today's and tomorrow's games by sport (football, basketball, soccer, hockey and more), with the channels showing each; about 900 channels; plays on the computer, phone and TVs while Catalog runs on the computer
- **Live TV**: search games, teams, leagues and channels; save a game or channel to watch later; Watched lately
- **Live TV**: plays in Catalog's own player, like everything else; switch to another channel showing the same game from it
- **Live TV**: turn on the captions a channel carries (most American channels have them)
- **Live TV**: Replays of past games: NFL, college football, NBA, WNBA and soccer, in Catalog's player with no ads, and a choice of versions
- **Live TV**: right-click a game or channel to watch, save, or see more of that sport
- **Showbox**: add more Febbox accounts in Settings → Services; each video uses the one with the most HD left today, so several TVs can watch without dropping to 360p
- **Live TV**: games show both teams' logos on their colors (or the sport's picture), on the computer, TVs and Roku
- **Live TV**: pick the sports Live TV shows the first time; only those show, and + changes them
- **Live TV**: live scores on games, refreshed every minute; a finished game leaves On now
- **Live TV**: favorite teams (right-click a game, or the menu button on a TV); their games come first, under Your teams
- **Live TV**: one click plays a game on its best channel, learned from what played well; the TV's menu button lists the others
- **Live TV**: TV shows (Jeopardy!, Family Feud, SNL, late-night shows) have their own section, each with the show's own picture
- **Roku**: a Catalog app for Roku TVs, laid out like the Fire TV one (menu, Home, Movies, TV Shows, Anime, My Library, Live TV and replays, Search, Settings), installed in developer mode

### Improved
- **Player**: keeps up better on a busy connection (a big download running): more of a Showbox video is fetched at once while it's coming in slowly
- **TV**: auto-timing works on 7Movies and Movy, and the TV runs lighter with subtitles on
- **TV**: only one menu is open at a time (sources, settings, subtitles), and Back closes it instead of leaving the episode
- **Player**: 7Movies and Movy episodes download onto the computer as they play, far ahead of where you are, so their slow moments don't stop the video (on TVs too)
- **Player**: the next 7Movies or Movy episode downloads while you watch, so it starts straight away
- **Player**: the progress bar shows, in a lighter shade, how much of a 7Movies or Movy episode the computer has downloaded
- **Live TV**: a channel that won't play on one of the site's servers tries the next
- **Settings → Storage**: shows the episodes downloaded ahead, with its own limit (20 GB unless changed); a watched episode's download goes a few minutes after it ends
- **Player**: playback stats show how much of the episode the computer has downloaded
- **TV**: on Live TV the sport picked is highlighted
- **Player**: "Keeps stopping to load" offers to play the same spot from another source
- **Live TV**: Channels starts on your country from Where to watch (Settings → Services); search still finds every country
- **Live TV**: only games shown in your country (Where to watch), with Other countries to see the rest
- **Live TV** and **Replays**: open straight away, kept ready in the background
- **Replays**: a condensed game is only played when the full one isn't ready yet, and says so (on its card too)
- **Replays**: only the versions that play are listed, named for what they are (Full game or Condensed, and the site)
- **Replays**: a game that can't be played yet isn't listed until it can
- **Replays**: pick up where you left off, from Continue Watching too
- **Live TV**: Recently watched: the replays (how far you got) and channels you watched lately
- **Player**: auto-timing fits films with quiet talking under loud sound (Hurt Locker), and never undoes a timing that's been fitting
- **Player**: "Rate it" asks after you leave the player, not over the end of the film
- **Live TV**: the caption delay you set is kept for the next game
- **TV**: Replays show each game's picture
- **Player**: 7Movies' HEVC copy downloads onto the computer ahead too
- **Mini player**: every control the big player has: volume, subtitles and their timing, settings, the copy playing
- **Settings → Playback**: a video going back by itself is noted, with what happened just before
- **Settings → Playback**: each stop says how long it lasted, what the player was waiting for, whether the picture kept up, and what happened just before
- **Settings → Playback**: switching source, episode or quality no longer counts as a stop

### Fixed
- **Player**: an anime's dual-language copy is picked again, so the dub you were watching comes back
- **Player**: Skip Credits covers the whole ending song when the databases know it, not just the part two episodes share
- **Live TV**: Back from a game or replay goes back to Live TV, not the search
- **Replays**: open on a loading screen, not the search page first
- **Replays**: Dailymotion copies play again
- **7Movies**: the HEVC copy no longer freezes the picture for a few seconds while the sound goes on (its faulty frame times are mended)
- **Player**: a gap in a copy's picture is skipped instead of a still picture over the sound
- **7Movies**: the HEVC copy plays smoothly, with no stutter every few seconds (its frames were shown out of order)
- **7Movies**: no skip where the part loaded after a jump meets the part loaded before it
- **Player**: auto-timing no longer flips the subtitles back and forth between two delays

## 3.5.0 — 2026-10-24 — Rate it, mini player, and fewer stops

### New
- **Your library**: rating, status, favourite, times watched and the episode you're on change with one click on a title's page, no Edit and Save
- **Your library**: "Season reached" and "Episode reached" are dropdowns that fit the show's own seasons and episodes
- **Player**: when you finish a film, or a series' last episode, you can rate it right there
- **Mini player**: a small Catalog window that stays on top in the corner, with its own buttons and nothing dimmed; Catalog carries on where it got to (on the computer)
- **Mini player**: previous and next episode buttons, and it stays open from one episode to the next

### Improved
- **Your library**: the edit page is tidier, with only what isn't on the title's page under "More details"
- **Continue Watching**: once most of an episode is watched, the card moves on to the next one, "Up next", even if you stop during the credits
- **Player**: the Showbox copy you pick for a show (both languages, or Japanese only) is picked again for its next episodes
- **Player**: when the Showbox copy is slow to start, Showbox's other copy is tried before another source, and a copy with subtitles in the picture only plays if nothing else answers
- **Settings → Playback**: each stop shows how far ahead the picture and the sound each were

### Fixed
- **Player**: Showbox videos that come as a single file play with sound, and show their length after the previous episode
- **Player**: a video piece that failed to download no longer stops the video from loading until it stalls
- **Player**: when an episode has two copies in the same quality, the bigger one plays, rather than whichever Febbox lists first
- **Continue Watching**: an episode ticked as watched by hand goes on to the next one, instead of playing again from the start and losing its tick
- **Player**: an episode you pick plays, even one already watched, rather than sometimes jumping on to the next
- **Player**: signing in to Showbox with another account no longer keeps the last account's used-up daily limit and 360p links
- **Library**: pointing at a studio or tag on a title's page no longer filters your library by it
- **Library**: titles finished in the evening are dated that day, not the next

## 3.4.2 — 2026-10-23 — Moving Catalog to your account

### New
- **Updates**: Catalog installed for all users can move itself to just your account (Settings → Updates), so updates install by themselves; the library, profiles and TVs stay as they are

### Improved
- **Player**: an episode only 7Movies or Movy have starts looking for its link as soon as you point at Watch (Movy can take 20 s)

### Fixed
- **Player**: a source that can't play the episode says so in a passing message while the one playing carries on, instead of a red line that never goes
- **Player**: the stream info is about the copy that's playing, not one tried before it

## 3.4.1 — 2026-10-23 — Subtitles that fit, and fewer dead ends

### Improved
- **Player**: when Febbox's daily HD allowance is used up, it says so and roughly when it resets, and plays another source's HD copy straight away until then
- **Player**: "Keeps stopping to load" has a Show details button, for a photo of what's slow (on the TV too)
- **Subtitles**: the ones made for the version of the film that's playing come first (Deadpool 2's cinema version and its Super Duper Cut)
- **Films**: a film only in cinemas says "In cinemas" instead of offering Watch, and no source is searched for it

### Fixed
- **Player**: auto-skip no longer skips an ending or intro with the story still going on over it, and the TV waits for the end of it before the next episode
- **Player**: Showbox files are no longer remembered as "360p only" because Febbox's daily allowance ran out
- **Player**: while another episode loads, the one before is hidden and can't be played under the new one's name
- **Player**: picking a source while an episode is still loading switches to it straight away
- **Episodes**: a new episode is listed once it has aired in the US, not from the morning of its air date (SVU S28E3 played another episode)
- **Showbox**: a wrong Febbox password no longer shows as "Logged in"
- **Subtitles**: when OpenSubtitles stops a connection's downloads for the day, its subtitles come through Stremio's copy of it instead of saying they're unavailable

## 3.4.0 — 2026-10-22 — New episodes in Continue Watching

### New
- **Continue Watching**: a show you've caught up with comes back when a new episode can be played, marked "New episode" (on the TV too); the mark can be dismissed
- **Settings**: a background picture behind every page (Personalization → Background), with Dim and Blur

### Improved
- **Player**: Skip Intro and Skip Credits work on every source now (7Movies, Movy, Aniwave), not only Showbox, on the TV too
- **Player**: intro and credits times also come from Anime Skip and IntroDB, which cover many shows AniSkip doesn't (Dungeon Meshi, Bleach, SVU)
- **Player**: a source that's slow to answer no longer holds an episode up: after 5 seconds another copy in the same language plays
- **Player**: another episode can be picked while one is still loading
- **Player**: on Japanese audio, English subtitles made for the Japanese release come first and turn on by themselves; on the dub, English CC comes first
- **Continue Watching**: a show only leaves when you've watched its last episode out, or remove it — not because it's marked completed
- **Player**: marking episodes watched also moves the show's "episode reached" forward
- **Player**: auto-timing starts listening as soon as the video plays, so subtitles are usually timed the moment they're turned on

### Fixed
- **Player**: picking another episode stops the one playing at once; it used to play on under the new episode's name, and its place could be saved as the new episode's
- **Player**: when the picture freezes while the sound plays on, it's put right by itself (and noted in Settings → Playback)
- **Showbox**: shows had no Showbox episodes after Febbox changed how it lists folders
- **Player**: when a copy won't play, it no longer switches to the English dub by itself (only when the dub is all there is, and it says so)
- **Player**: Next Episode starts at once on 7Movies and Movy too (their next link is fetched ahead)
- **Player**: "Video failed to load" no longer sticks on 7Movies and Movy; a fresh link is fetched instead
- **Player**: "These subtitles don't match" waits until enough has been heard, so it no longer shows for subtitles that fit
- **Player**: auto-timing no longer moves subtitles on too little evidence, and puts them back if they turn out not to fit (Venom 2 was moved 22 s)
- **Player**: subtitles made for cinema recordings (CAM, TS) are listed last, as they're timed to another version of the film
- **Player**: more subtitle adverts and credits are removed (getray.app, tryray.app, explosiveskull, "Captioned by…", "Subtitles by…" and others)
- **Player**: real lines that looked like adverts are kept ("The Central Park Zoo proudly presents", "Awww..")
- **Subtitles**: when OpenSubtitles says the day's download limit is reached, it's left alone for a few hours instead of asked again
- **Player**: subtitles picked to go on by themselves for Japanese audio no longer go on for the dub too
- **Player**: subtitle files that came scrambled (lines of random letters) are skipped, and another English track is used
- **Player**: in full screen, the top bar stays up while moving from the cast or episode list to its button

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
