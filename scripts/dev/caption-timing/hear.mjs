// Words heard in a recording, with when each was said: Whisper (base.en) on 16 kHz mono sound.
// node hear.mjs <sound.f32> <out.json> [model]
import fs from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';
env.cacheDir = new URL('./models/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const [input, out, model = 'Xenova/whisper-base.en'] = process.argv.slice(2);
const raw = fs.readFileSync(input);
const sound = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const hear = await pipeline('automatic-speech-recognition', model, { dtype: 'q8' });
const started = Date.now();
const result = await hear(sound, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
const words = result.chunks.map((c) => ({ w: c.text.trim(), at: c.timestamp[0], end: c.timestamp[1] }));
fs.writeFileSync(out, JSON.stringify(words));
console.log(`${words.length} words from ${(sound.length / 16000 / 60).toFixed(1)} min of sound in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(words.slice(0, 40).map((w) => `${w.at?.toFixed(1)}:${w.w}`).join(' '));
