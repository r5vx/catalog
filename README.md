# Catalog

A personal library of everything you've watched — films, TV, anime. Runs as a desktop app on your PC and is reachable from your phone.

## Install

Download **Catalog-Setup.exe** from the [latest release](https://github.com/r5vx/catalog/releases/latest). Windows will warn about an unknown publisher — click **More info → Run anyway**. Updates happen automatically.

Your library lives on your PC. Nothing is uploaded, no account needed.

## Setup

**Movies & TV search** — needs a free [TMDB](https://www.themoviedb.org) API key. Paste it in **Settings → Services**. Either the API Key or the Read Access Token works.

**IMDb / RT / Metacritic scores** — optional. Get a free [OMDb](https://www.omdbapi.com/apikey.aspx) key and paste it in the same place.

Anime works without any keys.

## Phone access

Install [Tailscale](https://tailscale.com) on both devices, sign in with the same account. Open Catalog on your PC, then visit `http://<your-tailscale-ip>:4173` on your phone. Add to Home Screen for the app icon.

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
