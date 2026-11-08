/**
 * Where a Fire TV gets the Catalog TV app without typing a computer's address: a link that never
 * changes (the app as it is in the repository on GitHub, updated with each release), and the
 * AFTVnews Downloader code that points to it (made once at go.aftvnews.com, 2026-10-31).
 */
export const FIRE_TV_APK = 'https://raw.githubusercontent.com/r5vx/catalog/main/static/catalog-tv.apk';
export const FIRE_TV_CODE = '5785169';

/**
 * The Fire TV app's newest version (versionCode in android/AndroidManifest.xml; keep them the
 * same). A TV app older than this is offered the update from the computer (TvUpdated.svelte);
 * from 1.4 (version 5) on it installs itself, with no Downloader.
 */
export const TV_APP_VERSION = 9;
