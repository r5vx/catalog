# Catalog for Roku

A Roku app for Catalog: the library, Continue Watching, search, Live TV and the player, from a
computer in the same house that has Catalog open. Roku apps can't show web pages, so unlike the
Fire TV app (which shows Catalog's own TV pages) this one draws its own screens and asks Catalog
for what to show (`/api/roku/*`), then plays the video itself.

## Putting it on a Roku

Roku only installs apps from outside its store in **developer mode**, from a computer's browser:

1. On the Roku remote press **Home 3 times, Up 2 times, Right, Left, Right, Left, Right**. Turn on
   the developer settings, pick a password and note the address it shows (like `http://192.168.1.40`).
   The Roku restarts.
2. On the computer, `npm run roku` packs the app into `dist-roku/Catalog-Roku.zip` (Catalog also
   serves it at `http://<computer>:4173/catalog-roku.zip`).
3. In the computer's browser open the Roku's address, sign in as `rokudev` with the password from
   step 1, choose **Upload**, pick the zip, then **Install with zip**. Catalog opens on the TV.

It stays in the Roku's apps row. A new version is installed the same way, over the old one.
Only one app from outside the store fits on a Roku at a time.

## How it works

Laid out like the Fire TV app, and fed by the same code where it can be:

- `manifest`, `source/main.brs`: the app and its one scene.
- `components/MainScene`: the menu (`NavMenu`: who's watching, Search, Home, Movies, TV Shows,
  Anime, My Library, Live TV, Settings, with the Fire TV's icons) beside one of its screens; a
  title's page, the player, "Who's watching" and finding the computer open over them. Back closes
  the top one; on a menu screen it opens the menu; then it goes Home; from Home it leaves.
- `ConnectScreen`: finds the computer the way the Fire TV app does (UDP `CATALOG_DISCOVER` on
  port 41734, answered by `electron/main.cjs`), or its address is typed; asks for the PIN if
  Catalog has one (`/api/roku/hello`, `/api/roku/login`). Kept in the Roku's registry.
- `ProfileScreen`: who's watching (`/api/roku/profiles`), sent as the `catalog_profile` cookie.
- `ShelfScreen` (Home, Movies, TV Shows, Anime): a banner about what's highlighted and rows of
  posters from `/api/roku/rows`, built by the Fire TV's own `src/lib/tv/tiles.ts`. * offers what
  the Fire TV's menu button does; resting on Continue Watching starts its video in the background.
- `LibraryScreen`, `LiveScreen` (On now, Saved, each sport, Channels, Replays), `SearchScreen`,
  `SettingsScreen` (captions, auto-skip and autoplay start on, as on the Fire TV).
- `TitleScreen`: the Fire TV's buttons, seasons and episode pictures (`/api/roku/title`,
  `/api/roku/season`, which uses the player's own numbering where it differs), More like this.
- `PlayerScreen`: `/api/roku/play` finds the copy as Catalog's player does; the Roku's own player
  plays it. Intros and credits skipped (`/api/roku/skips`), the next episode, a fresh link if it
  stops working, Japanese and English subtitles for anime (`/api/roku/subtitles`). Preview pictures
  while fast-forwarding: a BIF file (`/api/roku/bif`, `src/lib/server/bif.ts`) built from the
  pictures the computer keeps for the progress bar, one every 10 s; the computer makes them for the
  copy the Roku plays when it starts. Live TV plays
  `/api/live/playlist`, replays `/api/live/replay`.
- `TileItem`: every tile (posters, chips, buttons, episodes, games, faces). `ApiTask`,
  `DiscoverTask`: the asking, off the screens' thread.

Checked with BrighterScript's compiler (`npx brighterscript --root-dir roku --create-package false`),
which catches mistakes in the code; whether it looks and plays right can only be seen on a Roku.
