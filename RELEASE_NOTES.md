# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

## 1.7.9 — 2026-09-19

- **Febbox login actually works now.** Google Sign-In was broken in the desktop
  app because the credential never made it back from the popup. Catalog now
  intercepts it and forwards it to febbox's login, so the full flow completes.
- **Log in from the player bar.** A "Log in" button sits right in the player
  bar so you don't have to go through Settings first.
- **Player loads without a saved key.** Watch falls back to the embedded player
  even before you've logged in — the login button is right there when you
  need it.

## 1.7.8 — 2026-09-18

- **Watch fix (for real this time).** Video requests to febbox now run inside a
  real browser context with full cookies and auth, matching what the site sees
  when you use it directly. Previous versions tried a shortcut that febbox
  rejected.

## 1.7.7 — 2026-09-18

- **Watch actually plays now.** Requests to febbox go through Electron's own
  network stack with real browser cookies — fixes the "Please log in first"
  error that appeared after adding the key system.
- **Login popup closes itself.** After signing in with Google, the popup shuts
  automatically instead of dumping you on febbox's home page. It waits for you
  to finish with Google first.
- **No more search bar on error pages.** When a title can't play, you see only
  the error — not the search UI underneath it.

## 1.7.6 — 2026-09-18

- **Watch actually plays now.** Requests to febbox go through Electron's own
  network stack, which sends real browser cookies — fixes the "Please log in
  first" error that appeared after adding the key system.
- **Login popup closes itself.** After signing in with Google, the popup shuts
  automatically instead of dumping you on febbox's home page.
- **No more search bar on error pages.** When a title can't play, you see only
  the error — not the search UI underneath it.

## 1.7.5 — 2026-09-18

- **Quality picker.** Movies and TV shows now show all available quality options
  (720p, 1080p, 2160p, etc.) as buttons in the player bar. Defaults to 1080p.
  For TV, picking a quality sticks for the rest of the episodes.
- **Copy your key.** Settings → Services now has a "Copy key" button so you can
  share your Watch key with friends.
- **Better stream resolution.** Tries multiple approaches to get a playable link,
  and shows details when it fails so you can tell what went wrong.

## 1.7.4 — 2026-09-18

- **Log in from Settings.** The Watch section in Settings → Services now has a
  "Log in with Google" button instead of requiring the desktop popup. The token
  saves when you close the login window.

## 1.7.3 — 2026-09-18

- **Watch plays the video directly.** Clicking Watch now opens the movie or
  episode in a built-in player instead of loading an external site. No branding,
  no extra UI — just the video.
- **No more search flash.** Watch goes straight from the button to the player
  with a loading spinner, instead of briefly showing a search page.
- **Episode clicks work.** Picking an episode in the sidebar actually switches
  the video now.
- **Febbox key in Settings → Services.** Log in once on the desktop app and the
  key saves itself. Share it with a friend so they can watch without logging in.

## 1.7.2 — 2026-09-18

- **Theme picker in Personalization.** Choose between System (follows your
  device), Light, Dark or Black (OLED-friendly). The preview updates live as
  you pick, and your choice sticks across sessions.
- **Watch goes straight to the movie.** Clicking ▶ Watch now auto-matches the
  title on showbox instead of dropping you into a search page.
- **Log in to febbox from the player bar.** Google sign-in opens in its own
  window (where Google actually allows it), and your session carries over to
  the player. Stays logged in across restarts.
- **Episode sidebar for TV shows.** The player now shows a season/episode list
  on the side so you can see what's available without navigating febbox's
  folders. Toggle it with the Episodes button.

## 1.7.1 — 2026-09-18

- **Watch inside Catalog.** Search results and the detail page now have a ▶
  Watch button that finds the title on febbox and plays it in an integrated
  player — no separate window, with febbox's own captions, speed and quality
  controls. An "Add to library" button in the player bar lets you save what
  you are watching without leaving. The button greys out automatically if
  showbox.media is unreachable.
- **Settings → Updates no longer calls the version you're running
  "Unreleased".** The notes are stamped with the version number before the app
  is packaged now, rather than after it, so the copy inside the app is the
  right one.

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
