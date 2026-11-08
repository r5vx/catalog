# YouTube's TV interface with Catalog's ad stripping (prototype, 2026-11-03)

Proves the plan for YouTube on the family's TVs without any outside app.

- `formats.js`: YouTube's TV app asks about video formats the way TVs do ("...; width=3840"), and
  checks with nonsense values a real TV refuses. A browser says yes to those, so YouTube refused to
  play ("This video format is not supported"). This answers like a TV (up to 1080p, 60 fps, SDR).
- `prune.js`: removes the ad parts (`adPlacements`, `playerAds`, `adSlots`, ...) from YouTube's data
  before its page reads it (wraps `JSON.parse` and `Response.json`).
- `main.cjs`: an off-screen, muted Electron window at 960x540 that loads https://www.youtube.com/tv,
  picks Watch as guest, opens a video and logs what plays. Run from the repo root:
  `NAME=tizen PRUNE=1 UA='<user agent>' npx electron scripts/dev/youtube-tv/main.cjs --user-data-dir=<scratch>`
  (it expects `preload.js` = formats.js + prune.js beside it; `preload-plain.js` = formats.js).

Results (Despacito, kJQP7kiw5Fk):
- Fire TV's own YouTube user agent (Cobalt): the TV interface loads, but videos say "format not
  supported" even with formats.js (YouTube expects more of Cobalt).
- Samsung (Tizen) or LG (webOS) TV user agent: plays. Without stripping a 15 s ad plays first; with
  it, 8 ad entries removed and the video starts at once (4:41, its real length).
- Streaming is YouTube's SABR (server-driven), handled by YouTube's own page; ads did not come
  inside the video stream in this test.
