# Catalog for iPhone

A real iPhone app, so YouTube can open inside Catalog with no ads. A web page in Safari can't
change YouTube; an app that owns its own browser view can, the way the computer's window and the
Fire TV app do.

## What it is

Two pages in one app:

- **Catalog**: the pages from the computer Catalog runs on, exactly as in Safari. The first start
  asks for the computer's address (typed, or scanned from Settings → Phones).
- **YouTube**: YouTube's own mobile website, loaded straight from YouTube. The app puts two scripts
  at the top of every page of it:
  - `android/assets/youtube-tv.js`, the same no-ads script the computer and the Fire TV use
  - `ios/Catalog/youtube-phone.js`, the pink circle beside YouTube's logo that goes back to Catalog

Nothing of YouTube comes through the computer, so the phone is an ordinary YouTube visitor.
(The older way, YouTube's site fetched by the computer in `src/lib/server/youtubePhone.ts`, is what
stopped after a minute.)

## How Catalog's pages know

The app adds `CatalogPhone/1` to its user agent. `src/lib/phoneApp.ts` looks for it:

- a tap on any link to `/youtube` tells the app to open its own YouTube
- `/youtube` itself answers the app with a redirect to YouTube (the app takes any YouTube address)
- Settings → Phones shows "Connect to another computer"

## Files

| File | What |
| --- | --- |
| `Catalog/MainViewController.swift` | The whole app: both pages, where each link goes, the "couldn't reach" screen |
| `Catalog/WebViews.swift` | How the two pages are set up, and which addresses belong to which |
| `Catalog/SetupViewController.swift` | The first-time screen |
| `Catalog/ScannerViewController.swift` | The camera reading the code on Settings → Phones |
| `Catalog/Store.swift` | The saved address |
| `Catalog/Look.swift` | Colors and buttons |
| `Info.plist` | What iOS needs to know: name, version, permissions |
| `build.sh` | Builds `build-ios/Catalog.ipa` (Mac only) |
| `try-simulator.sh` | Runs it in the Mac's pretend iPhone and takes pictures |

## Building

It can't be built on Windows. GitHub's Mac builder does it: `.github/workflows/build-ios.yml` runs
on a push to the `ios-build` branch, or by hand from the Actions page. The run keeps
`Catalog.ipa` and the pictures under Artifacts.

There's no Xcode project: `build.sh` compiles the Swift files straight into an app folder, like the
Fire TV app is built without Gradle.

For a new version, raise `CFBundleShortVersionString` and `CFBundleVersion` in `Info.plist`.

## Installing (SideStore)

The `.ipa` is unsigned. SideStore signs it on the phone with the owner's own Apple ID:

1. SideStore is set up once per phone (sidestore.io; that part needs a computer).
2. Open `Catalog.ipa` on the phone with SideStore.
3. A free Apple ID signs apps for 7 days at a time. SideStore renews them by itself when it can;
   opening SideStore now and then keeps it going. A free Apple ID holds 3 apps.

## Not in the app yet

- Starting with no connection, and playing videos kept on the phone. The Home Screen web app
  (Safari → Add to Home Screen) still does that; what it kept stays with it, not with this app.
- Saving a download into the Files app.
- Telling the phone there's a newer app.
