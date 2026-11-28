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

## Unreleased — Subtitles that stay in time

### New

- Tubi as a source: free films and TV shows from Tubi appear alongside other copies (desktop app only)

**Catasong**
- Guess the Anime has an Easy mode with four multiple-choice answers to pick from

**Settings**
- Settings → Playback lists every source Catalog uses, grouped by type

### Improved

**Player**
- AllAnime's Cloudflare check is solved automatically instead of needing a manual click (Settings → Playback to turn off)
- Sources are checked automatically when you open the source picker instead of needing a button press
- Source chips on title pages stay steady while checking instead of flickering between states
- The Watch and Download buttons stay put once a source is found

**Online**
- Edit profile can change or remove your profile picture

### Fixed

**Online**
- A new profile picture shows in the sidebar and top bar straight away

**Player**
- Subtitles that slowly drift out of time through an episode now stay in time all the way through
- Shouted lines written in capitals stay at the bottom with the other subtitles instead of jumping to the top
- KickAssAnime streams load more reliably when the player page format changes
- Source health check reports are more accurate

## 4.8.1 — 2026-11-26 — Skipping fixed after the next episode, and friend codes on profiles

### New

**Online**
- Every friend's code is on their profile, with Copy, to send to someone who wants to add them; right-click a friend's card for Copy friend code

**Settings**
- Watch progress: right-click a film or show to remove all of its progress at once

### Improved

**Live TV**
- Replays → From sports channels only shows videos YouTube says are still up, with no "check and play" line on each card

**Online**
- Names on friend cards with a banner stand out from the picture, gradients included

**Settings**
- Clear all watch progress sits at the bottom and asks you to type DELETE first
- Sports replays in Watch progress are one row, not a list with "S0E0" in it

### Fixed

**Player**
- YouTube copies and channel replays show their full length on the bar at once, instead of growing a few seconds at a time
- A YouTube copy no longer counts as watched or moves to the next episode when it catches up with what's loaded so far
- After moving to the next episode, the bar could read "0:00", captions went away, every skip went back to the start and the place wasn't saved: fixed
- Skipping, fast-forward and rewind no longer send a video back to the start when the player lost track of its length
- A skip that ends up somewhere other than where it was aimed is sent as a problem report

**Live TV**
- A sports replay moved to the mini player is no longer saved a second time as a film

## 4.8.0 — 2026-11-26 — YouTube as a source, Pluto TV, online status and Xumo Play

### New

**Sources**
- YouTube is a source: about 700 films and 4,600 TV episodes uploaded in full by their own channels, matched to the exact film or episode
- YouTube copies show under Watch and in Files beside the others, and play in Catalog's own player on the computer; iPhone and iPad open the upload in YouTube
- YouTube's auto-generated captions can be picked in Subtitles and audio, timed in Catalog's own caption style
- Pluto TV is a source: its free films and shows play in Catalog's player, on TVs and phones too
- Plex's free films and shows are a source, with no account
- KickAssAnime is a new anime source, with Japanese audio and English dubs
- Xumo Play is a new source: its free films and TV shows play in Catalog's own player, with no adverts
- Xumo Play's own English captions come on by themselves when its copy plays
- AllAnime is back: Cloudflare's check opens inside Catalog, and anime episodes that only AllAnime has can play again

**Live TV**
- Free TV: over 450 Pluto TV channels by category, with what's on now, what's next and how far along it is
- Replays → From sports channels: full matches, races and events from sports channels' own uploads, with thumbnails

**Browse**
- Actors searches everyone on TMDB, not only people in your library, and marks the ones in it

**People**
- A person's page has their biography, age, birthplace and what they do, with Movies / TV / Acting / Crew filters and sorting
- Composers, directors and writers show the work they did, not only parts they played

**Titles**
- A big backdrop across the top of the page, and a Trailer button

**Online**
- A status on your My profile picture: Online, Away, Do not disturb or Invisible, picked from the dot in the top bar or the status button in the sidebar. Friends see a green, yellow, red or grey dot on your picture; Invisible shows you as offline and hides what you're watching, and Do not disturb stops message pop-ups
- Invite to watch together, the small button in a friend's card: it starts a room and whispers them its code, with a Join button on their side

**Player**
- Settings → Playback → Picture: draw video without the graphics card's overlay, for a picture that jumps or flickers on one computer

### Improved

**Browse**
- Results load by themselves as you scroll, with no Show more button (also on people's pages, friends' libraries and More like this)
- Search answers sooner, and offers a spelling fix when a misspelled name finds nothing; / jumps to the search box
- Genre and sort filters show every match, not only the last year's titles

**Home**
- Films and shows sit above the anime calendar

**Titles**
- Anime-only sources are left out on films and shows, and sources that don't have it fold under one button

**Live TV**
- Channels show what game is on with real pictures, and whether each channel is online
- Replays: more channel replays load by themselves as you scroll
- Replays: each channel replay says what it is (Counter-Strike 2, League of Legends, Rainbow Six Siege…), with the match, the event and the date

**Online**
- Friend cards show the friend's banner, are opened with a click anywhere on them, and only say what they're watching
- The Friends tab shows how many friends you have
- The status button under My profile is just the dot and its name

**Player**
- A copy missing a part, or one that fresh links can't get playing, now moves on through the episode's other copies instead of staying stuck
- On a TV, the player waits longer for each part of the video before asking again, so slow Wi-Fi can still start a video

**Look**
- Titles with no poster show their name on a dark card instead of a grey box
- Settings opens on cards for each part, and the library's folder can be copied

### Fixed

**Sources**
- Pluto TV films that wouldn't play now do
- AllAnime no longer opens while another anime source is playing
- Live TV's schedule showed no games when its site moved

**Player**
- A paused video is no longer reported as stuck loading
- The next episode starts with the subtitles made for its own copy, not ones like the last episode's that can be out of time
- Subtitles made for the copy playing are no longer swapped for another release's when auto-timing thinks they don't match
- Subtitles retime while paused and right after switching copies
- Captions that come on by themselves skip files typed all in capitals when a normal one is there
- Watch along jumps to where your friend is, even when your copy of the film goes by a slightly different name
- Streaming Catalog on Discord keeps its frame rate while the window is covered or the screen is locked

**Titles**
- A show's season count under its name matches its season buttons (a long show said 2 seasons while showing 18)

**Browse**
- Letters typed in the search box are no longer taken away when an earlier search comes back

**Messages**
- The quick-reply box no longer fills with old messages; they're under All messages
- Escape in the chat box closes the box instead of leaving full screen

**Phones**
- A phone that can't reach Catalog says what to check: Tailscale on the phone, and the computer awake with Catalog open
- Catalog on a phone can't get stuck pinched in, with pages wider than the screen

## 4.7.2 — 2026-11-23 — Showbox plays on Fire TVs again, and remembered profiles

### New

**TV**
- "Remember this profile on this TV" on Who's watching: that TV opens straight as you

### Improved

**TV**
- When the picture keeps failing, the player offers a lower quality instead of fetching new links and trying other sources

### Fixed

**TV**
- Showbox videos on the Fire TV showed one picture and then reloaded over and over since 4.2.1
- Shows like Bleach now switch to their full list of seasons within seconds on the TV, not on a later visit

## 4.7.1 — 2026-11-23 — Sources on every title, and TV fixes

### Improved

**Library**
- Home is at the top of the library menu, above All

**Titles**
- Every source's answer shows under Watch each time a title opens, and is looked up again live after an hour
- A source that wasn't asked because another already had it no longer shows as crossed out

**TV**
- The TV stops timing subtitles itself when it keeps stopping to load

### Fixed

**Sources**
- AllAnime is off for now: its episodes showed as ready to play, then loaded forever
- Shows like Bleach could stay on another site's seasons after Showbox was briefly busy

**TV**
- The "new Catalog TV app" notice is a whole screen with both ways to update: Update now, or Downloader's steps and code
- OK on its buttons works, Later and Back put it off for a day, and it says so when Update now didn't start

**Roku**
- A Roku with an older app says exactly where on the computer to install the new one

## 4.7.0 — 2026-11-23 — Old cartoons, Nyaa anime, and a Home page

### New

**Home**
- A Home page: the week's new films, shows and anime, and new episodes of your shows
- This week is now called Home
- Anime laid out by the day it aired, today marked
- Previous and next arrows on the featured releases
- New to stream shows a film's first digital or disc release, anywhere
- A dot marks a new week from Monday until you open it
- Opens first, unless you choose Library in Settings → Personalization → Open on
- Back from a title returns to Home, where you left it
- Home on TV, with featured releases and rows made for the remote
- Continue watching and new releases from your watch list, on Home
- Home replaces Continue Watching in the library menu
- Films already watched, played or added before this week stay out of new streaming releases
- Followed shows stay in New episodes and Coming up, without repeating in the watch list

**Sources**
- Nyaa: fan releases of anime, including old shows no site streams (Settings → Services, with a debrid service)
- Got through your debrid service, so your connection never joins a torrent
- One nobody has asked for yet says how far along it is
- Its subtitles come from inside the file
- Played when picked in Files, or when nothing else has the episode
- An episode nobody is sharing yet is kept waiting in Settings → Services, looked for every few hours, and got once someone shares it
- Old cartoon series from a few trusted video collections, played in the Catalog player (on TVs and phones too, with Catalog open on the computer)
- AllAnime (mkissa.to): another anime source, Japanese audio and English dubs, found by the desktop app

**Adding**
- Import everything you've watched from MyAnimeList, AniList or Kitsu by username, or from a Letterboxd or IMDb export
- Statuses, scores and how far you got come along, and a show's seasons come in as one title
- A new Add page: search with posters, and the other ways to add below it

**Look**
- Move and zoom the background picture, the app icon and your profile picture to fit
- Change the size and place of a logo picture
- After an update, a card you can close says what's new, once per version on each device

**Profiles**
- Name styles can glow and shimmer on top of a color or a gradient

**Watch lists**
- A watch list you've seen all of says Finished, on your lists and when adding one

**Player**
- Showbox episodes are downloaded ahead onto the computer too, while plenty of the day's Febbox allowance is left

### Improved

**TV**
- A TV app that can't update itself, or whose update didn't install, shows the Downloader steps to get the new one

**YouTube**
- The moving background appears sooner, with pictures kept between launches and refreshed without waiting

**Home**
- New films, shows of yours and your watch list's releases come in faster when Home first asks TMDB for them

**Player**
- Cast and Download are back on the player's top bar
- Removed Picture glitching and Add a video link from Files; previously marked glitchy copies are still skipped
- Files stays inside the window, including in the mini player
- Watch groups announce when someone joins or leaves; changing copies while paused stays paused

**Online**
- Profiles open at once after the first time, and My profile is ready before you click it

**Titles**
- A title's page opens at once the first time, with its saved details, and corrects itself if it was matched to the wrong film or show

**Subtitles**
- Subtitles asked for twice at once download only once, saving your OpenSubtitles allowance
- Old anime's fan subtitles from Kitsunekko, when there are no official ones
- Subtitles that come as pictures are read into text, styled like the rest
- DVD-style picture subtitles inside MKV files are read too, as the file arrives
- Signs and on-screen text in subtitles show at the top instead of piling onto what's being said
- Dub captions are found for more anime episodes

### Fixed

- An episode no longer stops partway when a source is slow to send the next piece: the player waits for it
- Subtitles no longer "don't match" after the next episode starts by itself
- A show no longer gets another show's subtitles because its name starts the same way
- Anime captions stay findable after AnimeTosho turns away too many lookups
- The MCU watch lists have The Fantastic Four: First Steps itself, not its premiere special
- The note at the top of the player no longer covers captions placed at the top
- Your profile picture shows in the top bar right after opening, not the grey stand-in
- The Music tab also shows on films and shows added by hand
- Downloads from sources other than Showbox no longer get refused for using up Febbox's daily allowance
- Resuming a download stops safely when its server sends the wrong part, instead of damaging the file
- Messages from someone you removed as a friend no longer count as unread forever
- Adding a friend by code takes away their waiting friend request, and yours to them
- A banner or profile picture changed twice in quick succession shows the newer one to friends
- A film series with no name no longer causes an error when Catalog starts

**Online**
- A title removed on another computer no longer removes one you typed in by hand with the same name and year
- Late watch-together updates no longer rejoin a room you left or change the room you just joined
- Switching between friends' shared files no longer shows the previous friend's library when it loads late
- Each conversation keeps its own unsent message, and a message you send stays in its own conversation

**Updates**
- A Mac update that runs out of disk space reports the error instead of closing Catalog; interrupted downloads close their temporary file

**Live**
- Leaving Live stops its empty-schedule retries, including when a reply is still arriving

**Player**
- A copy you pick in Files no longer switches to another copy because its audio language is unknown
- You can pick another copy in Files while a slow one is loading
- Anime copies in Files no longer appear and disappear when a source is slow
- Some copies and downloads that failed to start now start reliably
- Plain video files offer their audio tracks on the computer and follow the same language choice as streamed copies
- Starting something in Catalog's window pauses the mini player, instead of both playing at once
- A copy or episode still loading no longer replaces the one you just picked
- Automatic subtitle timing that arrives late no longer changes your captions after you switch subtitles, audio or episode
- Opening a show again no longer adds duplicate dubbed copies to Files
- Subtitles still loading when the next episode starts no longer appear over it, and your choice carries over in the same language
- Opening a particular episode no longer returns to a different episode kept in the mini player
- A failed cast lookup no longer leaves the previous episode's actors showing
- A video that finishes loading after you leave the player stays paused until you return

**Sources**
- Saving a download to your computer works when its name has non-English characters, such as Japanese
- After a download fails, the next one waits until the failed one has fully stopped
- Videos played through your computer keep loading ahead after a copy change
- Nyaa and AllDebrid pick the right episode from multi-episode copies
- More videos played through your computer on a phone or TV start and keep playing

**Library**
- Browse's Show more keeps keyboard focus while more titles load
- Browse's search and year fields follow Back and Forward
- Browse keeps Show more pages and your scroll position when you go Back from a title
- A Remove from library that fails leaves the title as it was, in Browse and on your other computers
- Browse no longer adds results from an old filter after you press Show more and change the filter
- Title, Add page and franchise searches no longer show late results for text you've changed or cleared
- Closing and reopening Random no longer lets a previous roll replace the new pick
- Library search finds % and _ exactly as you typed them
- Library backups include your latest changes even while Catalog is open
- JSON backups keep note history and saved franchise watch lists
- Restoring takes a backup downloaded from Settings, and a failed restore leaves your current library in place

**Phones**
- On a phone, Browse's Filter panel no longer runs off the left of the screen, cutting off Genre and the years
- Videos kept on your phone reopen where you left them, even at the very start or after rewinding offline
- Browse filters and the library sort menu stay on the screen
- Printable export tables scroll sideways on narrow screens without changing the printed page
- The iPhone app has a Connect to another computer button in Settings → TV and phones, and its setup steps point there

**Roku**
- Picking an unavailable episode no longer starts a different one, and From the start ignores the saved place
- Direct video files and Showbox playlists are sent to the right player
- Searches, filters and captions on Roku no longer jump back to older results
- Roku keeps your Catalog sign-in on your computer, never sent to video sites

**TV layout**
- Empty screens keep the remote's menu reachable, and Back from YouTube works like the other menu screens
- Samsung's Back key opens the menu or returns to the previous screen

## 4.6.0 — 2026-11-18 — Quicker messages and dates that fill themselves

### New

**Messages**
- The message box shows who to talk to at the top, unread first, with an All messages link
- Opening the box goes straight to whoever sent the newest unread message, with your earlier messages
- A message that comes while another window is in front also shows as a Windows notification
- Settings → Online can hide the chat button

**Library**
- Starting something sets its Started date, and Want to watch becomes Watching

**Friends**
- A title's page says which friends are watching it now, not only who watched it

### Improved

**Online**
- Messages, profiles and syncing reach the server much faster on lines where looking up its address was slow
- Messages are checked every minute while a video plays, even with another window in front
- Progress goes to your other computers a few seconds after you pause or stop, and a show picks up from your other computer's newest episode
- Friends' profile pictures and banners open at once the second time

**Settings**
- Problem reports say when they were last looked at

**Player**
- A picture that stalls with plenty loaded ahead goes on after about a second and a half, not six

**Subtitles**
- Translator thanks, "Subtitle translation by" lines and subtitles with a web address in them are left out

### Fixed

- No chat button when you have no friends yet
- The Friends page no longer shows someone watching something from hours ago for a moment
- Settings check boxes only change when you click the box or its words, not anywhere on the row
- Undo in Notes takes back a paste in one step

## 4.5.1 — 2026-11-17 — Your own logo and app icon

### New

**Settings**
- Personalization can change the logo: Catalog's own with a dot in any color, your own words, or a picture
- Personalization can change Catalog's icon on the desktop, the Start menu, the taskbar and its windows: the pink circle, a circle in another color, or a picture
- With a code on, holding Ctrl shows the usual words until you let go

**Friends**
- A friend's library has an Anime tab, and can show their Want to watch, Watching, On hold and Dropped

**Titles**
- A film's page shows the day it came out

### Improved

**Player**
- Skip Intro and Skip Recap fade away after a few seconds with nothing on screen, and come back when the mouse moves
- Next Episode waits for the closing credits; with none known, it shows only in the last 40 seconds

**Browse**
- Random never gives the same title again soon, picks from far more than the most popular few, and the box is a new color every roll

**Settings**
- The code's wording covers many more lines: profiles, friends, messages, Settings and the player's buttons

### Fixed

**Friends**
- Profiles open again late in the day, after the online server has had a busy day
- A friend's library file no longer shows them twice under two names in "watched this"
- A name in the banner's own color is no longer drawn over the banner
- Your picture in the top bar comes back by itself after the server didn't answer once

**Player**
- Skip Intro uses the time most people agree on (Dungeon Meshi's lasted ten seconds too long)
- A problem inside the player no longer stops every button in Catalog; it offers to reload the player

**Library**
- A show you're caught up on no longer says "1 episode waiting" for an episode that's only announced, and it counts as just finished
- A status picked in the library no longer stays on for good, hiding titles added since; it lasts until Catalog closes, says "Showing only …" with Show everything, and the sort is still remembered
- Titles past the first 1,000 in a big library show up

**Titles**
- Shows that TMDB keeps as one long season (The Apothecary Diaries) have their episode pictures, and their seasons show without first listing every episode in one row

## 4.5.0 — 2026-11-16 — Friends on the TV and a steadier title page

### New

**TV**
- Friends on the TV: see who's watching what and watch along, accept friends, add a friend by their code, and see your own code
- When someone in your watch-together room starts something, the TV asks whether to join

**Friends**
- Highest rated on a profile can show just films, shows or anime

**Browse**
- Random can pick from more than one kind at once, like TV shows and anime together

**Settings**
- Turning a code on or off in Personalization plays a short animation instead of reloading the page
- Online shows the owner how much the online server is used each day, against its free daily limits

### Improved

**Friends**
- On your own profile, a title opens its page in your library, where you can change its rating
- A new rating shows on your profile straight away, and friends see it within half a minute
- Friends only see what you're watching while it plays, not while it's paused or set aside

**Player**
- A copy with no sound in the film's own language (or English) is passed over for another copy, so a dubbed cinema recording isn't what plays
- Subtitle timing you change yourself stays where you put it, even after reopening; Reset hands it back to auto-timing
- Subtitles made for the very copy playing are picked first
- Subtitles made of several parts are timed part by part, so a long film's second half lines up too

**Browse**
- Roll again has the same dice and glow as the Random button

**Library**
- A title's page no longer jumps around while it loads, so its rating can be changed straight away
- Watch and Download sit side by side
- The Watch elsewhere button is gone

**Security**
- Catalog only answers to this computer's own addresses, so a website can't reach it by pretending to be it
- Febbox sign-ins are only taken from this computer
- Only web and email links open outside Catalog
- Live TV captions are cleaned like every other subtitle

**Settings**
- Playback's stop log shows the newest five, one line each; press one for its details, or Show all

### Fixed

**Friends**
- Back from a title opened on a profile, or from the friends feed, returns there instead of to the library
- Changing a rating no longer puts a title under Watched lately for friends

**Messages**
- The chat button and Whisper work after going online, without restarting Catalog

**Browse**
- Trending now with a sort like Most popular shows what's on now, not shows from decades ago

**Player**
- Subtitles split into many parts no longer go first, as their parts can be in the wrong order
- Anime that HiAnime has only part of no longer lists HiAnime for the episodes it doesn't have
- An episode no source answers for says so after a minute and a bit, instead of loading forever

## 4.4.1 — 2026-11-16 — Debrid, Stremio addons, a new Random, and profile banners

### New

**Friends**
- My profile button with your picture beside Settings in the library, in the sidebar, and in Settings → Online
- Profile banners: any picture (a GIF can move) or a solid color across the top of your profile
- Name styles: twelve fonts, and one color, a gradient or a glow; friends see it on your profile and your card
- Nicknames for friends, seen only by you
- Remove friend on a friend's profile
- Keep your profile or your friends list private (Settings → Online)
- With no color picked, a profile's top takes its color from the profile picture (or the letter's color, with no picture)

**Browse**
- Random opens a box in the middle of the screen: click it and a pick bursts out, glowing gold, purple, blue or silver by its rating
- Watch now, Want to watch or Completed straight from the pick, and Roll again without the window closing
- Really random (off unless turned on) picks from everything on TMDB, not only popular titles, for films, shows and anime
- Skip the box: the pick comes straight out
- Leave out what's in your library, or let it come up too; your choices are remembered
- An addon's lists (popular, top rated, a Trakt list...) show as rows at the bottom of Browse, with Show more

**Library**
- The stat tiles show your last three watched posters fanned out, tinted by them, with a progress bar along the bottom

**Sources**
- Debrid: with a Real-Debrid, TorBox, AllDebrid or Premiumize key (Settings → Services), every film and episode gets a 1080p and a 4K copy from it
- Only releases with sound Catalog can play are used, English ones first
- Stremio addons: paste an addon's install link in Settings → Services and every film and episode gets a 1080p and a 4K copy from it
- Addons that only give torrents play through your debrid service

**Live TV**
- Check which are on, in Channels: each channel says On or Off
- With nothing on the schedule, Live TV opens on Replays

### Improved

**Messages**
- The box for typing a message is solid instead of see-through; messages that pop up while watching stay see-through
- A click anywhere else closes the message box (what you typed is kept)

**Online**
- Asks the online server far less often when nobody is using Catalog or chatting; messages still arrive within 15 seconds during a conversation
- Only real problems are reported: stops of 4 seconds or more and frozen pictures, not short pauses or small jumps back

**Settings**
- Key boxes in Settings → Services look like every other box
- Shorter, plainer wording across Settings
- Updates: only the newest version is opened out; the rest open with a click

**Phones**
- Three titles across in the library and Browse
- Menus (the ⋯ on a title) stay on the screen instead of running off its edge

**Friends**
- Watched lately shows the date for anything older than yesterday

**Browse**
- The Random button stands out

### Fixed

**Friends**
- A friend's profile showed 0 films and 0 shows, and no posters in Highest rated, once they had watched more than 16 things
- A friend on an older Catalog showed "Nothing to show yet": what they watched shows now
- Catalog offered you something you had started yourself, from an old watch-together room
- Rooms that started by themselves while you watched now end when you stop, so you're not left in a room alone

**Browse**
- Genre filters for TV and anime: Sci-Fi no longer shows Game of Thrones, Lucifer or The Walking Dead; Fantasy, War, Horror and Romance are tighter too

## 4.4.0 — 2026-11-15 — Profiles, messages and watching along together

### New

**Friends**
- Profiles: when someone joined, their favorites, highest rated, what they watched lately and their friends
- Edit your own profile: a line about you, up to eight favorites and a color
- A friend's whole library, with films or shows, sorting and search
- Messages: whisper to a friend; it shows in the corner of their screen for a few seconds, even while they watch
- A Messages page with every conversation and what's unread
- Group chat in a watch-together room
- Press Enter anywhere (even in the player) to send a message; Tab picks who it goes to
- Right-click a friend for their profile, library, a whisper, or ways to watch what they're watching
- Your friend code stays the same for good (New code if you want a different one)

**Watch together**
- When someone in the room starts something, everyone else is asked to join; or join by itself every time

**Title pages**
- A Music tab beside Cast: who did the music, the soundtrack's songs, and an anime's openings and endings

**Fire TV**
- Install or update the TV app from the computer (Settings → TV and phones), like the Roku: after ADB debugging is turned on once, nothing to press on the TV

**Linux**
- Catalog for Linux, as an AppImage that updates itself

### Improved

**Friends**
- Friends are big cards at the top of the page; starting a room is below them
- Watch along starts at the friend's place and follows them; Start it myself and Want to watch are there too
- Friends' watched lately shows the episode for shows and anime
- Watch along is on unless you turn it off

**Watch together**
- When a player pauses by itself to change to a sharper copy, the others see why instead of "paused"

### Fixed

**Friends**
- The add-a-friend button said "alt:Add"
- Adding a friend closed your code and gave you a new one

## 4.3.0 — 2026-11-15 — What friends watched, Continue Watching on every computer, and Random

### New

**Friends**
- What friends watched lately, with their ratings (a few from each, so one person adding a pile at once doesn't fill it)
- People your friends know, to ask to be friends; and a friend's own friends, from their name
- Watch along follows a friend's player without controlling it; a room is still for everyone controlling it together

**Browse**
- Random: a well-known film, show or anime you don't have yet, with Another one (it starts on the kind you're browsing)

**People**
- Video games someone voiced, and who they voiced in them, on their page (from Wikidata)

**Catalog online**
- A name of your own when going online, instead of the computer's name

### Improved

**Catalog online**
- Keeping your library and Continue Watching in step between your computers is on from the start
- Titles you remove on one computer are removed on your others too (can be turned off); a copy of the library is saved first each day
- Continue Watching comes across too: an episode watched partly on each computer ends at the farther place on both

**Friends**
- The Friends page shows at once, and opening a friend's file takes one small line

**Browse**
- The anime lists go on about twice as long, and the best-known all-time titles are no longer skipped

**Player**
- A slimmer bar at the top that fades into the picture: Autoplay, Auto-skip, Autosync, Cast and Download are in the settings menu now
- Subtitles, their timing and the audio track are one button and one menu
- The picture fits the screen unless you pick Fill
- The subtitles picked for a show are remembered for its next episodes on every screen, so a file timed for another release doesn't come back
- A copy with subtitles in the picture comes after a clean one in the same language
- Speed is one row of buttons in the settings menu
- The Sharpest tag stays on one copy instead of swapping back and forth
- While another source has the title already, a source that's still looking goes quiet

**Episodes**
- Episodes with no picture of their own show one of the show's pictures instead of a grey box
- Specials (OVAs, films, extras) are listed on a show's page after its last season
- A show's cast is on its page even when its own site has none, without opening an episode

**Sources**
- A source that said it hasn't got a title isn't listed for it (they failed straight away when picked); Vidfast is asked too now

**Friends**
- Friends' "Watching now" goes as soon as they stop, the page asks again every 15 s and when you come back to it, and there's a Refresh button

**Live TV**
- Channels say whether they played or didn't when last tried, and the ones that didn't go last
- A channel that isn't on says so within a minute or so instead of loading forever

### Fixed

**Player**
- Without a Showbox sign-in, "Only Showbox has this" came up though other sources had the film or episode
- The Watch check left out HiAnime, so anime only it had seemed to be Showbox's alone

**Browse**
- TV shows by genre found nothing for Sci-Fi, Thriller, Action, Fantasy, History, Horror, Romance and War
- A slow answer from TMDB could leave Browse loading for minutes, the bar at the top stuck

**Friends**
- Whoever started a room didn't see who joined it

**Catalog**
- Without a TMDB key, pages stayed empty or kept loading and nothing said why: now a note at the top says so
- The old maroon color stayed after updating from before 4.0: it's the pink now

## 4.2.1 — 2026-11-15 — Quicker starts and jumps, and a tidier Settings

### Improved

**Player**
- Episodes start, and jumps land, much sooner when the video's server is slow: the piece needed now comes in parts, several at once
- Going back a few seconds no longer waits on pieces fetched for the spot you left
- Autoplay into the next episode starts almost at once (its first moments are fetched before this one ends)

**Settings**
- Seven pages instead of twelve: Storage is in Library, Watch Progress in Playback, your name and picture in Online, and Watch on TV, Phones and the PIN lock together in TV and phones

### Fixed

**Player**
- A sound piece that the server was slow to answer was asked for again every 5 s and never came, holding a jump back for 10 s or more

**Subtitles**
- "Please rate this subtitle at %url% / Help other users to choose the best subtitles" is taken out

**Settings**
- Picking another page from Settings' list keeps you where you'd scrolled to, instead of jumping back to the top
- Problem reports only show on the computer that reads them

**Watch list**
- The Fantastic 4: First Steps was the World Premiere special in the Marvel lists, so the film you watched didn't count

## 4.2.0 — 2026-11-14 — Catalog online: friends, watching together, and your library on every computer

### New

**Roku**
- Add profile on Who's watching
- Who's watching every time the Roku app opens, as on the Fire TV

**Online** (Settings → Online, with the join code)
- Friends: add one with a code, and see what each is watching now (the library's Friends)
- Watch along: turn on "Let friends watch along with me" and friends get a button that puts them in step with what you're watching
- A title's page says which friends have watched it (on TVs too); click it for everyone and what they rated it
- That works for friends who shared their library as a file too, with nothing online needed
- Settings → Profile: your name and picture online, one for each profile
- Watch together: start a room, give out its code, and play, pause and skips happen in every house
- Watch together: when whoever started the room goes to another episode, everyone goes with them
- Your watch progress in step between your computers (join them with a code)
- Your library in step between your computers too (statuses, ratings, reviews); it shows what will change first, and never removes a title
- Problems send themselves: a video that stopped to load, subtitles that wouldn't match
- Intro and credit times one Catalog works out are used by the others
- A TV can be connected with a six-digit code instead of the computer's address (TV app 1.10)

**Downloads**
- Showbox's copies can be downloaded while enough of the day's Febbox allowance is left (some is always kept for watching)
- Episodes fetched ahead to stop buffering are listed under "On this computer for now", with Play, Keep and Remove

**Phones**
- A download kept on the phone plays in Catalog's own player

### Fixed

**Roku**
- Each profile sees their own library and Continue Watching
- Replays that wouldn't play on some Rokus play again, in the best quality that Roku can show
- A video that won't start in its best quality starts one quality lower, not the blurriest
- Captions keep trying the next subtitles until one matches the video (they stopped after the first check)
- The next episode starts with its own best captions, not the ones picked for the one before
- Skip recap shows when a recap comes straight after the intro (it said Skip intro)
- Switching seasons quickly no longer shows the episodes of the season picked before
- Back on Who's watching when the app opens leaves the app
- Home says "Nothing here yet" for a new profile instead of staying blank
- A failed search says so instead of "Searching…" forever

**Player**
- A film whose Showbox copy is blurry starts on a clearly sharper copy from another source, from the start or where it was left
- Looking for a sharper copy no longer slows the film playing (it buffered for about 20 s)
- Captions re-time themselves after switching to another source's copy
- Resuming on another copy starts a few seconds before where it was left, with captions timed to that copy
- A musical's captions are no longer called "don't match" (Hamilton: nearly every line is sung)
- A show's newest episode is fetched onto the computer as soon as it's out and plays from there (7Movies and Movy: it was the episode that buffered, on TVs most of all)
- Opening a show's page, or resting on it on a TV, fetches its first minutes ahead (7Movies)

**Search**
- Searching "Fantastic Four" shows "The Fantastic 4: First Steps" near the top (numbers count written either way, in Browse and the library)
- A well-known new film or show comes before older, little-known ones with the same name

**Fire TV**
- A TV that couldn't reach the computer keeps trying by itself, and finds it again when the router gave it a new address
- Updating the TV app shows the steps for Fire TV's "Install unknown apps" switch, and carries on by itself once it's on
- Later puts the TV app update off for a day
- A TV on the computer's layout offers the TV layout back on the library
- Picking a profile works on a TV that's on the computer's layout (it always stayed on the owner's)
- Use the normal layout in the TV's Settings asks twice

**Phones**
- YouTube on an iPhone says it isn't available there yet (videos stopped after a minute)
- YouTube opens straight away
- Add account and other Google sign-in pages in phone YouTube say to sign in on the computer, with a button that opens the sign-in there (they were a black screen)
- A title's page shows that profile's own list, and adds to it
- Browse no longer marks the owner's titles as in another profile's library

**Updates**
- A check GitHub fails is tried again by itself before saying it couldn't check

## 4.1.4 — 2026-11-09 — The Roku player's menu, captions in Catalog's style, and everyone's own library on phones

### New

**Roku**
- Down (or *) while watching opens the player's menu: captions, auto-timing, caption delay, size, source, sound, next episode
- Captions drawn in Catalog's own style, timed by the computer like on the Fire TV
- Settings: caption size, caption look, auto-timing
- The Roku says when the computer has a newer version of its app

### Improved

**Roku**
- Episodes show straight away on a show's page
- Live TV comes back to the game you were on
- Replays stay in their top quality

**Live TV**
- The next pieces of a game are fetched ahead, so there's less buffering

**Fire TV**
- Live TV comes back to the game you were on

**Browse**
- A slow shelf no longer holds up the whole page

### Fixed

**Roku**
- Live TV's buttons can be read
- Highlights in the Library, Search and Live TV are no longer cut off
- Only one loading circle
- An episode copy that's really another video is turned down

**Subtitles**
- Films that share a name with an anime no longer get that anime's subtitles

**Phones**
- Each person's phone shows their own list, not the whole household's library

**Settings**
- Install on Roku finds the Roku on computers with Tailscale
- Updates says why it couldn't check

## 4.1.3 — 2026-11-09 — Roku films and shows play, and Live TV search on the Roku

### Fixed

**Roku**
- Films and episodes play instead of backing out or skipping to the next episode
- A video the Roku can't play says so instead of moving on
- One loading circle instead of two

### New

**Roku**
- Search in Live TV: teams, leagues and channels

## 4.1.2 — 2026-11-09 — Roku plays again, a tidier Roku menu, and Extended Edition subtitles

### Fixed

**Roku**
- Films and shows play instead of saying "Couldn't find that to play"
- The menu's names hide when you leave the menu
- No dark strip at the edge of the open menu
- Down from Live TV's sports reaches the games
- Profile highlight no longer cut off at the top
- Loading text sits in the middle of the screen
- YouTube results no longer overlap their text

**Subtitles**
- Subtitles made in parts (old CD and DVD rips) are offered joined as one
- Subtitles made for the cut that's playing come first, even with long end credits

### New

**Roku**
- YouTube opens on a Home of videos from each of its places

## 4.1.1 — 2026-11-09 — Roku installs fixed, and Live TV picks the game's own channel

### Fixed

**Live TV**
- Games open on the league's own channel, like NFL Sunday Ticket, not a city's station showing other programs

**Roku**
- Install on Roku no longer stops with "ECONNRESET" every time
- A wrong Roku developer password now says so

## 4.1.0 — 2026-11-08 — YouTube tabs, the player kept loaded, sharper copies, and Live TV working again

### New
- **YouTube**: tabs, as in Chrome: + or Ctrl+T opens one, Ctrl+W closes it, Ctrl+Tab moves between them
- **YouTube**: Ctrl+click or middle-click a video to open it in a new tab; right-click a link for Open link in new tab
- **Player**: leaving the player keeps the video loaded, paused, for 30 minutes; coming back carries on at once, with no reloading or re-timing
- **Player**: Now playing at the top of the sidebar (bottom left on phones) goes back to the video; its x closes it
- **Notes**: Ctrl+F (or the magnifier in the toolbar) finds text in a note, with every match highlighted and Enter for the next
- **Player**: the Files menu shows each copy's real sharpness in Mbps and marks the sharpest
- **Player**: a film whose Showbox copy is weak plays a clearly sharper copy from another source, with the same sound
- **Phones**: YouTube button on the library page

### Improved
- **Phones**: Turn on the phone address answers in about a second (it took 20)
- **Sidebar**: no stray dot between the library and Browse
- **Notes**: the picture button is an icon

### Fixed
- **Febbox**: Add another account signed the new account in over the main one; it now gets its own window and is added
- **Febbox**: signing in with Google no longer says the window closed while it is still open
- **Live TV**: games loaded forever after the site changed how it sends its streams
- **Roku**: installing from Settings → TV said it couldn't reach the Roku; it now installs, or says what went wrong
- **Fire TV**: YouTube's thumbnails are sharp and it's no longer zoomed in (TV app 1.8)
- **Phones**: Downloads, Live TV and YouTube have a way back to the library, and back links are easier to tap
- **Phones**: a video held upright shows the whole picture instead of a cropped middle
- **Phones**: Live TV's tabs and the Febbox buttons in Settings → Services fit the screen; YouTube's note wraps

## 4.0.0 — 2026-11-08 — YouTube with no ads on every screen, a new look, and styled anime subtitles

### New
- **Fire TV**: YouTube in the menu, with all of YouTube's own screens and sign-in, and no ads (needs the TV app update below)
- **Fire TV**: the TV app updates itself from the computer from now on (this one update still goes through Downloader, and keeps everything)
- **YouTube**: on the computer from the sidebar, in its own window: YouTube's normal website, with no ads before videos and ad tiles hidden
- **YouTube**: the window opens at once after the first time, and Catalog's YouTube page shows when it's closed, with Open YouTube
- **YouTube**: a switch on the YouTube page opens it inside Catalog instead, filling the whole window; the pink circle beside YouTube's logo comes back
- **YouTube**: a big Open YouTube button over a moving wall of what's on YouTube; the page no longer opens YouTube by itself
- **Downloads**: download from a title's page without opening the player: a film, any of a show's seasons, or the whole show at once, with English captions
- **YouTube**: Sign in on the computer shows Google's sign-in over the YouTube window (through Microsoft Edge or Chrome) and closes it by itself when done
- **Roku**: YouTube in the menu: search and play without ads, through Catalog on the computer
- **Controller**: an Xbox or PlayStation controller works on the computer: the D-pad moves, A picks, B goes back, X opens a title's options
- **Controller**: in the player, A or Start plays and pauses, the shoulder buttons skip 10 s (triggers 30 s), Y goes full screen
- **Player**: the Files menu says when a copy has more than one language, like "Japanese + English"
- **Sources**: HiAnime for anime, in Japanese with English captions and the English dub, up to 1080p
- **Sources**: Vidfast for films and TV, up to 4K, on the computer and TVs (needs Catalog open on the computer, like Movy)
- **Library**: shows you're caught up on count down to their next episode ("New ep in 3 days"), on the computer and TVs
- **Audio language**: each profile can pick Spanish, French, German or Hindi, and films and shows play dubbed in it where Movy has a copy (Settings → Playback, and the TV's Settings)
- **Ratings**: rate with 10 stars instead of 5, for halves like 8.5 (Settings → Personalization → Ratings)
- **Subtitles**: on the computer, Whisper also checks the timing by matching the words said to the subtitles (English talking), and its answer wins
- **Theme**: a Custom theme: pick every color yourself (background, cards, text, lines and more), each with its exact hex code, and copy the codes to share (Settings → Personalization)
- **Episodes**: a show's page on the computer lists its episodes by season, like the TV: click one to play it, with Up next marked
- **Logo**: Catalog has a logo: "catalog" with a pink circle for the o, at the top of the sidebar, the library, the sign-in screen and exports
- **YouTube**: on phones, all of YouTube (home, subscriptions, comments, Shorts, your library) on YouTube's own mobile site, with no ads, through Catalog on the computer
- **YouTube**: everyone's phone has their own YouTube account: sign each person in on the computer's YouTube page, under Phones
- **Roku**: YouTube's own Music, Gaming, News, Sports, Live, Movies and Podcasts, in rows like YouTube's TV app; channels and playlists open their own rows
- **TV**: the logo at the top of the TV menu, on the Fire TV and Roku: the pink dot, and the whole name when the menu opens
- **Fire TV**: the TV switches to each video's own frame rate (24 for films), so slow pans don't judder; turn it off in the TV's Settings (needs the TV app update)
- **Subtitles**: anime subtitles' signs and songs show as their makers styled them, placed on the sign, with karaoke and the file's fonts; the talking stays in Catalog's own style (on the computer and phones; Signs and songs in the subtitle menu switches it)
- **Episodes**: a show's page has Episode ratings: every episode's IMDb rating in a chart by season, colored from great to bad, with each season's average

### Improved
- **Player**: volume goes up to 400%, with nothing holding loud parts back
- **Player**: the next episode's link is fetched before the credits start, so Next Episode during long credits starts sooner
- **Mini player**: opens and goes back without reloading in front of you; it takes over at the exact spot
- **Subtitles**: signs-only tracks say they're written text only, show how few lines they have, and aren't auto-timed
- **Subtitles**: auto-timing works about twice as fast
- **Subtitles**: reopening an episode keeps its timing instead of working it out again, on every source
- **Subtitles**: with captions on, the next episode's timing is worked out on the computer before it starts (Showbox)
- **Skips**: a recap straight after the intro can be skipped right away, with no gap between the two
- **Episodes**: episodes not out yet say how long until they air ("Airs Sat, Nov 7 · in 3 days")
- **Sources**: Showbox is optional: without a Febbox login, the other sources just play, and Settings → Services offers it
- **Settings**: with the wide layout, Settings uses the whole window, in two columns on a big screen
- **YouTube**: the YouTube page says No ads in bold
- **Player**: films with a 4K copy on Showbox play its 1080p, made from the sharper source (IMAX copies show the taller picture); a 4K copy with no 1080p falls back to the 1080p file
- **Theme**: Catalog's own pink, the icon's color, is the color everything starts with (Settings → Personalization → Color still changes it)
- **Buttons**: text on light accent colors like Catalog's pink is dark, so it's easy to read
- **Title pages**: tidier: your rating, status and progress sit beside the poster (status is one menu), and where to watch, awards and tags fold into More about it
- **Roku**: Catalog's pink everywhere the old maroon was, with dark text on pink, as on the Fire TV
- **TV**: a show the player numbers its own way (like Re:Zero's 4 seasons) shows each episode's picture, length and summary on its title page

### Fixed
- **Player**: video no longer turns choppy on another monitor while a demanding game runs (Destiny 2)
- **Settings**: with the wide layout, Updates and Playback no longer leave half the page empty: What's new and the stop log run across the page
- **Subtitles**: auto-timing no longer calls loosely timed subtitles wrong too early (Ice Age 3's R5 ones fit after 17 minutes of sound, and it gave up at 13); films with a long quiet opening fit sooner
- **Subtitles**: R5 subtitles (made from early pre-release copies) are listed after proper ones
- **Subtitles**: auto-timing is on again for everyone; turning it off is remembered
- **Phone app**: the Home Screen icon is a pink square, not a pink circle on black
- **Subtitles**: auto-timing no longer puts some films' subtitles a couple of seconds early (their sound was read slightly short)
- **Player**: a source the internet provider blocks is reached anyway where it can be, and otherwise says it may be blocked
- **Showbox**: no "only anime will play" banner without a Febbox login, now that the other sources play everything
- **Desktop app**: on a computer whose graphics Catalog can't use, it restarts without graphics acceleration instead of staying blank
- **Library**: a title marked completed from Continue Watching gets its ratings, synopsis and cast (it was added with only its name); ones added that way before are fixed when opened
- **Library**: a title with no ratings says why
- **Library**: watching a film you'd already seen to the end counts as another watch
- **Subtitles**: more subtitle-team credits are left out ("Edited by …"), on the Roku too
- **Player**: switching the sound to a TV or headphones mid-video no longer freezes the picture when the volume is past 100% or captions are timing themselves
- **Library**: the window title goes back to Catalog after leaving a title
- **Subtitles**: accented letters in older subtitle files show properly instead of question marks
- **Player**: when the video reloads by itself (often after a long pause), it says so and stays where it was
- **Desktop app**: closing Catalog no longer shows a JavaScript error
- **Library**: titles added with only a name get their year and details shortly after Catalog starts, without opening each one
- **Downloads**: on a phone's plain address, the Downloads page says how to keep downloads on the phone to watch with no connection
- **Fire TV**: Back in YouTube goes back a step, as in the YouTube app, instead of sometimes leaving YouTube; holding Back leaves
- **YouTube**: the moving wall of thumbnails no longer jumps back every minute or so
- **Showbox**: a film never starts on a recording made in a cinema (TELESYNC, CAM…) when a proper copy is listed
- **Personalization**: background pictures over half a megabyte can be used again (they said "larger than 20 MB"); the same for pictures in Notes

## 3.9.0 — 2026-10-31 — TV subtitles timed again, Roku installs from Catalog, and skip fixes

### New
- **Roku**: Settings → Watch on TV finds the Rokus on the Wi-Fi and installs Catalog on one, no web browser needed
- **Player**: double-click the volume slider to go back to 100%, and the percentage shows over it while dragging
- **Settings**: each Febbox account shows its name or email
- **Live TV**: take a channel or replay off Recently watched, or clear it all (the x on the computer, the menu button on the Fire TV, * on the Roku)

### Improved
- **Fire TV**: new TVs install Catalog by typing one code in Downloader (5785169)
- **TV**: the "TVs can't connect" notice only shows in Settings → TV, not on every page
- **Skips**: intro and credits times from the skip sites are used first; Catalog finds its own only where they have none
- **Skips**: intros that start after a long opening scene (up to 12 minutes in) are found
- **Skips**: a recap and an intro back to back are two skips again, so the intro can be watched
- **Skips**: Skip Intro and Skip Recap leave the last second, so the story's first words aren't cut off
- **Anime**: each show's Japanese or dub choice is kept with your profile, so TVs and phones start the same way

### Fixed
- **TV**: subtitles get timed to the video even while the computer is busy with other TVs (they could stay out of time for good)
- **Subtitles**: picking up where you left off brings back the subtitles' speed along with their delay (some were far out until re-timed)
- **Settings**: adding another Febbox account no longer fails with "No account was added" when it logged in fine
- **Computer**: things Catalog remembers on this computer (each show's audio and subtitles, volume) are kept after closing it; an update could put an anime back on the dub
- **Player**: a slow part no longer counts as "missing on its server" (it switched copies after pausing); it gets a fresh link instead
- **Subtitles**: opening an anime's last episode of a season no longer searches for episodes after it, so its subtitles come sooner
- **Skips**: credits no longer start early when an episode ends on a dark scene
- **Skips**: a show's real intro is no longer lost when a studio logo plays at the start of each episode

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
