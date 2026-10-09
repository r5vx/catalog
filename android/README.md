# Catalog for Fire TV

A tiny Android TV app: Catalog's own pages, shown full screen from a computer in the same house
that has Catalog open. Nothing runs on the TV but this window.

- `AndroidManifest.xml` — a TV app (shows in the Fire TV's app row), allowed plain-HTTP to the home network.
- `src/app/catalog/tv/MainActivity.java` — the window. Finds the computer (UDP broadcast
  `CATALOG_DISCOVER` on port 41734, answered by `electron/main.cjs`), adds Febbox's Referer to
  video requests (what the desktop app does too), passes the remote's Back / play-pause /
  fast-forward / rewind / menu buttons to the page, and handles full screen.
- `assets/setup.html` — the first screen: pick the computer, or type its address.
- `catalog-tv.keystore` — the signing key. **Keep it.** An update signed with another key won't
  install over the app; it would have to be uninstalled first.

Catalog itself switches to TV mode when it sees `CatalogTV/` in the user agent: see
`src/lib/tv.ts` (arrow-key navigation) and the TV parts of `src/routes/watch/+page.svelte`.
To try TV mode on a computer, set localStorage `catalog:tv` to `1`.

## Building

```
npm run tv
```

Needs the Android SDK (platform 34, build-tools 34) in `%LOCALAPPDATA%\Android\Sdk` and a JDK.
No Gradle. Writes `dist-tv/Catalog-TV.apk` and copies it to `static/catalog-tv.apk`, which is how
a TV gets it: Downloader on the TV opens `http://<computer>:4173/catalog-tv.apk`.

Bump `versionCode` in the manifest for each new version, or the TV won't install it as an update.
