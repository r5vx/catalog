# What's new

Notes for the next release go under **Unreleased**, as short bullets aimed at
whoever is using the app — what changed for them, not what changed in the code.
`npm run release` takes that section, publishes it as the release description,
and stamps it with the version number.

## Unreleased

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
