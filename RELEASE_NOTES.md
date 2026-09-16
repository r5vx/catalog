# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

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
