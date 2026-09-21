# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

## 2.1.0 — 2026-09-21

- **Wide layout option.** In Settings > Personalization, switch between
  centered and wide layout. Wide mode uses the full window width and
  shows more titles per row.
- **Renamed "Wrong show?" to "Wrong one?"** since it applies to movies and
  anime as well.
- **Fullscreen hides Catalog UI.** The player bar and controls disappear in
  fullscreen and reappear when you move the mouse.
- **More trending actors.** The actors page now shows around 60 trending
  people instead of 12.
- **Actors page links stay in Catalog.** Clicking an actor on the trending
  actors page now opens their page inside the app instead of going to a
  website.
- **Add to library defaults to "completed".** Adding something from the
  browse or detail page now sets it as completed instead of want to watch.
- **Bigger thumbnails in the add menu.** Movie and show posters in search
  results are larger and easier to see.
- **Watch Now button removed from add menu.** The watch button on the title
  detail page is the way to watch.
- **Better showbox search.** Search now checks both the autocomplete and the
  full search page, finding anime and titles the autocomplete alone missed.
- **Smarter title matching.** Exact title matches are always preferred
  regardless of year differences. Alternative title lookups verify the
  result is actually the same show.
- **Fixed episode listing for many titles.** Shows that returned
  "no files found" (like The 100, The Pitt, and others) now load
  correctly.
- **Browse search bar typing fix.** The search input no longer resets while
  you type.
- **Simpler README.** The GitHub page is brief and to the point.

## 2.0.0 — 2026-09-20

- **Watch inside Catalog.** Browse results and the detail page have a
  ▶ Watch button that finds the title on febbox and plays it in a built-in
  player — no separate window, just the video. Click "Add to library" in
  the player bar to save what you're watching without leaving.
- **Custom video player.** Play/pause, skip ±10s, volume (with boost up to
  200%), drag-to-seek progress bar with live time preview, picture in
  picture, and fullscreen. Controls auto-hide during playback. Keyboard
  shortcuts: Space/K play, arrows seek/volume, F fullscreen, M mute.
- **Quality picker.** Movies and TV shows show all available quality options
  (720p, 1080p, 2160p, etc.) in the player bar. Defaults to 1080p.
- **Episode sidebar for TV shows.** A season/episode list on the side with
  episode titles from TMDB. Toggle it with the Episodes button.
- **Subtitles.** Captions are searched automatically from OpenSubtitles,
  grouped by language with English first. Supports SRT and ASS/SSA formats
  (anime subtitles work). Adjust timing with the delay button, or upload
  your own subtitle file.
- **"Wrong show?" button.** If auto-resolve picks the wrong title, click
  "Wrong show?" in the player bar to go back to the search results and
  pick the correct one manually.
- **Watch progress saved automatically.** The player remembers where you
  left off. Close a movie or episode and come back later — it picks up
  where you stopped. Progress saves every 15 seconds, on pause, and when
  you close the page.
- **Settings → Watch Progress.** View all saved positions, delete
  individual entries or clear everything at once.
- **Smarter anime title matching.** When the English title isn't found,
  Catalog looks up alternative titles from TMDB and romaji titles from
  AniList. Year mismatches are penalised so the wrong show with a similar
  name doesn't get picked. Long subtitle-style titles (colon-separated)
  are split and tried individually.
- **Browse search ranks popular results first.** Searching "seven deadly
  sins" now ranks the popular anime above obscure shows from 1966. Leading
  articles (The, A, An) are ignored when matching.
- **Regional trending.** Browse shelves use the country set in
  Settings → Services (Where to watch) for TMDB results.
- **Trending actors.** The Actors page now shows trending actors of the
  week below the search bar, with photos and what they're known for.
- **Watch elsewhere.** A dropdown next to the Watch button lets you open
  the title on Miruro (anime) or CineJoy (movies & TV) in your browser.
- **Log in to febbox from the player bar.** Google sign-in opens in its
  own window. After logging in, the video loads automatically.
- **File info button.** Click "File" in the player bar to see the name and
  size of the video file.
- **Settings panel.** Gear icon opens quality, playback speed (0.25x–2x)
  and audio track selection. Audio track icon changed to a language symbol.
- **Cast sidebar.** A "Cast" button in the player bar opens a scrollable
  sidebar showing actors and their characters.
- **Audio track sticks across episodes.** Switch to the dubbed or subbed
  audio track once and it stays that way for every episode.
- **Buffering indicator.** A spinning loader appears over the video when
  it's buffering.
- **Theme picker in Personalization.** Choose between System, Light, Dark
  or Black (OLED-friendly).
- **Collapsible update history.** Settings → Updates shows all past
  releases in collapsible sections, with the latest three open by default.
- **Fixed Vinland Saga and other titles with dashes in their share key
  returning "No video file found."**

## 1.7.0 — 2026-09-17

- **Browse keeps going.** Every shelf has a **Show more** button now, as many
  times as you like, rather than stopping at the first twenty.
- **Trending now / All time**, so you can look at what's big this week or at
  the most-rated films, series and anime ever made.
- **Bulk add** has gone from the top of the library — it was already on the Add
  page, which is where you end up anyway when you have a list to paste.

## 1.6.1 — 2026-09-16

- **"An update is ready" now appears when you have a PIN.** It was asking from
  the login screen, getting the login page back instead of an answer, and never
  asking again — so with a PIN set you were never told an update was waiting.
- **Fixed an update that could report itself as failed while it was still
  working.** Every time Catalog was opened during an install it started a second
  helper, which gave up instantly because the first one was mid-job — and the
  app closed anyway. A few of those in a row used up the retry budget and the
  update declared itself impossible while a perfectly good one was in progress.
- Installing an update now says so on screen instead of the app silently
  refusing to open, so there's no reason to keep clicking.
- An update that runs out of time no longer blocks the next one for ten
  minutes.

## 1.6.0 — 2026-09-16

- A **Browse** button beside Add, for finding something rather than looking it
  up. It opens on what people are watching this week and searches everything
  the databases have — synopsis, cast and scores on every title, and a
  Watchlist or Seen it button without leaving the page.
- Titles now show **where to watch** them: what's streaming, free, for rent or
  to buy in your country. Settings → Services picks the country if the one it
  guessed is wrong.
- **Someone else's catalog is usable now.** Open a shared list and you can
  click into any title, sort it however you sort your own, filter down to
  what you've both seen, and add anything straight to your library.
- **"Missing information" reaches zero.** It counted 44 series forever because
  TMDB stopped filling in the field their runtime used to live in. Those
  runtimes are back, and anything the databases genuinely have nothing for is
  now left alone instead of being asked about on every pass.

## 1.5.0 — 2026-09-16

- **Updates install themselves properly now.** A finished update used to wait
  for you to close Catalog, and sat unused if you didn't. It's installed when
  the app next starts instead — worst case, one extra restart.
- A **Library** link sits beside Back on every page, so you don't have to walk
  back up a long chain of films and actors.
- The library page shows a thin progress line while runtimes and scores are
  being filled in, rather than doing it invisibly.

## 1.4.0 — 2026-09-16

- Runtimes, box office and scores now fill themselves in shortly after Catalog
  opens. No button to find.
- **Every actor is clickable now.** On a film you don't own, the cast used to be
  plain faces — so film → actor → film stopped dead. It doesn't any more, and
  the back arrow follows the whole chain.
- **Appearance is now Personalization**, and you can turn off the sort options
  you never use so they stop appearing in the list.
- A dot appears beside **Services** or **Updates** when a key is missing or an
  update is waiting.

## 1.3.0 — 2026-09-16

- **Sorting by "Longest" now works.** Nothing in the library had a runtime,
  because searching for a title doesn't return one — so the sort had nothing to
  work with and fell back to alphabetical. Settings → Library → **Missing
  information** fills them in, along with box office and IMDb scores.
- **The value you sorted by now shows on each card**, so sorting by box office
  or Metacritic doesn't mean opening every title to see the number.
- Catalog offers an update when one is waiting, with **Not now** and **Don't
  ask again**. That can be turned back on in Settings → Updates.

## 1.2.2 — 2026-09-16

- **Fixed automatic updates, which never worked.** Every version up to 1.2.1
  shipped without the file that tells Catalog where to look, so checking for
  updates failed. Updating to this version has to be done by hand once; after
  that it's automatic.

## 1.2.1 — 2026-09-16

- Fixed an update that could stop at "Waiting for Catalog to close" and go no
  further. Updates no longer reuse a build folder, so a file Windows is still
  holding on to can't block the next one.

## 1.2.0 — 2026-09-16

- Updating now shows a progress bar in the app instead of a console window. The
  build happens while Catalog is still open, so you can keep using it.
- Settings → Updates lists what changed in each version.

## 1.1.0 — 2026-09-16

- **Actors:** "Show more" on an actor's page kept working after the first click.
- **Cast lists** for series were often only three or four people. The Office now
  shows twenty instead of four. Anything added before this has a **Refresh from
  the database** button under Edit.
- **Save as PDF** produces a file that actually opens.
- **Sorting** is grouped, and you can sort by IMDb, Rotten Tomatoes, Metacritic
  or box office.
- **Share your catalog** with a friend, and open theirs — it marks what you've
  both seen and can show only what you haven't.
- **Lock a note** behind your PIN.
- "People" is now "Actors".

## 1.0.1 — 2026-09-15

- IMDb, Rotten Tomatoes, Metacritic, age rating, awards and box office, if you
  add a free OMDb key in Settings → Services.
- Fixed scores being remembered as "nothing found" when the lookup had failed.

## 1.0.0 — 2026-09-15

- First release.
