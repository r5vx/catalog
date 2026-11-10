# A stand-in for Catalog, for trying the iPhone app on the Mac builder (ios/try-simulator.sh).
# It answers on http://127.0.0.1:8765 with a few tiny pages, each for one thing the app must do:
#
#   /                  prints what the app says it is, and writes a note into the page's private
#                      files (the place Catalog's "Keep on this phone" puts videos)
#   /api/diagnostics   what the app asks to see whether Catalog is there
#   /offline.html      a small copy of Catalog's no-connection page: reads that note back
#   /leave             goes to YouTube by itself, as Catalog's YouTube button does
#   /save              saves a file, as "Save to this device" does
#   /file              the file it saves
from http.server import BaseHTTPRequestHandler, HTTPServer

STYLE = '<meta name=viewport content="width=device-width, initial-scale=1"><body style="background:#181f1c;color:#eee;font:17px -apple-system;padding:20px;word-break:break-word">'

HOME = STYLE + """<h2>Stand-in Catalog page</h2><p id=a></p><p id=b></p><p id=c></p>
<script>
a.textContent = navigator.userAgent;
try { localStorage.setItem('note', 'remembered by the Catalog page'); } catch (e) {}
b.textContent = 'Message channel to the app: ' + (window.webkit && webkit.messageHandlers && webkit.messageHandlers.catalog ? 'yes' : 'no');
(async function () {
  try {
    var root = await navigator.storage.getDirectory();
    var dir = await root.getDirectoryHandle('kept', { create: true });
    var file = await dir.getFileHandle('note.txt', { create: true });
    var out = await file.createWritable();
    await out.write('written by the Catalog page');
    await out.close();
    c.textContent = 'Private files: note written (secure page: ' + isSecureContext + ')';
  } catch (e) { c.textContent = 'Private files: ' + e + ' (secure page: ' + isSecureContext + ')'; }
})();
</script>"""

# (The words catalog:keptPlaces are how the app knows this is the real no-connection page.)
OFFLINE = STYLE + """<h2>Stand-in no-connection page</h2><p>catalog:keptPlaces</p><p id=a></p><p id=c></p>
<script>
a.textContent = 'Shown as: ' + location.href + ' | remembered: ' + (function () { try { return localStorage.getItem('note'); } catch (e) { return e; } })();
(async function () {
  try {
    var root = await navigator.storage.getDirectory();
    var dir = await root.getDirectoryHandle('kept', { create: true });
    var file = await (await dir.getFileHandle('note.txt')).getFile();
    c.textContent = 'Note kept on the phone: ' + await file.text();
  } catch (e) { c.textContent = 'Note kept on the phone: could not read (' + e + ')'; }
})();
</script>"""

LEAVE = STYLE + """Going to YouTube
<script>setTimeout(function () { location.href = 'https://m.youtube.com/'; }, 1500);</script>"""

SAVE = STYLE + """<h2>Saving a file</h2><a id=l href="/file" download>Save to this device</a>
<script>setTimeout(function () { l.click(); }, 1500);</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        kind = 'text/html; charset=utf-8'
        extra = {}
        if path.startswith('/api/diagnostics'):
            body, kind = b'{"ok":true}', 'application/json'
        elif path == '/offline.html':
            body = OFFLINE.encode()
        elif path == '/leave':
            body = LEAVE.encode()
        elif path == '/save':
            body = SAVE.encode()
        elif path == '/file':
            body, kind = b'0' * 300000, 'video/mp4'
            extra['Content-Disposition'] = 'attachment; filename="Test film.mp4"'
        else:
            body = HOME.encode()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        for name, value in extra.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
