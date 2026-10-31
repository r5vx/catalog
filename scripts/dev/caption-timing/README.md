# Live caption timing test (2026-10-31)

How late a live channel's captions are, by matching their words to what's said.

1. Record a captioned channel through a test app (any way that saves the relayed pieces, in order,
   into one `.ts`).
2. `node captions-from-ts.mjs game.ts caps.json` reads the CEA-608 caption bytes from the video (H.264
   "GA94" SEI) and writes each word with when it arrived. It prints the video's start time.
3. `ffprobe -select_streams a:0 -show_entries stream=start_time game.ts` (the sound's start), then
   `ffmpeg -i game.ts -vn -af "aresample=async=1:first_pts=0" -ac 1 -ar 16000 -f f32le game.f32`.
4. `hear.mjs` needs `@huggingface/transformers` (3.7.5): install it in a scratch folder (not this repo)
   copy `hear.mjs` there and run it there: `node hear.mjs game.f32 heard.json` (Whisper base.en, ~75 MB,
   downloaded once into a `models` folder beside it).
5. `node match.mjs caps.json heard.json <video start − sound start>` prints the lag overall and per minute.

Kent State vs Sacramento State, ESPN2: 773 matches, 5.28 s late (5.10–5.49), steady every minute.
