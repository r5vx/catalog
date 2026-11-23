/**
 * Kitsunekko (kitsunekko.net): fans' anime subtitle files, one folder a show. Some old shows have
 * nothing anywhere else: Jungle King Tar-chan's English is ARR's, kept there as zips of VobSub
 * picture subtitles (an .idx and a .sub an episode), which are read into text (pictureSubs.ts).
 *
 * - The list of shows is read once a week; a show's folder is the one whose name is the same as
 *   one of the show's names, give or take a letter ("Tar-chan" / "Taa-chan").
 * - A zip is downloaded once and kept on this computer (<library folder>/kitsunekko); only the
 *   episode's file is taken out of it, in memory.
 * - Picture subtitles take a minute or so to read the first time: what's read so far is shown, and
 *   the rest comes in as it's read (like a Nyaa file's own track). The text is kept after.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { dataDir } from '../db';
import { getOrderCache, saveOrderCache } from '../db/queries';
import { parseIdx, readPictures, spuAt, toSrt, type Cue } from '../pictureSubs';
import { fetchSubtitle } from '../subtitleFetch';

const SITE = 'https://kitsunekko.net';
const DAY = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const keptDir = join(dataDir, 'kitsunekko');

async function page(url: string): Promise<string> {
	const resp = await fetchSubtitle(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
	if (!resp.ok) throw new Error(`Kitsunekko answered ${resp.status}`);
	return resp.text();
}

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"');
/** A name squashed for comparing: letters and numbers only. */
const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** How many letters to change to make one into the other (stops counting past `most`). */
function distance(a: string, b: string, most: number): number {
	if (Math.abs(a.length - b.length) > most) return most + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let low = i;
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			low = Math.min(low, row[j]);
		}
		if (low > most) return most + 1;
		prev = row;
	}
	return prev[b.length];
}

/** Every show folder's name, kept a week. */
async function folders(): Promise<string[]> {
	const kept = getOrderCache('kitsunekko-folders');
	if (kept && Date.now() - kept.at < 7 * DAY && Array.isArray(kept.value)) return kept.value as string[];
	const html = await page(`${SITE}/dirlist.php?dir=subtitles%2F`);
	const names = [...html.matchAll(/href="\/dirlist\.php\?dir=subtitles%2F([^"]+?)%2F"/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, ' ')));
	const unique = [...new Set(names)];
	if (unique.length > 100) saveOrderCache('kitsunekko-folders', unique, Date.now());
	return unique;
}

/** The show's folder: one of its names exactly, or within a letter in twelve. */
async function folderFor(names: string[]): Promise<string | null> {
	const all = await folders();
	const wanted = names.map(squash).filter((n) => n.length >= 4);
	for (const n of wanted) {
		const same = all.find((f) => squash(f) === n);
		if (same) return same;
	}
	let best: { f: string; d: number } | null = null;
	for (const n of wanted) {
		const most = Math.max(1, Math.floor(n.length / 12));
		for (const f of all) {
			const d = distance(squash(f), n, most);
			if (d <= most && (!best || d < best.d)) best = { f, d };
		}
	}
	return best?.f ?? null;
}

type Listed = { name: string; url: string };

/** A folder's files, kept a day. */
async function filesIn(folder: string): Promise<Listed[]> {
	const key = `kitsunekko-files|${folder}`;
	const kept = getOrderCache(key);
	if (kept && Date.now() - kept.at < DAY && Array.isArray(kept.value)) return kept.value as Listed[];
	const html = await page(`${SITE}/dirlist.php?dir=${encodeURIComponent(`subtitles/${folder}/`).replace(/%20/g, '+')}`);
	const files = [...html.matchAll(/<a href="(subtitles\/[^"]+)"[^>]*><strong>([^<]+)<\/strong>/g)].map((m) => ({ name: unescape(m[2]).trim(), url: `${SITE}/${encodeURI(unescape(m[1]))}` }));
	saveOrderCache(key, files, Date.now());
	return files;
}

/* ------------------------------------------------------------------ which file is the episode */

/** The episode numbers a name holds: one ("- 05", "E05") or a range ("01-10"). */
function numbersIn(name: string): { from: number; to: number } | null {
	const plain = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\.(zip|rar|7z|srt|ass|ssa|idx|sub|vtt)$/i, '');
	// ("01-10", never "2 - 05": that's season 2's fifth.)
	const range = plain.match(/\b(\d{1,4})[-~](\d{1,4})\b/);
	if (range && +range[2] > +range[1]) return { from: +range[1], to: +range[2] };
	const one = plain.match(/(?:\bE|\bEp\.?\s*|[\s_-])(\d{1,4})(?:v\d)?\s*$/i) ?? plain.match(/(?:\bE|\bEp\.?\s*|\s-\s)(\d{1,4})(?:v\d)?\b/i);
	return one ? { from: +one[1], to: +one[1] } : null;
}
const holds = (name: string, n: number) => {
	const r = numbersIn(name);
	return r !== null && r.from <= n && n <= r.to;
};

/* ------------------------------------------------------------------ zips */

/** A zip's files by name (stored or deflated only), read from the kept copy. */
function unzip(zip: Buffer): Map<string, () => Buffer> {
	const out = new Map<string, () => Buffer>();
	let end = zip.length - 22;
	while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
	if (end < 0) return out;
	const count = zip.readUInt16LE(end + 10);
	let p = zip.readUInt32LE(end + 16);
	for (let i = 0; i < count && p + 46 <= zip.length; i++) {
		if (zip.readUInt32LE(p) !== 0x02014b50) break;
		const method = zip.readUInt16LE(p + 10);
		const size = zip.readUInt32LE(p + 20);
		const nameLength = zip.readUInt16LE(p + 28);
		const extra = zip.readUInt16LE(p + 30);
		const comment = zip.readUInt16LE(p + 32);
		const local = zip.readUInt32LE(p + 42);
		const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
		p += 46 + nameLength + extra + comment;
		if (name.endsWith('/') || (method !== 0 && method !== 8)) continue;
		out.set(name, () => {
			const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
			const data = zip.subarray(start, start + size);
			return method === 8 ? inflateRawSync(data) : Buffer.from(data);
		});
	}
	return out;
}

async function keptFile(url: string): Promise<Buffer> {
	const file = join(keptDir, createHash('sha1').update(url).digest('hex').slice(0, 20));
	if (existsSync(file)) return readFileSync(file);
	const resp = await fetchSubtitle(url, { headers: { 'User-Agent': UA, Referer: `${SITE}/` }, signal: AbortSignal.timeout(60_000) });
	if (!resp.ok) throw new Error(`Kitsunekko answered ${resp.status}`);
	const data = Buffer.from(await resp.arrayBuffer());
	mkdirSync(keptDir, { recursive: true });
	writeFileSync(file, data);
	return data;
}

/* ------------------------------------------------------------------ the subtitles list */

export type KitsunekkoSubtitle = { id: string; url: string; lang: string; language: string; fileName: string; source: string };
const TEXT = /\.(srt|ass|ssa|vtt)$/i;

/** A subtitle's address: `kitsunekko:<file url>|<name inside the zip, or ''>`. */
const addressOf = (url: string, inside: string) => `kitsunekko:${url}|${inside}`;
function parseAddress(address: string): { url: string; inside: string } | null {
	const m = address.match(/^kitsunekko:(https:\/\/kitsunekko\.net\/[^|]+)\|(.*)$/);
	return m ? { url: m[1], inside: m[2] } : null;
}

/**
 * The show's subtitles for episode `n` (counting from the series' first episode when `overall`
 * is given and the folder numbers that way). Text files as they are; VobSub pairs read from pictures.
 */
export async function kitsunekkoSubtitles(names: string[], n: number, overall?: number): Promise<KitsunekkoSubtitle[]> {
	const folder = await folderFor(names);
	if (!folder) return [];
	const files = await filesIn(folder);
	const out: KitsunekkoSubtitle[] = [];
	for (const number of [...new Set([n, overall ?? n])]) {
		for (const f of files.filter((f) => holds(f.name, number))) {
			if (TEXT.test(f.name) || /\.idx$/i.test(f.name)) {
				out.push(option(f.url, '', f.name, /\.idx$/i.test(f.name)));
				continue;
			}
			if (!/\.zip$/i.test(f.name)) continue;
			const zip = unzip(await keptFile(f.url).catch(() => Buffer.alloc(0)));
			for (const inside of zip.keys()) {
				const base = inside.split('/').pop() ?? inside;
				if (!holds(base, number)) continue;
				if (TEXT.test(base)) out.push(option(f.url, inside, base, false));
				else if (/\.idx$/i.test(base) && zip.has(inside.replace(/\.idx$/i, '.sub'))) out.push(option(f.url, inside, base, true));
			}
		}
		if (out.length) break;
	}
	return out;
}

function option(url: string, inside: string, name: string, pictures: boolean): KitsunekkoSubtitle {
	const address = addressOf(url, inside);
	return {
		id: `kitsunekko-${createHash('sha1').update(address).digest('hex').slice(0, 10)}`,
		url: address,
		lang: 'en',
		language: 'English',
		fileName: pictures ? `${name.replace(/\.idx$/i, '')} (read from pictures)` : name,
		source: 'Kitsunekko'
	};
}

/* ------------------------------------------------------------------ the text */

type Reading = { cues: Cue[]; done: boolean; failed: boolean };
const readings = new Map<string, Reading>();

/**
 * A Kitsunekko subtitle's text. Picture subtitles: what's read so far (`complete` false until the
 * last line is read; the player asks again). Kept once whole.
 */
export async function kitsunekkoText(address: string): Promise<{ text: string; complete: boolean } | null> {
	const where = parseAddress(address);
	if (!where) return null;
	const keptKey = `kitsunekko-text|${address}`;
	const kept = getOrderCache(keptKey);
	if (kept && typeof kept.value === 'string') return { text: kept.value, complete: true };

	const data = await keptFile(where.url).catch(() => null);
	if (!data) return null;
	const zip = where.inside ? unzip(data) : null;
	const fileOf = (name: string) => (zip ? zip.get(name)?.() ?? null : name === where.inside ? data : null);
	const name = where.inside || where.url;

	if (TEXT.test(name)) {
		const raw = where.inside ? fileOf(where.inside) : data;
		return raw ? { text: raw.toString('utf8').replace(/^﻿/, ''), complete: true } : null;
	}
	if (!/\.idx$/i.test(name)) return null;

	let reading = readings.get(address);
	if (!reading) {
		const idxData = where.inside ? fileOf(where.inside) : data;
		// (A lone .idx listed on its own: its .sub sits beside it in the folder.)
		const subData = where.inside ? fileOf(where.inside.replace(/\.idx$/i, '.sub')) : await keptFile(where.url.replace(/\.idx$/i, '.sub')).catch(() => null);
		if (!idxData || !subData) return null;
		const index = parseIdx(idxData.toString('latin1'));
		const lines = index.entries.map((e) => ({ ms: e.ms, spu: spuAt(subData, e.pos) })).filter((l): l is { ms: number; spu: Buffer } => Boolean(l.spu));
		const job: Reading = { cues: [], done: false, failed: false };
		readings.set(address, job);
		reading = job;
		// Read in batches so the lines read so far can be shown.
		void (async () => {
			try {
				for (let i = 0; i < lines.length; i += 25) {
					const batch = lines.slice(i, i + 26); // (one more: the next line's start ends the last)
					const cues = await readPictures(batch, index.palette);
					job.cues.push(...cues.filter((c) => c.start < (lines[i + 25]?.ms ?? Infinity)));
				}
				job.done = true;
				saveOrderCache(keptKey, toSrt(job.cues), Date.now());
				readings.delete(address);
			} catch (e) {
				console.warn('[kitsunekko] reading pictures failed:', e);
				job.failed = true;
				readings.delete(address);
			}
		})();
	}
	if (reading.failed) return null;
	return { text: toSrt(reading.cues), complete: reading.done };
}
