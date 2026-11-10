#!/bin/bash
#
# Runs the app in the Mac builder's pretend iPhone and takes pictures of it, since there's no
# iPhone to try it on there. Four pictures land in build-ios/shots:
#
#   1-setup.png         the first-time screen (no computer picked yet)
#   2-catalog.png       a stand-in "Catalog" page: shows what the app tells Catalog's pages about itself
#   3-youtube.png       YouTube opened inside the app (the pink circle should be beside its logo)
#   4-handed-over.png   a Catalog page going to YouTube: handed to the app's YouTube (pink circle again)
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

# 1. First start.
xcrun simctl launch "$DEVICE" "$ID"
sleep 8
xcrun simctl io "$DEVICE" screenshot "$SHOTS/1-setup.png"
xcrun simctl terminate "$DEVICE" "$ID" || true

# 2. A stand-in for Catalog on this Mac: answers /api/diagnostics, and a page that prints what
#    the app says it is.
python3 - <<'EOF' &
from http.server import BaseHTTPRequestHandler, HTTPServer
PAGE = b"""<!doctype html><meta name=viewport content="width=device-width, initial-scale=1">
<body style="background:#181f1c;color:#eee;font:17px -apple-system;padding:20px;word-break:break-word">
<h2>Stand-in Catalog page</h2><p id=a></p><p id=b></p>
<script>
a.textContent = navigator.userAgent;
b.textContent = 'Message channel to the app: ' + (window.webkit && webkit.messageHandlers && webkit.messageHandlers.catalog ? 'yes' : 'no');
</script>"""
LEAVE = b"""<!doctype html><body style="background:#181f1c;color:#eee">Going to YouTube
<script>setTimeout(function () { location.href = 'https://m.youtube.com/'; }, 1500);</script>"""
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"ok":true}' if self.path.startswith('/api/diagnostics') else LEAVE if self.path.startswith('/leave') else PAGE
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if self.path.startswith('/api/') else 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
HTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
EOF
SERVER=$!
sleep 2
xcrun simctl spawn "$DEVICE" defaults write "$ID" catalogAddress "http://127.0.0.1:8765"
xcrun simctl launch "$DEVICE" "$ID"
sleep 10
xcrun simctl io "$DEVICE" screenshot "$SHOTS/2-catalog.png"
xcrun simctl terminate "$DEVICE" "$ID" || true

# 3. YouTube inside the app (the app opens it at once when started with this switch).
xcrun simctl launch "$DEVICE" "$ID" -openYouTubeAtStart YES
sleep 25
xcrun simctl io "$DEVICE" screenshot "$SHOTS/3-youtube.png"
xcrun simctl terminate "$DEVICE" "$ID" || true

# 4. A Catalog page that goes to a YouTube address by itself (what Catalog's YouTube button does):
#    the app should hand it to its own YouTube, so the pink circle should be there here too.
xcrun simctl spawn "$DEVICE" defaults write "$ID" catalogAddress "http://127.0.0.1:8765/leave"
xcrun simctl launch "$DEVICE" "$ID"
sleep 25
xcrun simctl io "$DEVICE" screenshot "$SHOTS/4-handed-over.png"
xcrun simctl terminate "$DEVICE" "$ID" || true

kill "$SERVER" 2>/dev/null || true
ls -l "$SHOTS"
