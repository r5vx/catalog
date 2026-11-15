# Catalog

A personal library of everything you've watched — films, TV, anime. Runs as a desktop app on your PC and is reachable from your phone.

## Install

Download **Catalog-Setup.exe** from the [latest release](https://github.com/r5vx/catalog/releases/latest). Windows will warn about an unknown publisher — click **More info → Run anyway**. Updates happen automatically.

**Mac** — download the **.dmg** from the same page (see [Updating](#updating) for the one Terminal step).

**Linux** — download the **.AppImage** from the same page, then make it runnable and open it:

```
chmod +x Catalog-*-linux-x86_64.AppImage
./Catalog-*-linux-x86_64.AppImage
```

Some distributions need FUSE 2 for AppImages (Ubuntu 22.04 and later: `sudo apt install libfuse2`). If it closes straight away on Ubuntu 24.04 or later, start it with `--no-sandbox`. The library lives in `~/.local/share/Catalog/`.

Your library lives on your PC, and no account is needed. Going online (friends, watching together, keeping two computers in step) is optional: see [Privacy](#privacy).

## Setup

**Movies & TV search** — needs a free [TMDB](https://www.themoviedb.org) API key. Paste it in **Settings → Services**. Either the API Key or the Read Access Token works.

**IMDb / RT / Metacritic scores** — optional. Get a free [OMDb](https://www.omdbapi.com/apikey.aspx) key and paste it in the same place.

Anime works without any keys.

## Updating

**Windows** — Updates download automatically in the background. Next time you close and reopen Catalog, the new version is installed. You can also check manually in **Settings → Updates**.

**Mac** — Updates are not automatic. Download the new **.dmg** from the [latest release](https://github.com/r5vx/catalog/releases/latest), drag it to Applications, and replace the old copy. Then open Terminal and run:

```
xattr -cr /Applications/Catalog.app
```

This is needed after every update because the app isn't signed.

**Linux** — The AppImage updates itself the same way as on Windows, as long as it sits in a folder you can write to (your home folder, not `/opt`).

## Phone access

Install [Tailscale](https://tailscale.com) on both devices, sign in with the same account. Open Catalog on your PC, then visit `http://<your-tailscale-ip>:4173` on your phone. Add to Home Screen for the app icon.

## Privacy

Catalog has no ads, no analytics and no tracking of its own. Your library, notes, ratings and settings are kept in one file on your computer.

**What leaves your computer, and to whom:**

- **Catalog online is off until you join it** (Settings → Online). Once joined, Catalog talks to a small server run by Catalog's author on Cloudflare. It receives only what that feature needs: the name and picture you choose, your friends list, what you're watching right now, the titles you've watched with your ratings, your watch progress and library (when sync is on), profile text, messages you send, and watch-together room state. No video ever passes through it.
- **Problem reports** (on by default once online, can be turned off in Settings → Online) send the title, the source and the player's own log of what went wrong. Web addresses in them are cut short so no sign-in links are sent.
- **Never sent anywhere by Catalog:** your TMDB or OMDb keys, your Febbox sign-in, or anything else from Settings. Exports and backups leave those out too.
- **Other services see your IP address** when Catalog asks them for something: TMDB, AniList, OMDb (posters, details, scores), MusicBrainz, AnimeThemes and Jikan (music credits), subtitle sites, the sites videos are played from, and GitHub (updates). Each has its own privacy policy, and Catalog can't control what they log.
- **Messages** between friends are stored on the Catalog online server so they can be delivered, and are deleted after 90 days (a watch-together room's chat goes when the room ends). They are not end-to-end encrypted, so don't send anything private.

Each switch is in Settings → Online. Going offline there stops everything above except the outside services Catalog needs to show titles.

## Legal

**Catalog is a personal library and player for your own use.** Please read this before using it.

- Catalog does not host, store, upload or distribute any films, shows or other copyrighted material. Video is played directly from third-party websites that Catalog does not own, run or control.
- You are responsible for making sure you have the right to watch or download anything you open with Catalog, and for following the laws where you live. If a title is available legally where you are, please watch it there and support the people who made it.
- Catalog's author does not endorse copyright infringement and does not profit from Catalog in any way. Questions about a video's content should go to the site that hosts it.
- Titles, posters and other artwork belong to their owners and are shown only to identify what's in your library.
- This product uses the TMDB API but is not endorsed or certified by TMDB. Catalog is not affiliated with TMDB, AniList, OMDb, MusicBrainz, AnimeThemes, MyAnimeList, YouTube, or any video or subtitle site.
- Catalog is provided as it is, without warranty of any kind. Its author is not liable for any loss or damage from using it, including lost library data. Keep a backup of your library.

## Commands

```
npm run dev        development server with live reload
npm run app        run the desktop app from source
npm run release    build, pack, and publish a new version
npm run backup     back up now
npm run restore    preview a restore (-- --write to apply)
npm run check      type-check the project
```

## Where things are

| What | Where |
| --- | --- |
| Colours and fonts | `src/app.css` — all tokens at the top |
| Every database query | `src/lib/server/db/queries.ts` |
| Schema and migrations | `src/lib/server/db/index.ts` |
| External data sources | `src/lib/server/metadata/` |
| Desktop wrapper | `electron/main.cjs` |
