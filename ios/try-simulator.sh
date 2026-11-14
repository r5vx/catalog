#!/bin/bash
#
# Runs the app in the Mac builder's pretend iPhone and takes pictures of it, since there's no
# iPhone to try it on there. The pictures land in build-ios/shots:
#
#   1-setup.png         the first-time screen (no computer picked yet)
#   2-catalog.png       a stand-in "Catalog" page: shows what the app tells Catalog's pages about itself,
#                       and writes a note into the page's private files (where Keep on this phone goes)
#   3-youtube.png       YouTube opened inside the app (the pink circle should be beside its logo)
#   4-handed-over.png   a Catalog page going to YouTube: handed to the app's YouTube (pink circle again)
#   5-saved.png         a Catalog page saving a file: the "Saved" line, and the file listed in the log
#   6-offline.png       the stand-in Catalog switched off: the kept no-connection page, reading the note back
#
# Run after: bash ios/build.sh simulator
set -uo pipefail
cd "$(dirname "$0")/.."

APP=build-ios/sim/Catalog.app
SHOTS=build-ios/shots
ID=app.catalog.phone
mkdir -p "$SHOTS"

DEVICE="$(xcrun simctl list devices available | grep -E '^\s+iPhone' | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}')"
if [ -z "$DEVICE" ]; then
	echo "No pretend iPhone on this Mac."
	xcrun simctl list devices available
	exit 1
fi
echo "Pretend iPhone: $DEVICE"
xcrun simctl boot "$DEVICE" || true
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$APP"

shot() {
	xcrun simctl io "$DEVICE" screenshot "$SHOTS/$1"
	xcrun simctl terminate "$DEVICE" "$ID" || true
}
address() {
	xcrun simctl spawn "$DEVICE" defaults write "$ID" catalogAddress "$1"
}

# 1. First start.
xcrun simctl launch "$DEVICE" "$ID"
sleep 8
shot 1-setup.png

# A stand-in for Catalog on this Mac (ios/stand-in-catalog.py says what each page does).
python3 ios/stand-in-catalog.py &
SERVER=$!
sleep 2

# 2. The stand-in Catalog page.
address "http://127.0.0.1:8765"
xcrun simctl launch "$DEVICE" "$ID"
sleep 12
shot 2-catalog.png

# 3. YouTube inside the app (the app opens it at once when started with this switch).
xcrun simctl launch "$DEVICE" "$ID" -openYouTubeAtStart YES
sleep 25
shot 3-youtube.png

# 4. A Catalog page that goes to a YouTube address by itself (what Catalog's YouTube button does):
#    the app should hand it to its own YouTube, so the pink circle should be there here too.
address "http://127.0.0.1:8765/leave"
xcrun simctl launch "$DEVICE" "$ID"
sleep 25
shot 4-handed-over.png

# 5. A Catalog page that saves a file ("Save to this device" on the Downloads page).
address "http://127.0.0.1:8765/save"
xcrun simctl launch "$DEVICE" "$ID"
sleep 9
shot 5-saved.png
DATA="$(xcrun simctl get_app_container "$DEVICE" "$ID" data)"
echo "Files the app saved:"
ls -l "$DATA/Documents" || true
echo "The app's diary:"
cat "$DATA/Library/Caches/catalog-app.log" || true

# 6. Catalog switched off: the app shows the no-connection page it kept in step 2.
kill "$SERVER" 2>/dev/null || true
sleep 1
address "http://127.0.0.1:8765"
xcrun simctl launch "$DEVICE" "$ID"
sleep 12
shot 6-offline.png

ls -l "$SHOTS"
