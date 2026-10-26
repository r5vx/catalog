<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto, replaceState } from '$app/navigation';
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import Hls from 'hls.js';
	import { fetchAheadLoader, recentPieces } from '$lib/fetchAhead';
	import BackBar from '$lib/BackBar.svelte';
	import { p, pRandom } from '$lib/poison';
	import { bytesOf, pickFile, playableHere, PREFERRED_QUALITY } from '$lib/watch';
	import { isTv, tvPlayer } from '$lib/tv';
	import { PreviewStrip, keepPictures, keptPictures, askComputerForPictures, type StripVideo } from '$lib/previewStrip';
	import { SubtitleSync } from '$lib/subtitleSync';
	import { findAndKeepSkips, skipKeyOf, type Found } from '$lib/skipFinder';
	import { DownloadedSound } from '$lib/downloadedSound';
	import { withFound } from '$lib/skipMerge';
	import { ratePrompt } from '$lib/rateLater.svelte';
	import LiveStar from '$lib/LiveStar.svelte';
	import { sendSaved, type LiveGame } from '$lib/live';

	const pm = $derived(page.data.poisonMode);

	/*
	 * The computer's mini player (electron/miniPlayer.cjs) is this page in a small window of its
	 * own (`mini=1`), started on the copy the big player had (`fid`). The big one waits, paused and
	 * saving nothing (`inMini`), and carries on where the mini player got to (`backFromMini`).
	 */
	const miniMode = page.url.searchParams.get('mini') === '1';

	/**
	 * Live TV (/watch?live=<channel>&name=…&game=…, src/lib/live.ts): a channel plays in this same
	 * player, so it looks and works like everything else. Nothing is saved or looked up for it
	 * (its place, subtitles, skips, cast, auto-timing). The bar shows LIVE, or how far behind and
	 * "Go live"; the sources menu lists the game's other channels; captions the channel carries
	 * (CEA-608, which most American channels have) can be turned on in the subtitles menu.
	 */
	const liveMode = Number(page.url.searchParams.get('live')) > 0;
	/**
	 * A replay of a past game (/watch?replay=<id>&name=…, sources/replays.ts): played here too,
	 * with seeking, like a film; like Live, nothing is saved or looked up for it. The sources menu
	 * lists its versions (its site's servers).
	 */
	const replayMode = Boolean(page.url.searchParams.get('replay'));
	/** Live or a replay: Catalog's player for sports, without the library's parts. */
	const sportsMode = liveMode || replayMode;
	let replayVersions = $state<string[]>([]);
	let replayVersion = $state(0);
	/** The replay's picture (the site's), kept with its place for Continue Watching. */
	let replayPoster = '';
	let liveNow = $state({ id: Number(page.url.searchParams.get('live')) || 0, name: page.url.searchParams.get('name') ?? '' });
	let liveGame = $state<LiveGame | null>(null);
	let liveSaved = $state(false);
	/** The channel carries captions (found as it plays), and the ones heard so far. */
	let liveCaptions = $state(false);
	let liveCues: { start: number; end: number; text: string; top: boolean }[] = [];
	/**
	 * Live captions are typed by a person as the commentators talk, so they come a few seconds
	 * late, by however long that takes (measured on a CBS game: anywhere from on time to 8 s, about
	 * 2 s typically). Auto-timing can't follow that (tried, 2026-10-25: non-stop commentary and
	 * captions that stay up as they roll leave nothing to line up), so the delay set by hand for
	 * them is kept on this device for the next game.
	 */
	const LIVE_CAPTION_DELAY = 'catalog:liveCaptionDelay';
	$effect(() => {
		const delay = subtitleDelay;
		if (!sportsMode || !liveCaptions) return;
		try {
			localStorage.setItem(LIVE_CAPTION_DELAY, String(delay));
		} catch {}
	});
	/** Seconds behind live. */
	let liveBehind = $state(0);
	let liveNoted = false;
	let liveRestarts = 0;
	/** Opened from another of Catalog's pages (so Back can return there), not straight from a link. */
	let cameFromApp = false;
	afterNavigate(({ from }) => {
		if (from) cameFromApp = true;
	});
	let startFid: number | null = Number(page.url.searchParams.get('fid')) || null;
	let inMini = $state(false);
	/** In Catalog's own window on the computer (not a phone's or a TV's browser). */
	const inDesktopApp = typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent);

	interface Result {
		id: number;
		type: 'movie' | 'tv';
		title: string;
		posterUrl: string;
		info: string;
		/** Results found only on Showbox's search page have no id yet (it's looked up on picking). */
		slug?: string;
	}

	interface FileOption {
		fid: number;
		quality: string;
		name: string;
		size: string;
		/** Where it comes from when it isn't Showbox ("Aniwave"). */
		source?: string;
		/** What another source's file plays from. */
		shareKey?: string;
		/** "Japanese" or "English", when the source says. */
		audio?: string;
		/** Subtitles are part of the picture. */
		burnedIn?: boolean;
		/** HEVC video: left out where it can't be played. */
		hevc?: boolean;
	}

	/**
	 * A streaming playlist rather than a whole file. Everything through Catalog's relay is one —
	 * 7Movies' H.264 copy has no ".m3u8" in its address.
	 */
	const isPlaylist = (url: string) => url.includes('.m3u8') || url.startsWith('/api/watch/relay') || url.startsWith('/api/live/playlist');

	/** Where a file plays from: its own source, or the episode's Showbox share. */
	const shareOf = (f: FileOption | null | undefined) => f?.shareKey || shareKey;

	/* Japanese audio or the English dub, for files from another source: the last one picked. */
	const ANIME_AUDIO = 'catalog:animeAudio';

	/** Another source's English dub (Aniwave's "Dub"). */
	const isDub = (f: { audio?: string }) => f.audio === 'English';

	function animeAudio(): string {
		try {
			return localStorage.getItem(ANIME_AUDIO) ?? 'Japanese';
		} catch {
			return 'Japanese';
		}
	}

	/** "1080p · 2.1 GB", or for another source's file "Japanese audio" / "English dub". */
	function fileLabel(f: FileOption): string {
		if (f.audio === 'English') return 'English dub';
		if (f.audio) return f.burnedIn ? `${f.audio} audio · burned-in subs` : `${f.audio} audio`;
		if (f.hevc) return `${f.quality} · HEVC`;
		return f.size ? `${f.quality} · ${f.size}` : f.quality;
	}

	/*
	 * Some Showbox files only come in 360p (Madagascar's and Witch Hat Atelier's "1080p" files
	 * came as one 640×360 level, on Showbox's own site too) while others play in full — Febbox
	 * decides per file. Such a file is remembered for a day, so it isn't picked first again
	 * where another source has a better copy (7Movies' H.264 is 1080p).
	 */
	const LOW_ONLY = 'catalog:lowOnly:';
	// Once: on 2026-10-22 Febbox's daily limit made every file look 360p-only, and they were all
	// noted as such (see FEBBOX_OUT). Those notes go.
	try {
		if (!localStorage.getItem('catalog:lowOnlyCleared')) {
			for (const key of Object.keys(localStorage)) if (key.startsWith(LOW_ONLY)) localStorage.removeItem(key);
			localStorage.setItem('catalog:lowOnlyCleared', '1');
		}
	} catch {}
	function lowOnly(fid: number): boolean {
		try {
			return Date.now() - Number(localStorage.getItem(LOW_ONLY + fid) || 0) < 24 * 60 * 60 * 1000;
		} catch {
			return false;
		}
	}

	/** The best copy from another source, for a Showbox file that only comes in low quality. */
	function betterThanShowbox(files: FileOption[]): FileOption | null {
		const others = files.filter((f) => f.source && playableHere(f));
		return (
			others.find((f) => f.source === '7Movies' && !f.hevc) ??
			others.find((f) => f.source === 'Aniwave' && !f.burnedIn && (f.audio ?? '') === animeAudio()) ??
			others.find((f) => f.source === '7Movies') ??
			null
		);
	}

	/**
	 * A Showbox file of 720p or more whose playlist has nothing above 480p. Switches to another
	 * source's copy if there is one (true then: the rest of the start-up is skipped).
	 */
	function showboxHeldBack(heights: number[]): boolean {
		const best = Math.max(0, ...heights);
		const file = activeFile;
		if (!file || file.source || (parseInt(file.quality) || 0) < 720 || !best || best > 480) return false;
		const better = betterThanShowbox(currentFiles);
		// Why: Febbox's daily allowance (then every file is 360p for now), or this one file. Asked
		// alongside; the switch doesn't wait for it.
		fetch('/api/watch/febbox-flow')
			.then((r) => (r.ok ? (r.json() as Promise<{ out: boolean; resetsAt: number | null; account: string } | null>) : null))
			.catch(() => null)
			.then((flow) => {
				if (flow?.out) {
					try { localStorage.setItem(FEBBOX_OUT, `${flow.resetsAt ?? Date.now() + 3600_000}|${flow.account}`); } catch {}
					const hours = flow.resetsAt ? Math.round((flow.resetsAt - Date.now()) / 3600_000) : 0;
					const back = hours > 1 ? ` for about ${hours} more hours` : hours === 1 ? ' for about another hour' : '';
					showQualityToast(`Febbox's daily HD limit is used up${back}: ${better ? `playing ${better.source} instead` : '360p only'}`);
					return;
				}
				try { localStorage.setItem(LOW_ONLY + file.fid, String(Date.now())); } catch {}
				showQualityToast(better ? `Showbox only has ${best}p of this one: playing ${better.source} in HD instead` : `Showbox only has ${best}p of this one`);
			});
		if (!better) return false;
		setTimeout(() => changeToFile(better, true), 0);
		return true;
	}

	/*
	 * Febbox gives each account so much fast video a day (10 GB free; src/lib/server/febboxFlow.ts),
	 * then only 360p until it resets. Until then Showbox isn't tried first where another source has
	 * an HD copy, and its files aren't remembered as 360p-only (they aren't). Kept as "until|account":
	 * signing in with another account starts afresh (it used to carry on for the old one's 14 hours).
	 */
	const FEBBOX_OUT = 'catalog:febboxOut';
	/** The Febbox account signed in on the computer (a short name from /api/watch/resolve). */
	let febboxAccount = '';
	const FEBBOX_ACCOUNT = 'catalog:febboxAccount';
	function febboxOut(): boolean {
		try {
			const [until, account] = (localStorage.getItem(FEBBOX_OUT) ?? '').split('|');
			return Date.now() < Number(until || 0) && account === febboxAccount;
		} catch {
			return false;
		}
	}

	/**
	 * Showbox's best file; another source's only when Showbox has none for this episode — or
	 * when that source is the one picked for this show last time (Aniwave with subtitles in the
	 * picture, say), which then stays picked episode after episode.
	 */
	const pickFor = (files: FileOption[]) => {
		// The mini player starts on the copy the big player had.
		if (startFid !== null) {
			const start = files.find((f) => f.fid === startFid && playableHere(f));
			if (start) {
				startFid = null;
				return start;
			}
		}
		const kept = keptSource();
		// (7Movies has two copies: the one picked, where it was noted — older notes didn't say.)
		const same = kept && files.find((f) => f.source === kept.source && (f.audio ?? '') === kept.audio && !!f.burnedIn === kept.burnedIn && (kept.hevc === undefined || !!f.hevc === kept.hevc) && playableHere(f));
		if (same) return same;
		const showboxPick = keptShowboxCopy(files) ?? pickFile(files, preferredQuality, animeAudio());
		// A Showbox file known to come only in 360p (or Febbox's daily limit is used up): another
		// source's copy instead, if there is one.
		if (showboxPick && !showboxPick.source && (lowOnly(showboxPick.fid) || febboxOut())) return betterThanShowbox(files) ?? showboxPick;
		return showboxPick;
	};

	/*
	 * The source picked for a show, kept on this device. For Showbox, which of its copies: many
	 * shows have two of each episode (Dungeon Meshi: both languages in one, Japanese alone in the
	 * other), and the kind picked by hand carries on to the next episodes. It's told by the file's
	 * name with the numbers taken out, or else by being the bigger or the smaller one.
	 */
	type KeptSource = {
		source: string;
		audio: string;
		burnedIn: boolean;
		hevc?: boolean;
		showbox?: { quality: string; name: string; larger: boolean };
	};

	/** A file's name with its numbers taken out: "Danjon.meshi.s01e08.1080p.dual.mkv" → "danjon.meshi.#.#p.dual.mkv". */
	const nameKind = (name: string) => name.toLowerCase().replace(/s\d+\s*e\d+/g, '#').replace(/\d+/g, '#');

	/** The Showbox copy of the kind picked for this show last time, if one was. */
	function keptShowboxCopy(files: FileOption[]): FileOption | null {
		const kept = keptSource()?.showbox;
		if (!kept) return null;
		const own = files.filter((f) => !f.source && playableHere(f) && f.quality === kept.quality);
		const sameKind = own.find((f) => nameKind(f.name) === kept.name);
		if (sameKind || own.length < 2) return sameKind ?? null;
		const bySize = [...own].sort((a, b) => bytesOf(b.size) - bytesOf(a.size));
		return kept.larger ? bySize[0] : bySize[bySize.length - 1];
	}
	const keptSourceKey = () => `catalog:source:${(lastResolveArgs?.title ?? '').toLowerCase()}`;

	function keptSource(): KeptSource | null {
		try {
			return JSON.parse(localStorage.getItem(keptSourceKey()) ?? 'null');
		} catch {
			return null;
		}
	}

	function keepSource(file: FileOption) {
		try {
			if (file.source) {
				localStorage.setItem(keptSourceKey(), JSON.stringify({ source: file.source, audio: file.audio ?? '', burnedIn: !!file.burnedIn, hevc: !!file.hevc }));
				return;
			}
			const own = currentFiles.filter((f) => !f.source && f.quality === file.quality);
			const larger = own.every((f) => bytesOf(f.size) <= bytesOf(file.size));
			const kept: KeptSource = { source: '', audio: '', burnedIn: false, showbox: { quality: file.quality, name: nameKind(file.name), larger } };
			localStorage.setItem(keptSourceKey(), JSON.stringify(kept));
		} catch {}
	}

	/**
	 * A link for this copy, or — when its source has nothing right now — for the next copy from
	 * another source (Aniwave, 7Movies) this device can play. Empty `url` if none answers.
	 */
	const BURNED_IN_WAIT = 6000;
	async function linkFor(files: FileOption[], file: FileOption): Promise<{ file: FileOption; url: string; debug?: string }> {
		// Never a change of language by itself: someone watching in Japanese whose copy won't play
		// isn't put on the English dub (it stays in the list, to pick by hand).
		const wantDub = file.audio ? isDub(file) : hearingDub();
		const sameAudio = files.filter((f) => f !== file && playableHere(f) && isDub(f) === wantDub);
		// In this order: the same source's other copy (7Movies has two, Showbox often two sizes),
		// Showbox's best, the rest. (A Showbox pick used to have no Showbox copy to fall back on, so
		// a slow Febbox start put Dungeon Meshi E8 on Aniwave, 2026-10-23.)
		const showboxBest = file.source ? pickFile(sameAudio.filter((f) => !f.source), preferredQuality) : null;
		const others = [
			...sameAudio.filter((f) => (f.source ?? '') === (file.source ?? '')),
			...(showboxBest ? [showboxBest] : []),
			...sameAudio.filter((f) => f.source && f.source !== file.source)
		];
		// Subtitles in the picture can't be turned off or changed: such a copy only plays when
		// nothing else has answered a few seconds after it did (unless one was picked).
		const unwanted = (copy: FileOption) => Boolean(copy.burnedIn) && !file.burnedIn;
		const ask = async (copy: FileOption): Promise<{ url: string; debug?: string }> => {
			try {
				const resp = await fetch(`/api/watch/stream?share_key=${encodeURIComponent(shareOf(copy))}&fid=${copy.fid}`);
				return resp.ok ? await resp.json() : { url: '' };
			} catch {
				return { url: '' };
			}
		};
		// The copy picked gets 5 seconds to itself. Slower than that, or no link, and whichever of
		// the others answers first plays (the picked one still counts if it answers first). It used
		// to wait out the picked one's whole lookup — Movy took 50 s with Showbox right there.
		// The first two to fall back on are asked alongside, so a slow pick costs those 5 s and no
		// more; with no Showbox copy all of them are, since they'll likely be needed.
		const first = ask(file);
		const showboxHasIt = files.some((f) => !f.source && playableHere(f));
		const soon = others.map((copy, i) => (!showboxHasIt || i < 2 ? ask(copy) : null));
		const quick = await Promise.race([first, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
		if (quick?.url) return { file, url: quick.url, debug: quick.debug };
		const asked = soon.map((answer, i) => answer ?? ask(others[i]));
		let debug: string | undefined;
		const answers = [[file, first] as const, ...others.map((copy, i) => [copy, asked[i]] as const)].map(([copy, answer]) => ({
			copy,
			link: answer.then((data) => {
				debug = data.debug ?? debug;
				if (!data.url) throw new Error('no link');
				return { file: copy, url: data.url, debug: data.debug };
			})
		}));
		const wanted = answers.filter((a) => !unwanted(a.copy)).map((a) => a.link);
		const burnedIn = answers.filter((a) => unwanted(a.copy)).map((a) => a.link);
		const burnedInLater = burnedIn.length
			? Promise.any(burnedIn).then((link) => new Promise<typeof link>((r) => setTimeout(() => r(link), BURNED_IN_WAIT)))
			: null;
		try {
			return await Promise.any(burnedInLater ? [...wanted, burnedInLater] : wanted);
		} catch {
			return { file, url: '', debug };
		}
	}

	interface Episode {
		season: number;
		episode: number;
		files: FileOption[];
		/** The share it plays from, when it comes from another Showbox entry for this show. */
		shareKey?: string;
		/** False for an episode TMDB lists but no source has (shown greyed out). */
		available?: boolean;
		/** Its name from another source: an OVA's own name in Specials, or when TMDB has none. */
		name?: string;
		airDate?: string | null;
	}

	/**
	 * An episode's name. In Specials, Aniwave's OVAs carry their own names (TMDB numbers its
	 * specials differently); elsewhere TMDB's, with the source's own as a fallback.
	 */
	const nameOf = (ep: Episode): string | undefined =>
		ep.season === 0 ? (ep.name ?? episodeNames[ep.episode]) : (episodeNames[ep.episode] ?? ep.name);

	const playable = (ep: Episode | null | undefined): ep is Episode => Boolean(ep && ep.available !== false && ep.files.length);

	interface SubOption {
		id: string;
		url: string;
		lang: string;
		language: string;
		fileName: string;
		source?: string;
		/** Turns itself on when nothing was chosen before (anime in Japanese). */
		default?: boolean;
		/** Not a subtitle: passing anime.nexus's human check gets its subtitles. */
		check?: boolean;
		/** When its last line ends, in seconds (OpenSubtitles says): which cut it was made for. */
		lastAt?: number;
	}

	/**
	 * The subtitles made for the cut that's playing go first. A film's copies can be different cuts:
	 * Deadpool 2 is 1:59 on Showbox's 1080p file but 2:14 on its 4K one and on 7Movies (the Super
	 * Duper Cut), and the other cut's subtitles can't be lined up (a friend: "they wouldn't sync at
	 * all"). A file whose last line comes after the end of the video (allowing for a film-speed
	 * difference), or more than 16 minutes before it (credits are shorter), was made for another
	 * cut. Only files that say when they end are moved, among themselves; the rest keep their place.
	 */
	function byCut(list: SubOption[], length: number): SubOption[] {
		if (!(length > 600)) return list;
		const fits = (s: SubOption) => (s.lastAt! > length * 1.05 + 60 || length - s.lastAt! > 16 * 60 ? 1 : 0);
		const timed = list.filter((s) => s.lastAt);
		const ordered = [...timed].sort((a, b) => fits(a) - fits(b));
		let next = 0;
		return list.map((s) => (s.lastAt ? ordered[next++] : s));
	}

	/* --------------------------------------------------------------- content state */

	let loading = $state(true);
	let loadingStatus = $state('');
	let problem = $state('');
	let debugInfo = $state('');
	let streamUrl = $state('');
	let videoTitle = $state('');
	let showType = $state<'movie' | 'tv'>('movie');
	let shareKey = $state('');
	/** The show's own share. `shareKey` follows the episode playing, which may come from another. */
	let mainShareKey = '';
	let useIframe = $state(false);
	let iframeFid = $state(0);
	let needsLogin = $state(false);
	let loggedIn = $state(false);
	let watchPosterUrl = $state('');
	let hlsInstance: Hls | null = null;

	let movieFiles = $state<FileOption[]>([]);
	let episodes = $state<Episode[]>([]);
	let seasons = $state<number[]>([]);
	let activeSeason = $state(1);
	let activeEpisode = $state<Episode | null>(null);
	let activeQuality = $state('');
	let activeFileFid = $state(0);
	let preferredQuality = $state(PREFERRED_QUALITY);
	let sidebarOpen = $state(true);

	/* Shows whose episode list you closed: it stays closed next time you open them. */
	const EPISODES_HIDDEN = 'catalog:episodesHidden';

	function episodesHiddenFor(): Set<string> {
		try {
			return new Set(JSON.parse(localStorage.getItem(EPISODES_HIDDEN) ?? '[]'));
		} catch {
			return new Set();
		}
	}

	function toggleEpisodes() {
		sidebarOpen = !sidebarOpen;
		if (sidebarOpen) castOpen = false;
		const show = videoTitle.replace(/ S\d+E\d+$/, '');
		if (!show) return;
		const hidden = episodesHiddenFor();
		if (sidebarOpen) hidden.delete(show);
		else hidden.add(show);
		try {
			// Newest last; a few hundred shows is plenty.
			localStorage.setItem(EPISODES_HIDDEN, JSON.stringify([...hidden].slice(-300)));
		} catch {}
	}
	let loadingEpisode = $state(false);
	let changingQuality = $state(false);
	let qualityTimer: ReturnType<typeof setTimeout> | null = null;
	let prevStreamUrl = '';
	let prevFileFid = 0;
	let prevQuality = '';
	let qualityToast = $state('');
	let qualityToastTimer: ReturnType<typeof setTimeout> | null = null;

	let febboxSubs = $state<SubOption[]>([]);
	let loadingSubs = $state(false);
	let activeSubFid = $state('');
	let activeSubUrl = $state('');
	let activeSubFileName = $state('');
	let episodeNames = $state<Record<number, string>>({});

	interface CastMember { id: number; name: string; character: string; photo: string | null; }
	let castMembers = $state<CastMember[]>([]);
	let castOpen = $state(false);
	let loadingCast = $state(false);
	let preferredAudioName = $state('');
	/* Fill (the picture fills the screen) unless you picked Fit; your pick sticks for everything. */
	const VIDEO_FIT = 'catalog:videoFit';

	/**
	 * How subtitles look, picked in the captions menu and kept on this device: the dark box behind
	 * them or plain white text with an outline, and their size.
	 */
	const SUB_LOOK = 'catalog:subLook';
	const SUB_SIZES = [
		{ key: 'small', label: 'S', rem: 1.15 },
		{ key: 'normal', label: 'M', rem: 1.4 },
		{ key: 'large', label: 'L', rem: 1.8 },
		{ key: 'huge', label: 'XL', rem: 2.3 }
	] as const;
	type SubLook = { box: boolean; size: string; bold: boolean };
	let subLook = $state<SubLook>({ box: true, size: 'normal', bold: false });
	try {
		const kept = JSON.parse(localStorage.getItem(SUB_LOOK) ?? 'null');
		if (kept && typeof kept.box === 'boolean' && SUB_SIZES.some((s) => s.key === kept.size)) subLook = { ...subLook, ...kept };
	} catch {}
	function setSubLook(change: Partial<SubLook>) {
		subLook = { ...subLook, ...change };
		try {
			localStorage.setItem(SUB_LOOK, JSON.stringify(subLook));
		} catch {}
	}
	const subFontSize = $derived(`${SUB_SIZES.find((s) => s.key === subLook.size)?.rem ?? 1.4}rem`);

	/**
	 * Automatic subtitle timing (src/lib/subtitleSync.ts): on unless turned off in the captions
	 * menu, kept on this device. It hears the video and moves the delay to where the subtitles
	 * match the talking, part by part — only when it's sure.
	 */
	const SUB_AUTOSYNC = 'catalog:subAutoSync';
	let subAutoSync = $state(true);
	try {
		subAutoSync = localStorage.getItem(SUB_AUTOSYNC) !== '0';
	} catch {}

	/** Reset: back to auto-timing's delay when it has one, else no delay. */
	function resetSubtitleDelay() {
		if (!(subAutoSync && subSync?.backToTiming())) subtitleDelay = 0;
	}
	function toggleAutoSync() {
		subAutoSync = !subAutoSync;
		try {
			localStorage.setItem(SUB_AUTOSYNC, subAutoSync ? '1' : '0');
		} catch {}
	}
	let videoFit = $state<'contain' | 'cover'>('cover');

	function chooseFit(fit: 'contain' | 'cover') {
		videoFit = fit;
		try { localStorage.setItem(VIDEO_FIT, fit); } catch {}
	}



	let libraryEntryId = $state<number | null>(null);
	let libraryEntryStatus = $state('');
	/** Your rating of it (null: not rated), for "Rate it" when it's finished. */
	let libraryEntryRating = $state<number | null>(null);
	let libLastSeason = $state(0);
	let libLastEpisode = $state(0);
	let addingToLibrary = $state(false);
	let watchedEpisodeMap = $state<Map<string, number>>(new Map());
	let autoplayNext = $state(false);
	let autoplayFired = false;
	let skipResume = false;
	/**
	 * "Finished already: on to the next one" is only for the episode the player opened on. One
	 * picked by hand plays, even finished: a reload at 0:00 just after the pick (a copy that
	 * wouldn't play, so another was tried) asked again and jumped on, E12 to E13 (2026-10-23).
	 */
	let mayMoveOn = true;
	let switchingEpisode = false;
	/**
	 * The episode before is still in the video while another loads (its picture, its sound
	 * downloaded): hidden, and it won't play. It used to: pressing play while a new episode waited
	 * on Movy played the old one under the new one's name and "Loading episode".
	 */
	let oldPicture = $state(false);
	let refreshingStream = false;
	/** Bumped to reload the player even when a fresh link comes back identical. */
	let streamNonce = $state(0);
	/**
	 * Long video pieces come in short parts through the relay (relayPieces.ts). If a video in
	 * parts gets stuck or fails, it's reloaded with its pieces whole — exactly as before parts
	 * existed — for the rest of this visit, so the change can never leave a video worse off.
	 */
	let piecesWhole = false;
	const withPieces = (url: string) => (piecesWhole && url.startsWith('/api/watch/relay?') ? `${url}&whole=1` : url);
	let streamRefreshes = 0;
	let lastRefreshAt = 0;
	let stalledOut = $state(false);
	let stallTimer: ReturnType<typeof setInterval> | null = null;
	let stallSince = 0;
	let stallNudged = false;
	let stallReloaded = false;
	let lastBytesAt = 0;
	let mediaRecoveredAt = 0;
	let pendingQualityPrefetch: number[] = [];
	let nextPrefetchKey = '';
	let resolveFailed = $state(false);

	/** `mixed`: the story goes on over the song (see storyDuring). */
	interface SkipSegment { type: 'intro' | 'recap' | 'credits'; start: number; end: number; mixed?: boolean; }
	let skipSegments = $state<SkipSegment[]>([]);
	let skipLookupKey = '';
	let seekAfterLoad = 0;
	let restoreSub: { fileName: string; language: string; delay: number } | null = null;
	let resumeSeason = 0;
	let resumeEpisode = 0;
	let query = $state('');
	let results = $state<Result[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let resolving = $state(false);
	let isAuto = false;
	let lastResolveArgs = $state<{ title: string; type: string; year: string } | null>(null);

	let videoEl: HTMLVideoElement | undefined = $state();

	const seasonEpisodes = $derived(episodes.filter((ep) => ep.season === activeSeason));

	// HEVC copies only where this TV or computer can play them.
	const currentFiles = $derived(
		(showType === 'tv' && activeEpisode ? activeEpisode.files : movieFiles).filter(playableHere)
	);

	/* --------------------------------------------------------------- player control state */

	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let bufferedEnd = $state(0);
	/**
	 * What the computer has downloaded of this episode (7Movies and Movy: episodeDownloads.ts), as
	 * time ranges, drawn as a lighter shade on the bar. A TV holds only a minute or two of video
	 * (its memory), so its own buffered part stops short; the computer can hold the whole episode,
	 * and this shows how far it can play without waiting on the source.
	 */
	let heldRanges = $state<{ start: number; end: number }[]>([]);
	/** For the stats: how much of it the computer has, and how many pieces it's downloading now. */
	let heldCount = $state({ held: 0, total: 0, going: 0 });
	let gainNode: GainNode | undefined = $state();
	let audioCtx: AudioContext | undefined;
	let audioSource: MediaElementAudioSourceNode | undefined;
	/** This video's sound can't go through the page's audio (another site's file without CORS): it would be silent there. */
	let soundBlocked = false;
	let playbackRate = $state(1);
	let isFullscreen = $state(false);

	let showControls = $state(true);
	let controlsTimer: ReturnType<typeof setTimeout> | null = null;
	let cursorIdle = $state(false);
	let cursorTimer: ReturnType<typeof setTimeout> | null = null;
	let showSettings = $state(false);
	let showCaptions = $state(false);
	let showDelay = $state(false);
	let showAudioPicker = $state(false);
	let showFilePicker = $state(false);
	// The menus at the bottom close the sources menu at the top, as it closes them.
	$effect(() => {
		if (showSettings || showCaptions || showDelay || showAudioPicker) untrack(() => (showFilePicker = false));
	});
	let inPiP = $state(false);
	let seeking = $state(false);
	let seekPreview = $state(-1);
	let seekTarget = $state(-1);
	let buffering = $state(false);
	let isVideoSeeking = $state(false);
	let clickTimeout: ReturnType<typeof setTimeout> | null = null;
	let progressSaveTimer: ReturnType<typeof setInterval> | null = null;

	let progressBarEl: HTMLDivElement | undefined = $state();
	let playerPageEl: HTMLDivElement | undefined = $state();

	/** `text` is already-escaped HTML (only i/b/u survive); `top` came from an {\an8}-style tag. */
	/** `song`: a song's words or a sign on screen (by its style in the file), not anyone talking. */
	interface Cue { start: number; end: number; text: string; top: boolean; song?: boolean; }
	let subtitleCues = $state<Cue[]>([]);
	let subtitlesOn = $state(false);
	let subtitleDelay = $state(0);

	let hlsAudioTracks = $state<{ id: number; name: string; url: string }[]>([]);
	let hlsActiveAudio = $state(-1);
	let hlsLevels = $state<{ index: number; height: number; bitrate: number }[]>([]);
	let hlsActiveLevel = $state(-1);
	let videoResolution = $state('');

	// Stopping to load again and again (three times in two minutes, not counting jumps): it asks
	// rather than deciding — a fresh link (a link can land on a slow server), a lower quality, or
	// keep going. Never changes the quality by itself.
	/** Levels that can play here (H.264), lowest first. */
	let playableLevels: number[] = [];
	let slowStops: number[] = [];
	/** What the "keeps stopping" box offers: a lower level (−1 when there's none). */
	let slowOffer = $state<{ lower: number; height: number; freshLink: boolean; other: FileOption | null } | null>(null);
	/** "Keep loading" was picked for this video: not asked again. */
	let slowOfferDeclined = false;

	const SPEEDS = [
		{ value: 0.25, label: '0.25x' },
		{ value: 0.5, label: '0.5x' },
		{ value: 0.75, label: '0.75x' },
		{ value: 1, label: 'Normal' },
		{ value: 1.25, label: '1.25x' },
		{ value: 1.5, label: '1.5x' },
		{ value: 1.75, label: '1.75x' },
		{ value: 2, label: '2x' }
	];

	const activeFile = $derived(
		(activeFileFid ? currentFiles.find((f) => f.fid === activeFileFid) : null) ??
		currentFiles.find((f) => f.quality === activeQuality) ?? null
	);
	const progressPct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	const displayPct = $derived(
		seekPreview >= 0 ? seekPreview
			: seekTarget >= 0 && Math.abs(progressPct - seekTarget) > 1 ? seekTarget
			: progressPct
	);
	const bufferedPct = $derived(duration > 0 ? (bufferedEnd / duration) * 100 : 0);
	/**
	 * How much slower the subtitles run than they were written (auto-timing found them made for
	 * another speed: DVD subtitles at 25 frames a second against a 23.976 film). 1 almost always.
	 */
	let subtitleRate = $state(1);
	/** Subtitle time showing at video time `t`. */
	const subTimeAt = (t: number) => (t - subtitleDelay) / (subAutoSync ? subtitleRate : 1);
	const activeSubs = $derived(subtitlesOn ? subsAt(subTimeAt(currentTime)) : { top: '', bottom: '' });

	const inEndCredits = $derived(
		skipSegments.some((s) => s.type === 'credits' && s.end >= duration - 20 && currentTime >= s.start)
	);
	const nearEnd = $derived(
		showType === 'tv' && duration > 0 && ((duration - currentTime) < 90 || inEndCredits) && !loadingEpisode
	);
	const nextEp = $derived(nearEnd ? nextEpisode() : null);

	/*
	 * On the TV, as on Netflix: where the closing credits' start is known (anime), the next
	 * episode follows ten seconds into them; otherwise at the very end. The Next Episode button
	 * counts down to it and is highlighted when it appears, so OK plays it straight away.
	 */
	const creditsStart = $derived(
		skipSegments.find((s) => s.type === 'credits' && s.end >= duration - 20 && !storyDuring(s))?.start ?? null
	);
	const advanceAt = $derived(creditsStart !== null ? Math.min(duration, creditsStart + 10) : duration);
	const countdown = $derived(
		isTv() && autoplayNext && nextEp && advanceAt - currentTime <= 30 ? Math.max(0, Math.ceil(advanceAt - currentTime)) : null
	);
	const upcomingEp = $derived(showType === 'tv' ? nextEpisode() : null);

	const SKIP_LABELS: Record<SkipSegment['type'], string> = {
		intro: 'Skip Intro',
		recap: 'Skip Recap',
		credits: 'Skip Credits'
	};
	const activeSkip = $derived.by(() => {
		// Gone just before the part ends: skipping the last second or two isn't worth a button.
		const seg = skipSegments.find((s) => currentTime >= s.start && currentTime < s.end - 2);
		if (!seg) return null;
		// Credits that run to the end are what "Next Episode" is for.
		if (seg.type === 'credits' && nextEp && seg.end >= duration - 20) return null;
		return seg;
	});

	/* Subtitle languages. Sites name them differently ("Brazillian-portuguese", "European
	   Spanish", "spa", "es"), so each is grouped under a plain name. Only English shows unless
	   you add more under "More languages"; what you add shows for everything from then on. */
	const LANGUAGE_CODES: Record<string, string> = {
		en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French',
		de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese',
		pob: 'Portuguese', ar: 'Arabic', ara: 'Arabic', ru: 'Russian', rus: 'Russian', ja: 'Japanese', jpn: 'Japanese',
		ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zht: 'Chinese', pl: 'Polish', pol: 'Polish',
		nl: 'Dutch', dut: 'Dutch', tr: 'Turkish', tur: 'Turkish', id: 'Indonesian', ind: 'Indonesian',
		vi: 'Vietnamese', vie: 'Vietnamese', th: 'Thai', tha: 'Thai', hi: 'Hindi', hin: 'Hindi', fa: 'Persian', per: 'Persian'
	};

	function languageOf(sub: SubOption): string {
		const byCode = LANGUAGE_CODES[(sub.lang ?? '').toLowerCase()];
		if (byCode) return byCode;
		const word = (sub.language || 'Other').split(/[\s_\-(]+/).find((w) => !/^(european|latin|american|brazilian|brazillian|canadian)$/i.test(w)) ?? sub.language;
		return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
	}

	const SUB_LANGUAGES = 'catalog:subLanguages';
	let subLanguages = $state<string[]>(['English']);
	let showMoreLanguages = $state(false);

	function toggleSubLanguage(language: string) {
		subLanguages = subLanguages.includes(language)
			? subLanguages.filter((l) => l !== language)
			: [...subLanguages, language];
		try { localStorage.setItem(SUB_LANGUAGES, JSON.stringify(subLanguages)); } catch {}
	}

	/** Every language this video has subtitles in, English first. */
	const subsByLanguageAll = $derived.by(() => {
		const groups: Record<string, SubOption[]> = {};
		for (const sub of febboxSubs) {
			const language = sub.check ? 'English' : languageOf(sub);
			if (!groups[language]) groups[language] = [];
			groups[language].push(sub);
		}
		const entries = Object.entries(groups);
		entries.sort((a, b) => {
			const aEng = a[0].toLowerCase().startsWith('english') ? 0 : 1;
			const bEng = b[0].toLowerCase().startsWith('english') ? 0 : 1;
			return aEng - bEng || a[0].localeCompare(b[0]);
		});
		return Object.fromEntries(entries);
	});

	/** The ones shown: English, and any languages you've added. */
	const subsByLanguage = $derived(
		Object.fromEntries(Object.entries(subsByLanguageAll).filter(([language]) => subLanguages.includes(language)))
	);
	const otherLanguages = $derived(Object.keys(subsByLanguageAll).filter((l) => l !== 'English'));

	/* --------------------------------------------------------------- player control functions */

	function fmt(s: number): string {
		if (!isFinite(s) || s < 0) return '0:00';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = Math.floor(s % 60);
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
			: `${m}:${String(sec).padStart(2, '0')}`;
	}

	/**
	 * Paused on purpose. Nothing that reloads the video (a fresh link, a hiccup) starts it again,
	 * and a paused video isn't "stuck".
	 */
	let userPaused = false;
	/** The next load stays paused (a fresh link fetched while paused). */
	let loadPaused = false;

	function togglePlay() {
		if (!videoEl || oldPicture) return;
		if (videoEl.paused) {
			userPaused = false;
			videoEl.play();
		} else {
			userPaused = true;
			videoEl.pause();
		}
	}

	function seekTo(target: number) {
		if (!videoEl) return;
		seekTarget = duration > 0 ? (target / duration) * 100 : 0;
		isVideoSeeking = true;
		if (hlsInstance) hlsInstance.stopLoad();
		videoEl.currentTime = target;
		if (hlsInstance) hlsInstance.startLoad(-1);
	}

	function skip(delta: number) {
		if (!videoEl) return;
		const cap = duration > 0.5 ? duration - 0.5 : duration;
		seekTo(Math.max(0, Math.min(cap, videoEl.currentTime + delta)));
	}

	function skipSegment(seg: SkipSegment) {
		const cap = duration > 0.5 ? duration - 0.5 : duration;
		seekTo(Math.min(cap, seg.end));
	}

	function toggleMute() {
		if (!videoEl) return;
		videoEl.muted = !videoEl.muted;
	}

	let subSync: SubtitleSync | null = null;
	let syncedOnce = false;
	/** A click or key press has happened (the page's audio may only start after one). */
	let pageActivated = $state(false);
	onMount(() => {
		const activated = () => (pageActivated = true);
		window.addEventListener('pointerdown', activated, { once: true, capture: true });
		window.addEventListener('keydown', activated, { once: true, capture: true });
		return () => {
			window.removeEventListener('pointerdown', activated, { capture: true });
			window.removeEventListener('keydown', activated, { capture: true });
		};
	});

	/** The sound track whose fetching failed: listened to as it plays instead. */
	let soundTrackFailed = $state('');

	// Auto-timing, while subtitles show and it's turned on. A video with its own sound track
	// (Showbox's, 7Movies' Orion) has the whole of it heard at once, even before playing; other
	// playlists are heard from the audio the player downloads anyway; a plain video file is
	// listened to as it plays.
	$effect(() => {
		const showing = subtitlesOn && subtitleCues.length > 0;
		const track = hlsAudioTracks.find((t) => t.id === hlsActiveAudio)?.url ?? '';
		const playlist = Boolean(streamUrl && isPlaylist(streamUrl));
		const failed = soundTrackFailed;
		// Heard from the player's own downloads (no separate sound track): from the start, even
		// before subtitles go on — it costs nothing, and the timing is ready when they do.
		const fromDownloads = playlist && (!track || track === failed);
		// Its own sound track: the first few minutes heard straight away too, so turning subtitles
		// on (or their download, which can take seconds) isn't waited on. (Not on a TV: the
		// computer does its hearing, once subtitles are on.)
		const ownTrack = playlist && Boolean(track) && track !== failed && !isTv();
		const wanted = !sportsMode && subAutoSync && (showing || fromDownloads || ownTrack);
		untrack(() => {
			if (!wanted || !videoEl) return;
			if (!subSync) {
				subSync = new SubtitleSync(videoEl, () => subtitleCues, () => subtitleDelay, (first) => {
					// Fetched only while the video has plenty to play, so it never causes a stop. (The
					// first few minutes of sound are a megabyte or two: once it has a few seconds.)
					return !videoEl || videoEl.paused || bufferedAhead() > (first ? 8 : 30);
				});
				subSync.onRate = (rate) => (subtitleRate = rate);
				subSync.onDelay = (delay) => {
					subtitleDelay = delay;
					if (!syncedOnce) showQualityToast('Subtitles re-timed to match');
					syncedOnce = true;
				};
				subSync.onMismatch = () => switchToFittingSubs();
				// For trying it out in a browser: what it found, and why.
				if (import.meta.env.DEV) (window as unknown as { subSync: SubtitleSync }).subSync = subSync;			}
			if (fromDownloads) {
				// What the player had already downloaded before this started (once: handed over again
				// each time the subtitles changed, it was heard twice over).
				if (subSync.useAppended()) for (const piece of appendedSound) subSync.hearAppended(piece.data, piece.at, piece.length, piece.isInit);
			} else if (showing || ownTrack) {
				subSync.wholeTrack = showing;
				timeSoundTrack(track);
			}
		});
	});

	/*
	 * Copies of the audio pieces the player hands the browser (hls.js's BUFFER_APPENDING), for
	 * auto-timing without a separate sound track (subtitleSync.ts, `hearAppended`). Kept here
	 * until subtitles go on (separate audio pieces only, the last 150 — about 15 minutes).
	 */
	type AppendedSound = { data: Uint8Array; at: number; length: number; isInit: boolean };
	let appendedSound: AppendedSound[] = [];

	function noteAppendedSound(type: string, data: Uint8Array, frag: { start: number; duration: number } | null) {
		if (sportsMode) return;
		if ((type !== 'audio' && type !== 'audiovideo') || !frag || !data || data.length < 8) return;
		const box = String.fromCharCode(data[4], data[5], data[6], data[7]);
		const piece = { data, at: frag.start, length: frag.duration, isInit: box === 'ftyp' || box === 'moov' };
		if (subSync) subSync.hearAppended(piece.data, piece.at, piece.length, piece.isInit);
		downloadedSound?.add(piece.data, piece.at, piece.length, piece.isInit);
		// The format piece always (it's small); pieces of sound and picture together are too big to keep.
		if (piece.isInit) appendedSound = appendedSound.filter((p) => !p.isInit);
		else if (type !== 'audio') return;
		appendedSound.push({ ...piece, data: data.slice() });
		const pieces = appendedSound.filter((p) => !p.isInit);
		if (pieces.length > 150) appendedSound.splice(appendedSound.indexOf(pieces[0]), 1);
	}

	/** `track`: the sound track playing (its address), there when the video has a separate one. */
	async function timeSoundTrack(track: string) {
		const sync = subSync;
		if (!sync || !track || track === soundTrackFailed) return;
		// The same language's track is read, but never a Dolby one (the browser can't decode those).
		const language = hlsInstance?.audioTracks[hlsActiveAudio]?.lang ?? '';
		const fid = activeFile && !activeFile.source ? activeFile.fid : 0;
		// Heard before (by this or another screen, or by the computer for a TV): nothing to fetch.
		if (fid && (await sync.useKept(fid, language))) return;
		if (isTv()) {
			// A TV leaves the hearing to the computer, then picks up what it heard.
			if (fid) askComputerToHear(fid, language, track);
			return;
		}
		sync.analyseTrack(streamUrl, language, fid).then((ok) => {
			if (!ok) soundTrackFailed = track;
		});
	}

	function askComputerToHear(fid: number, language: string, track: string) {
		const ep = showType === 'tv' ? activeEpisode : null;
		fetch('/api/watch/speech/prepare', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: videoTitle.replace(/ S\d+E\d+$/, ''),
				type: showType,
				year: lastResolveArgs?.year ?? '',
				season: ep?.season ?? 0,
				episode: ep?.episode ?? 0,
				fid,
				lang: language
			})
		}).catch(() => {});
		// It takes the computer about half a minute; looked for every 15 seconds for 3 minutes.
		let tries = 0;
		const look = setInterval(async () => {
			const current = hlsAudioTracks.find((t) => t.id === hlsActiveAudio)?.url ?? '';
			if (++tries > 12 || !subSync || current !== track || (await subSync.useKept(fid, language))) clearInterval(look);
		}, 15_000);
	}

	// Moving the subtitles while it plays; listening as it plays when there's no sound track.
	// (That sound goes through the page's audio, as for turning the volume past 100%, which is
	// only started after a click or a key press, or the browser would keep it silent.)
	$effect(() => {
		const wanted = subtitlesOn && subAutoSync && playing && subtitleCues.length > 0;
		// Only a plain video file (not a playlist) is listened to as it plays.
		const listening = !(streamUrl && isPlaylist(streamUrl));
		void pageActivated;
		untrack(() => {
			if (!wanted || !subSync) {
				subSync?.stop();
				return;
			}
			subSync.start();
			if (!listening) return;
			const activated =
				pageActivated ||
				((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true);
			if (!activated || soundBlocked) return;
			ensureGain();
			if (!audioCtx || !audioSource) return;
			if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
			// Heard before the volume boost, so turning it past 100% changes nothing.
			subSync.listen(audioCtx, audioSource);
		});
	});

	// The list came before the video's length was known: put in order once it is (byCut).
	$effect(() => {
		const length = duration;
		untrack(() => {
			const ordered = byCut(febboxSubs, length);
			if (ordered.some((s, i) => s !== febboxSubs[i])) febboxSubs = ordered;
		});
	});

	// Other subtitles: timed again from what's already been heard.
	$effect(() => {
		void subtitleCues;
		untrack(() => {
			subSync?.newCues();
			syncedOnce = false;
		});
	});

	// Another episode: everything heard is for the last one. (Its sound track, if already
	// known, is started on again; otherwise that happens when its playlist arrives.)
	$effect(() => {
		void activeEpisode;
		untrack(() => {
			subSync?.reset();
			syncedOnce = false;
			if (subtitlesOn && subAutoSync) timeSoundTrack(hlsAudioTracks.find((t) => t.id === hlsActiveAudio)?.url ?? '');
		});
	});

	onDestroy(() => subSync?.destroy());
	onDestroy(() => stopEnded('left'));
	$effect(() => {
		const seen = () => notePlayerEvent(document.hidden ? 'window hidden' : 'window shown');
		document.addEventListener('visibilitychange', seen);
		return () => document.removeEventListener('visibilitychange', seen);
	});

	function ensureGain() {
		if (gainNode || !videoEl) return;
		audioCtx = new AudioContext();
		audioSource = audioCtx.createMediaElementSource(videoEl);
		gainNode = audioCtx.createGain();
		audioSource.connect(gainNode);
		gainNode.connect(audioCtx.destination);
	}

	function applyVolume(v: number) {
		if (!videoEl) return;
		if (v > 1 && !soundBlocked) {
			ensureGain();
			videoEl.volume = 1;
			if (gainNode) gainNode.gain.value = v;
		} else {
			videoEl.volume = Math.min(v, 1);
			if (gainNode) gainNode.gain.value = 1;
		}
		if (v > 0) videoEl.muted = false;
	}

	function setVol(e: Event) {
		if (!videoEl) return;
		const v = +(e.target as HTMLInputElement).value;
		volume = v;
		applyVolume(v);
	}

	function setRate(r: number) {
		if (!videoEl) return;
		videoEl.playbackRate = r;
		playbackRate = r;
	}

	function setAudioTrack(id: number) {
		if (hlsInstance) {
			hlsInstance.audioTrack = id;
			hlsActiveAudio = id;
			const track = hlsInstance.audioTracks[id];
			if (track) preferredAudioName = track.name || track.lang || '';
			// Japanese or the dub, picked on an anime: the next one starts the same way.
			if (track && isAnime && hlsInstance.audioTracks.some(isJapaneseTrack)) {
				const audio = isJapaneseTrack(track) ? 'Japanese' : isEnglishTrack(track) ? 'English' : '';
				if (audio) try { localStorage.setItem(ANIME_AUDIO, audio); } catch {}
			}
			recheckSubsForAudio();
		}
	}

	function setHlsLevel(index: number) {
		if (!hlsInstance) return;
		hlsInstance.currentLevel = index;
		hlsActiveLevel = index;
	}

	/** The next playable quality below `level`, or −1. */
	function levelBelow(level: number): number {
		const lower = playableLevels.filter((i) => i < level);
		return lower.length ? lower[lower.length - 1] : -1;
	}

	/** A stop to load that wasn't caused by a jump: the third in two minutes brings up the choice. */
	function noteSlowStop() {
		if (!videoEl || isVideoSeeking || videoEl.currentTime < 5 || slowOffer || slowOfferDeclined) return;
		const now = performance.now();
		slowStops = slowStops.filter((t) => now - t < 120_000);
		slowStops.push(now);
		if (slowStops.length < 3) return;
		slowStops = [];
		const lower = hlsInstance ? levelBelow(hlsInstance.loadLevel) : -1;
		const freshLink = Boolean(activeFile?.fid && shareOf(activeFile));
		const other = otherSource();
		if (lower < 0 && !freshLink && !other) return;
		slowOffer = { lower, height: lower >= 0 ? (hlsInstance?.levels[lower]?.height ?? 0) : 0, freshLink, other };
	}

	/*
	 * How playback is going, for the stats in the player and the log kept of every stop to load
	 * (Settings → Playback; src/lib/server/playbackLog.ts): each recent piece's own download speed
	 * and server, how much is loaded ahead, and what else Catalog is downloading meanwhile.
	 */
	const mbps = (bytes: number, ms: number) => Math.round(((bytes * 8) / Math.max(ms, 1) / 1000) * 10) / 10;
	function playbackNow() {
		const now = performance.now();
		const video = recentPieces.filter((p) => p.kind === 'video' && now - p.at < 60_000).slice(-6);
		const sound = recentPieces.filter((p) => p.kind === 'audio' && now - p.at < 60_000).slice(-6);
		const level = hlsInstance && hlsInstance.currentLevel >= 0 ? hlsInstance.levels[hlsInstance.currentLevel] : null;
		return {
			title: videoTitle,
			source: liveMode ? `Live TV · ${liveNow.name}` : replayMode ? 'Replay' : (activeFile?.source ?? 'Showbox'),
			quality: activeQuality,
			height: videoEl?.videoHeight ?? 0,
			tv: tvMode,
			position: Math.round(currentTime),
			aheadSeconds: Math.round(bufferedAhead()),
			needsMbps: level?.bitrate ? Math.round(level.bitrate / 100_000) / 10 : null,
			piecesMbps: video.map((p) => mbps(p.bytes, p.ms)),
			fromMemory: video.filter((p) => p.ahead).length,
			servers: [...new Set(video.map((p) => p.host))],
			// Pieces through this computer (a relayed playlist's pieces can come straight from their server).
			relayed: video.length ? video.some((p) => p.host === location.host) : streamUrl.startsWith('/api/watch/relay?'),
			previewsDownloading: strip?.busy ?? 0,
			hearingSound: subSync?.fetchingSound ?? false,
			// A separate sound track can run out on its own: both are kept, and how long each of
			// its last pieces took (they're small, so speeds say little).
			pictureAhead: trackRanges.video ? Math.round(aheadIn(trackRanges.video)) : null,
			soundAhead: trackRanges.audio ? Math.round(aheadIn(trackRanges.audio)) : null,
			soundPiecesSeconds: sound.map((p) => Math.round(p.ms / 100) / 10),
			// Downloaded onto the computer ahead (7Movies, Movy): how much, and how far past here.
			heldPercent: heldCount.total ? Math.round((heldCount.held / heldCount.total) * 100) : null,
			heldAhead: Math.round(Math.max(0, (heldRanges.find((r) => r.start <= currentTime + 1 && r.end > currentTime)?.end ?? currentTime) - currentTime)),
			heldGoing: heldCount.going
		};
	}

	/** The separate picture and sound tracks' loaded parts, as last added to. */
	let trackRanges: Partial<Record<string, TimeRanges>> = {};

	let lastStopLogged = 0;
	/** A stop to load under way: when it began and what was going on then. */
	let stopOpen: { since: number; seen: Record<string, unknown>; waiting: PieceWait | null } | null = null;
	let stopTimer: ReturnType<typeof setTimeout> | undefined;

	/*
	 * A stop to load, kept with what was going on (once every 20 seconds at most), once it's over:
	 * how long it lasted, and what the player was waiting for. Every stop used to say "No clear
	 * cause in the numbers": most kept were switches (another source, episode or a fresh link,
	 * logged as the old video was cleared, so all zeros), and the rest only had the pieces that
	 * had arrived, not the one that hadn't, nor the picture's own decoding.
	 */
	function stopStarted() {
		const v = videoEl;
		if (!v || stopOpen || isVideoSeeking || v.currentTime < 5 || performance.now() - lastStopLogged < 20_000) return;
		// A switch, not a stop.
		if (loadingEpisode || changingQuality || refreshingStream || switchingEpisode || !v.videoHeight) return;
		// The load after a jump to a spot not loaded yet is expected.
		if (performance.now() - lastSeekAt < 3000 && bufferedAhead() < 1) return;
		const waiting = waitedPiece();
		stopOpen = { since: performance.now(), seen: { ...playbackNow(), ...stopDetails() }, waiting };
		clearTimeout(stopTimer);
		stopTimer = setTimeout(() => stopEnded('still'), 30_000);
	}

	/** `how`: it played again, it was still stopped after 30 s, or the video was left or changed. */
	function stopEnded(how: 'played' | 'still' | 'left') {
		const open = stopOpen;
		if (!open) return;
		stopOpen = null;
		clearTimeout(stopTimer);
		const now = performance.now();
		lastStopLogged = now;
		// The piece it was waiting for, if it has come since.
		const came = open.waiting ? pieceDone.get(open.waiting.key) : undefined;
		const report = {
			...open.seen,
			stoppedSeconds: Math.round((now - open.since) / 100) / 10,
			ended: how,
			pieceCameAfter: came && open.waiting ? Math.round((came - open.waiting.since) / 100) / 10 : null
		};
		fetch('/api/watch/playback-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(report),
			keepalive: true
		}).catch(() => {});
	}

	/** hls.js's warnings, in words (the stop log shows them). */
	const PLAYER_WARNINGS: Record<string, string> = {
		bufferAppendNoProgress: "a piece wouldn't go in (damaged or starts late in this copy)",
		bufferAppendError: "a piece wouldn't go in",
		bufferStalledError: 'the picture stalled',
		bufferNudgeOnStall: 'nudged past a stall',
		bufferSeekOverHole: 'skipped a hole in the video',
		bufferFullError: 'memory for the video was full',
		fragLoadTimeOut: 'a piece took too long to come',
		fragLoadError: "a piece didn't download",
		fragParsingError: "a piece couldn't be read",
		fragDecryptError: "a piece couldn't be unlocked",
		levelLoadTimeOut: 'the playlist took too long',
		levelLoadError: "the playlist didn't load",
		audioTrackLoadError: "the sound track's playlist didn't load",
		internalException: 'the player hit an error'
	};

	/** What happened in the 30 s before (see notePlayerEvent), newest last. */
	let playerEvents: { at: number; what: string }[] = [];
	let lastSeekAt = 0;
	function notePlayerEvent(what: string) {
		const now = performance.now();
		playerEvents = playerEvents.filter((e) => now - e.at < 30_000);
		// (The same warning several times in a row is one.)
		const last = playerEvents[playerEvents.length - 1];
		if (last?.what === what && now - last.at < 2000) last.at = now;
		else playerEvents.push({ at: now, what });
	}

	/** Pieces asked for and not here yet (by track), and when recent ones arrived. */
	type PieceWait = { key: string; kind: string; n: number; since: number };
	const piecesAsked = new Map<string, PieceWait>();
	const pieceDone = new Map<string, number>();
	let lastPieceAt = 0;
	function pieceAsked(frag: { type: string; sn: number | string }) {
		if (typeof frag.sn !== 'number' || frag.type === 'subtitle') return;
		const kind = frag.type === 'audio' ? 'sound' : 'picture';
		piecesAsked.set(kind, { key: `${kind}:${frag.sn}`, kind, n: frag.sn, since: performance.now() });
	}
	function pieceArrived(frag: { type: string; sn: number | string }) {
		if (typeof frag.sn !== 'number' || frag.type === 'subtitle') return;
		const kind = frag.type === 'audio' ? 'sound' : 'picture';
		const key = `${kind}:${frag.sn}`;
		if (piecesAsked.get(kind)?.key === key) piecesAsked.delete(kind);
		lastPieceAt = performance.now();
		pieceDone.set(key, lastPieceAt);
		if (pieceDone.size > 40) pieceDone.delete(pieceDone.keys().next().value!);
	}
	/** The piece asked for longest ago and still not here. */
	function waitedPiece(): PieceWait | null {
		let oldest: PieceWait | null = null;
		for (const wait of piecesAsked.values()) if (!oldest || wait.since < oldest.since) oldest = wait;
		return oldest;
	}

	/** Frames drawn and dropped, every 2 s while playing (for whether the picture kept up). */
	let frameMarks: { at: number; total: number; dropped: number }[] = [];
	function markFrames() {
		const quality = videoEl?.getVideoPlaybackQuality?.();
		if (!quality) return;
		frameMarks.push({ at: performance.now(), total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames });
		if (frameMarks.length > 10) frameMarks.shift();
	}

	/** What the stop log needs beyond the stats: the picture, the loaded parts, the moments before. */
	function stopDetails() {
		const v = videoEl!;
		const now = performance.now();
		const t = v.currentTime;
		// A hole in what's loaded where it stopped, just ahead or just behind (the browser won't
		// play over one; SVU's HEVC copy has pieces whose picture starts 2 s late).
		let gap: number | null = null;
		for (let i = 0; i < v.buffered.length; i++) {
			const start = v.buffered.start(i);
			const end = v.buffered.end(i);
			const before = i > 0 ? v.buffered.end(i - 1) : null;
			if (before !== null && start > t - 3 && start <= t + 2 && start - before > 0.1) {
				gap = Math.round((start - before) * 100) / 100;
				break;
			}
			if (start <= t && end > t + 0.3) continue;
			if (start > t - 0.1 && start - t < 2) {
				gap = Math.round((start - t) * 100) / 100;
				break;
			}
		}
		const tenAgo = frameMarks.find((m) => now - m.at <= 11_000);
		const quality = v.getVideoPlaybackQuality?.();
		const drawn = tenAgo && quality ? quality.totalVideoFrames - tenAgo.total : null;
		const dropped = tenAgo && quality ? quality.droppedVideoFrames - tenAgo.dropped : null;
		const level = hlsInstance?.levels[hlsInstance.currentLevel >= 0 ? hlsInstance.currentLevel : hlsInstance.loadLevel];
		const waiting = waitedPiece();
		return {
			hevc: Boolean(activeFile?.hevc) || /^(hvc1|hev1)/.test(level?.videoCodec ?? ''),
			framesDrawn: drawn,
			framesDropped: dropped,
			gap,
			readyState: v.readyState,
			hidden: document.hidden,
			waitingFor: waiting ? { kind: waiting.kind, n: waiting.n, seconds: Math.round((now - waiting.since) / 100) / 10 } : null,
			lastPieceSecondsAgo: lastPieceAt ? Math.round((now - lastPieceAt) / 100) / 10 : null,
			before: playerEvents.filter((e) => now - e.at < 30_000).map((e) => ({ secondsBefore: Math.round((now - e.at) / 100) / 10, what: e.what }))
		};
	}

	/*
	 * The picture stuck while the sound plays on (friends' Deadpool, 2026-10-21: "the audio went
	 * out of time and the scene froze", again after reloading). A piece the browser can't decode
	 * stops the picture but not the clock or the sound, so the stall watch never noticed. Every
	 * 2 s while playing: if the clock has run 4 s and no new frames were drawn, the decoder is
	 * rebuilt in place and the sound put back with the picture; again within 2 minutes, a fresh
	 * link; a third time, it says so (switching source by itself could land at the wrong spot:
	 * other sources' copies are other cuts). Each is kept in the stop log.
	 */
	let frozenCheck: { frames: number; clock: number } | null = null;
	let frozenRecoveries: number[] = [];

	function checkFrozenPicture() {
		markFrames();
		const v = videoEl;
		const quality = v?.getVideoPlaybackQuality?.();
		// Only while it should be drawing: playing, loaded, on screen, nothing else under way.
		if (!v || !quality || v.paused || v.seeking || v.readyState < 3 || document.hidden || !hlsInstance || loadingEpisode || changingQuality || refreshingStream) {
			frozenCheck = null;
			return;
		}
		const now = { frames: quality.totalVideoFrames, clock: v.currentTime };
		if (!frozenCheck || now.clock < frozenCheck.clock) {
			frozenCheck = now;
			return;
		}
		if (now.clock - frozenCheck.clock < 4) return;
		const frozen = now.frames - frozenCheck.frames < 3;
		frozenCheck = now;
		if (frozen) recoverFrozenPicture();
	}

	function recoverFrozenPicture() {
		if (!videoEl || !hlsInstance) return;
		const now = performance.now();
		frozenRecoveries = frozenRecoveries.filter((t) => now - t < 120_000);
		frozenRecoveries.push(now);
		fetch('/api/watch/playback-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...playbackNow(), ...stopDetails(), what: 'Picture froze while the sound played', recovery: frozenRecoveries.length }),
			keepalive: true
		}).catch(() => {});
		const at = videoEl.currentTime;
		if (frozenRecoveries.length === 1) {
			// The decoder rebuilt where it is; the seek lines the sound up with the picture again.
			mediaRecoveredAt = now;
			notePlayerEvent('decoder rebuilt (frozen picture)');
			hlsInstance.recoverMediaError();
			seekAfterLoad = at;
			videoEl.currentTime = at;
		} else if (frozenRecoveries.length === 2) {
			refreshStream();
		} else {
			frozenRecoveries = [];
			showQualityToast("This part won't play from here. Try another quality or source from the list.");
		}
	}

	$effect(() => {
		if (!playing || !streamUrl) return;
		frozenCheck = null;
		const timer = setInterval(checkFrozenPicture, 2000);
		return () => clearInterval(timer);
	});

	/** The stats in the corner of the player (Settings → Playback stats), per device. */
	const STATS_KEY = 'catalog:playerStats';
	let showStats = $state(untrack(() => {
		try {
			return localStorage.getItem(STATS_KEY) === '1';
		} catch {
			return false;
		}
	}));
	let stats = $state<ReturnType<typeof playbackNow> | null>(null);
	$effect(() => {
		if (!showStats) return;
		stats = playbackNow();
		const timer = setInterval(() => (stats = playbackNow()), 1000);
		return () => clearInterval(timer);
	});
	function toggleStats() {
		showStats = !showStats;
		try {
			localStorage.setItem(STATS_KEY, showStats ? '1' : '0');
		} catch {}
	}

	function slowChoice(choice: 'fresh' | 'lower' | 'other' | 'keep') {
		const offer = slowOffer;
		slowOffer = null;
		if (!offer) return;
		if (choice === 'fresh') refreshStream();
		else if (choice === 'lower' && offer.lower >= 0) setHlsLevel(offer.lower);
		else if (choice === 'other' && offer.other) changeToFile(offer.other);
		else slowOfferDeclined = true;
	}

	/*
	 * Another source's copy of this episode, for "Keeps stopping to load". When Movy's or 7Movies'
	 * server is slow over pieces it hasn't got yet (20 s to 4 minutes each, 2026-10-24: AHS S13E9 on
	 * mom's TV), a fresh link is the same server; another source carries on at once, from the same
	 * spot. Same language, and no subtitles in the picture unless that's what's playing; Showbox's
	 * first unless its daily allowance is used up.
	 */
	function otherSource(): FileOption | null {
		const playing = activeFile;
		if (!playing) return null;
		const same = (f: FileOption) => (f.source ?? 'Showbox') === (playing.source ?? 'Showbox');
		const candidates = currentFiles.filter(
			(f) => !same(f) && playableHere(f) && isDub(f) === hearingDub() && !(f.burnedIn && !playing.burnedIn)
		);
		const showbox = febboxOut() ? null : pickFile(candidates.filter((f) => !f.source), preferredQuality);
		return showbox ?? candidates.find((f) => f.source) ?? null;
	}

	// On a TV, the choice takes the highlight so the remote can answer it.
	let slowOfferEl: HTMLDivElement | undefined = $state();
	$effect(() => {
		if (tvMode && slowOfferEl) slowOfferEl.querySelector('button')?.focus({ preventScroll: true });
	});

	function toggleFS() {
		if (!playerPageEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else if ((videoEl as any)?.webkitEnterFullscreen && !document.fullscreenEnabled) {
			(videoEl as any).webkitEnterFullscreen();
		} else {
			playerPageEl.requestFullscreen().catch(() => {
				if ((videoEl as any)?.webkitEnterFullscreen) (videoEl as any).webkitEnterFullscreen();
			});
		}
	}

	let pipCanvas: HTMLCanvasElement | null = null;
	let pipVideo: HTMLVideoElement | null = null;
	let pipCtx: CanvasRenderingContext2D | null = null;
	let pipAnimFrame: number | null = null;

	function drawPiPFrame() {
		if (!pipCanvas || !pipCtx || !videoEl) return;
		const vw = videoEl.videoWidth || 1280;
		const vh = videoEl.videoHeight || 720;
		if (pipCanvas.width !== vw) pipCanvas.width = vw;
		if (pipCanvas.height !== vh) pipCanvas.height = vh;

		// (The episode before, while the next one loads, is hidden here too.)
		if (oldPicture) {
			pipCtx.fillStyle = '#000';
			pipCtx.fillRect(0, 0, vw, vh);
		} else {
			pipCtx.drawImage(videoEl, 0, 0, vw, vh);
		}

		if (subtitlesOn && !oldPicture) {
			const subs = subsAt(subTimeAt(videoEl.currentTime || 0));
			const text = plainSubText(subs.bottom || subs.top);
			if (text) {
				const lines = text.split('\n');
				const fontSize = Math.round(vh * 0.04);
				pipCtx.font = `${fontSize}px system-ui, sans-serif`;
				pipCtx.textAlign = 'center';
				pipCtx.textBaseline = 'bottom';
				const lineH = fontSize * 1.5;
				const padX = Math.round(fontSize * 1.1);
				const padY = Math.round(fontSize * 0.45);
				const widths = lines.map(l => pipCtx!.measureText(l).width);
				const maxW = Math.max(...widths);
				const boxW = maxW + padX * 2;
				const boxH = lines.length * lineH + padY * 2;
				const boxX = (vw - boxW) / 2;
				const boxY = vh * 0.92 - boxH;
				const r = Math.round(fontSize * 0.28);
				pipCtx.fillStyle = 'rgba(0,0,0,0.5)';
				pipCtx.beginPath();
				pipCtx.roundRect(boxX, boxY, boxW, boxH, r);
				pipCtx.fill();
				pipCtx.fillStyle = '#fff';
				pipCtx.shadowColor = 'rgba(0,0,0,0.9)';
				pipCtx.shadowBlur = 4;
				for (let i = 0; i < lines.length; i++) {
					const y = boxY + padY + (i + 1) * lineH;
					pipCtx.fillText(lines[i], vw / 2, y);
				}
				pipCtx.shadowBlur = 0;
			}
		}
		pipAnimFrame = requestAnimationFrame(drawPiPFrame);
	}

	/*
	 * The mini player shows a copy of the picture (drawn with the subtitles). Its buttons are the
	 * page's media controls (`setPiPActions`): play/pause work on the video, not the copy, and
	 * previous/next change episode, with the mini player staying open. (A live copy gets no
	 * play/pause button of its own, and Chromium's only skip button reads "Skip Ad", so there's no
	 * Skip Intro here.) The copy follows the video's play/pause too.
	 */
	function onPiPPause() {
		if (!videoEl || videoEl.paused) return;
		userPaused = true;
		videoEl.pause();
	}

	function onPiPPlay() {
		if (!videoEl || !videoEl.paused || oldPicture) return;
		userPaused = false;
		videoEl.play().catch(() => {});
	}

	/** This video's address, for the mini player or for coming back from it, on `fid` (and episode). */
	function watchAddress(extra: Record<string, string>, episode = activeEpisode, fid = activeFileFid): string {
		const args = lastResolveArgs;
		const params = new URLSearchParams({
			title: args?.title ?? videoTitle.replace(/ S\d+E\d+$/, ''),
			type: args?.type ?? showType,
			year: args?.year ?? '',
			auto: '1',
			fid: String(fid),
			...extra
		});
		if (showType === 'tv' && episode) {
			params.set('resume_s', String(episode.season));
			params.set('resume_e', String(episode.episode));
		}
		return `/watch?${params}`;
	}

	/** Opens the computer's mini player here (false: not in the desktop app, so the browser's own). */
	async function openMiniPlayer(): Promise<boolean> {
		if (!videoEl || !activeFileFid) return false;
		// Its place saved first: the mini player starts from it.
		saveProgressSync();
		const resp = await fetch('/api/desktop/mini', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ open: watchAddress({ mini: '1' }) })
		}).catch(() => null);
		if (!resp?.ok) return false;
		inMini = true;
		userPaused = true;
		videoEl.pause();
		hlsInstance?.stopLoad();
		return true;
	}

	type MiniBack = { at: number | null; playing: boolean; season?: number; episode?: number; fid?: number };

	/** The mini player is done: back to it here, where it got to (or where it last saved). */
	async function backFromMini(back: MiniBack | null) {
		if (!inMini) return;
		inMini = false;
		// It went on to another episode, or another copy: this page opens that one.
		const episode = back?.season ? episodes.find((e) => e.season === back.season && e.episode === back.episode) : activeEpisode;
		if ((episode && episode !== activeEpisode) || (back?.fid && back.fid !== activeFileFid)) {
			location.href = watchAddress({}, episode ?? activeEpisode, back?.fid || activeFileFid);
			return;
		}
		if (!videoEl) return;
		let at = back?.at ?? null;
		if (at === null) {
			const s = activeEpisode?.season ?? 0;
			const e = activeEpisode?.episode ?? 0;
			const title = encodeURIComponent(videoTitle.replace(/ S\d+E\d+$/, ''));
			const saved = await fetch(`/api/watch/progress?title=${title}&type=${showType}&season=${s}&episode=${e}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			at = saved?.currentTime ?? null;
		}
		if (at !== null) seekTo(at);
		else hlsInstance?.startLoad(-1);
		if (back?.playing) {
			userPaused = false;
			videoEl.play().catch(() => {});
		}
	}

	/** In the mini player: back to Catalog's window, playing on (or not, when it's closed). */
	function leaveMini(playOn: boolean) {
		saveProgressSync();
		fetch('/api/desktop/mini', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				back: videoEl?.currentTime ?? 0,
				playing: playOn && Boolean(videoEl && !videoEl.paused),
				season: activeEpisode?.season,
				episode: activeEpisode?.episode,
				fid: activeFileFid
			}),
			keepalive: true
		}).catch(() => {});
	}

	onMount(() => {
		(window as unknown as { catalogBackFromMini?: typeof backFromMini }).catalogBackFromMini = backFromMini;
	});
	onDestroy(() => {
		if (typeof window !== 'undefined') delete (window as unknown as { catalogBackFromMini?: unknown }).catalogBackFromMini;
	});

	const PIP_ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack'] as const;

	/** The mini player's buttons: on while it's open (previous/next only where there's one), else off. */
	function setPiPActions(on: boolean) {
		const session = navigator.mediaSession;
		if (!session) return;
		const handlers: Record<(typeof PIP_ACTIONS)[number], (() => void) | null> = {
			play: onPiPPlay,
			pause: onPiPPause,
			previoustrack: previousEpisode() ? () => { const ep = previousEpisode(); if (ep) playEpisode(ep); } : null,
			nexttrack: nextEpisode() ? () => { const ep = nextEpisode(); if (ep) playEpisode(ep); } : null
		};
		for (const action of PIP_ACTIONS) {
			try {
				session.setActionHandler(action, on ? handlers[action] : null);
			} catch {}
		}
	}

	function cleanupPiP() {
		setPiPActions(false);
		if (pipAnimFrame) { cancelAnimationFrame(pipAnimFrame); pipAnimFrame = null; }
		if (pipVideo) {
			pipVideo.removeEventListener('leavepictureinpicture', cleanupPiP);
			pipVideo.removeEventListener('pause', onPiPPause);
			pipVideo.removeEventListener('play', onPiPPlay);
			pipVideo.pause();
			pipVideo.srcObject = null;
			pipVideo.remove();
			pipVideo = null;
		}
		pipCanvas = null;
		pipCtx = null;
		inPiP = false;
	}

	async function togglePiP() {
		if (!videoEl) return;
		if (!inPiP && inDesktopApp && !miniMode && (await openMiniPlayer())) return;
		try {
			if (inPiP) {
				if (document.pictureInPictureElement) await document.exitPictureInPicture();
				cleanupPiP();
				return;
			}

			const canvas = document.createElement('canvas');
			const vw = videoEl.videoWidth || 1280;
			const vh = videoEl.videoHeight || 720;
			canvas.width = vw;
			canvas.height = vh;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			ctx.drawImage(videoEl, 0, 0, vw, vh);
			const stream = canvas.captureStream(30);

			pipCanvas = canvas;
			pipCtx = ctx;
			drawPiPFrame();

			const pv = document.createElement('video');
			pv.srcObject = stream;
			pv.muted = true;
			pv.style.cssText = 'position:fixed;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
			document.body.appendChild(pv);
			await pv.play();

			pv.addEventListener('leavepictureinpicture', cleanupPiP);
			await pv.requestPictureInPicture();
			pipVideo = pv;
			inPiP = true;
			pv.addEventListener('pause', onPiPPause);
			pv.addEventListener('play', onPiPPlay);
			if (videoEl.paused) pv.pause();
			setPiPActions(true);
		} catch (err) {
			console.error('PiP failed:', err);
			cleanupPiP();
			try {
				await videoEl.requestPictureInPicture();
				inPiP = true;
				videoEl.addEventListener('leavepictureinpicture', () => (inPiP = false), { once: true });
			} catch {}
		}
	}

	function onProgressDown(e: MouseEvent) {
		seeking = true;
		updateSeekPreview(e);
		const onMove = (ev: MouseEvent) => updateSeekPreview(ev);
		const onUp = (ev: MouseEvent) => {
			commitSeek(ev);
			seekPreview = -1;
			seeking = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	function updateSeekPreview(e: MouseEvent) {
		if (!progressBarEl) return;
		const rect = progressBarEl.getBoundingClientRect();
		seekPreview = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		requestThumb(seekPreview);
	}

	/* --------------------------------------------------------------- scrubbing preview */

	/*
	 * Pictures above the progress bar while hovering, dragging or fast-forwarding, the way
	 * streaming apps do it (src/lib/previewStrip.ts). Pictures kept from before load the moment a
	 * video opens. The rest are gathered from the start, two at a time for the rough pass, and kept
	 * for next time. On the TV nothing is gathered (a second video would compete with the TV's
	 * own): the computer makes the strip instead, out of sight, and the TV picks it up as it comes.
	 * The computer also gets the next episode's ready. Until there's a picture, the poster shows.
	 */
	let hoverPct = $state(-1);
	let thumbCanvas: HTMLCanvasElement | undefined = $state();
	let strip: PreviewStrip | null = null;
	/** Which video the strip is for ("title|type|season|episode"). */
	let stripFor = '';
	let stripTimer: ReturnType<typeof setInterval> | undefined;
	const previewPct = $derived(seekPreview >= 0 ? seekPreview : hoverPct);

	const stripVideo = (): StripVideo | null =>
		videoTitle
			? {
					title: videoTitle.replace(/ S\d+E\d+$/, ''),
					type: showType,
					season: showType === 'tv' ? (activeEpisode?.season ?? 0) : 0,
					episode: showType === 'tv' ? (activeEpisode?.episode ?? 0) : 0
				}
			: null;

	/** The small copy's address to gather from ('' for none). */
	async function findThumbSource(): Promise<string> {
		// Several qualities: the lowest of them, from the same playlist.
		if (hlsLevels.length > 1) return streamUrl;
		const file = activeFile;
		if (!file) return streamUrl;
		const ask = async (copy: FileOption) => {
			try {
				const resp = await fetch(`/api/watch/stream?share_key=${shareOf(copy)}&fid=${copy.fid}`);
				return resp.ok ? ((await resp.json()).url ?? '') : '';
			} catch {
				return '';
			}
		};
		if (file.source === '7Movies') {
			// Its H.264 pieces are ~20 MB each: Orion's 480p instead, where it plays.
			const orion = currentFiles.find((f) => f.source === '7Movies' && f.hevc);
			if (file.hevc) return streamUrl;
			return orion ? ask(orion) : '';
		}
		if (!file.source) {
			// Showbox's smallest file, when it's a smaller one (480p or less).
			const small = currentFiles
				.filter((f) => !f.source && f.fid !== file.fid && (parseInt(f.quality) || 9999) <= 480)
				.sort((a, b) => (parseInt(a.quality) || 0) - (parseInt(b.quality) || 0))[0];
			return small ? (await ask(small)) || streamUrl : streamUrl;
		}
		return streamUrl;
	}

	/** Keeps what was gathered here on the computer. */
	async function keepGathered() {
		const video = stripVideo();
		if (!strip || !video) return;
		keepPictures(video, await strip.takeFresh());
	}

	function closeStrip() {
		clearInterval(stripTimer);
		stripTimer = undefined;
		if (strip) {
			const leaving = strip;
			const video = stripVideo();
			leaving.takeFresh().then((frames) => video && keepPictures(video, frames)).finally(() => leaving.stop());
		}
		strip = null;
		stripFor = '';
	}

	/** The strip for the video that just opened: kept pictures at once, then gathering. */
	async function openStrip() {
		const video = stripVideo();
		if (!video) return;
		const id = `${video.title}|${video.type}|${video.season}|${video.episode}`;
		if (stripFor === id) return;
		closeStrip();
		stripFor = id;
		const kept = keptPictures(video);
		const url = tvMode ? '' : await findThumbSource();
		if (stripFor !== id) return;
		const s = new PreviewStrip(url, { copies: 2 });
		// The video itself comes first: only while it has a little loaded ahead (or is paused).
		s.canGather = () => !videoEl || videoEl.paused || bufferedAhead() >= 10;
		s.playhead = () => videoEl?.currentTime ?? 0;
		let sinceKept = 0;
		s.onFrame = () => {
			drawThumb();
			if (++sinceKept >= 15) {
				sinceKept = 0;
				keepGathered();
			}
		};
		strip = s;
		await s.addSaved(await kept);
		drawThumb();
		if (url) s.start();

		const year = lastResolveArgs?.year ?? '';
		if (tvMode) {
			// The computer makes this one, and the TV picks up its pictures as they're kept.
			askComputerForPictures({ ...video, year });
			stripTimer = setInterval(async () => {
				if (strip !== s || s.frames.size >= 150) return;
				await s.addSaved(await keptPictures(video));
				drawThumb();
			}, 15000);
		}
		// The next episode's, ready for when it starts.
		const next = showType === 'tv' ? nextEpisode() : null;
		if (next) setTimeout(() => strip === s && askComputerForPictures({ ...video, season: next.season, episode: next.episode, year }), tvMode ? 1000 : 60000);
	}

	// A video opens (once its qualities are known): its strip.
	$effect(() => {
		void videoTitle;
		void activeEpisode;
		const levelsKnown = hlsLevels.length > 0 || !isPlaylist(streamUrl);
		if (!streamUrl || !videoTitle || (!levelsKnown && !tvMode)) return;
		untrack(() => openStrip());
	});

	onDestroy(() => closeStrip());

	let posterPicture: HTMLImageElement | null = null;
	let posterFor = '';

	/** The video's poster, for the preview until there's a picture. */
	function posterImage(): HTMLImageElement | null {
		if (!watchPosterUrl) return null;
		if (posterFor !== watchPosterUrl) {
			posterFor = watchPosterUrl;
			const img = new Image();
			img.onload = () => drawThumb();
			img.src = watchPosterUrl;
			posterPicture = img;
		}
		return posterPicture?.complete && posterPicture.naturalWidth ? posterPicture : null;
	}

	/** Shows the picture for where the mouse (or fast-forward) is: its own, the nearest, or the poster. */
	function drawThumb() {
		if (!thumbCanvas || previewPct < 0 || duration <= 0) return;
		const ctx = thumbCanvas.getContext('2d');
		if (!ctx) return;
		const { width, height } = thumbCanvas;
		const frame = strip?.pictureFor((previewPct / 100) * duration, 60) ?? null;
		if (frame) {
			ctx.drawImage(frame, 0, 0, width, height);
			return;
		}
		const poster = posterImage();
		ctx.fillStyle = '#111';
		ctx.fillRect(0, 0, width, height);
		if (poster) {
			// The middle of the poster, filling the box, dimmed.
			const sh = Math.min(poster.naturalHeight, (poster.naturalWidth * height) / width);
			ctx.globalAlpha = 0.55;
			ctx.drawImage(poster, 0, (poster.naturalHeight - sh) / 2.5, poster.naturalWidth, sh, 0, 0, width, height);
			ctx.globalAlpha = 1;
		}
	}

	/** Under the mouse: its picture (or the nearest) shows, and its own is fetched first if missing. */
	function requestThumb(pct: number) {
		if (duration <= 0) return;
		drawThumb();
		strip?.want((pct / 100) * duration);
	}

	function onProgressHover(e: MouseEvent) {
		if (!progressBarEl || seeking) return;
		const rect = progressBarEl.getBoundingClientRect();
		hoverPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		requestThumb(hoverPct);
	}

	// The box is made afresh each time the mouse comes back (and redrawn as fast-forward moves).
	$effect(() => {
		void previewPct;
		if (thumbCanvas) drawThumb();
	});
	function commitSeek(e: MouseEvent) {
		if (!progressBarEl || !videoEl) return;
		const rect = progressBarEl.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seekTarget = ratio * 100;
		isVideoSeeking = true;
		if (hlsInstance) hlsInstance.stopLoad();
		videoEl.currentTime = ratio * duration;
		if (hlsInstance) hlsInstance.startLoad(-1);
	}

	function showControlsBriefly() {
		showControls = true;
		scheduleHide();
	}

	function wakeCursor() {
		cursorIdle = false;
		if (cursorTimer) clearTimeout(cursorTimer);
		cursorTimer = setTimeout(() => { cursorIdle = true; }, 3000);
	}

	function scheduleHide() {
		if (controlsTimer) clearTimeout(controlsTimer);
		controlsTimer = setTimeout(() => {
			if (playing && !showSettings && !showCaptions && !showAudioPicker && !seeking) showControls = false;
		}, 3000);
	}

	function handleVideoClick() {
		showSettings = false;
		showCaptions = false;
		showDelay = false;
		showAudioPicker = false;
		if (clickTimeout) {
			clearTimeout(clickTimeout);
			clickTimeout = null;
			return;
		}
		clickTimeout = setTimeout(() => {
			clickTimeout = null;
			togglePlay();
		}, 250);
	}

	function handleVideoDblClick() {
		if (clickTimeout) {
			clearTimeout(clickTimeout);
			clickTimeout = null;
		}
		toggleFS();
	}

	/* --------------------------------------------------------------- on a TV */

	const tvMode = isTv();
	const AUTOPLAY_KEY = tvMode ? 'catalog-tv-autoplay' : 'catalog-autoplay';
	const AUTOSKIP_KEY = tvMode ? 'catalog-tv-autoskip' : 'catalog-autoskip';
	let tvFullscreenTried = false;

	/** The controls' first button, for when the remote's up or down brings them up. */
	function focusControls() {
		const button = playerPageEl?.querySelector<HTMLElement>('.controls button');
		button?.focus({ preventScroll: true });
	}

	onMount(() => {
		if (!tvMode) return;
		tvPlayer.playPause = () => {
			if (stopScan()) return;
			togglePlay();
			showControlsBriefly();
		};
		// The TV app before 1.2 sends fast-forward and rewind as a 30-second skip.
		tvPlayer.seek = (seconds) => scan(seconds > 0 ? 1 : -1);
		tvPlayer.scan = scan;
		tvPlayer.stopScan = stopScan;
		tvPlayer.closeMenu = closeOpenMenu;
	});
	onDestroy(() => {
		tvPlayer.playPause = undefined;
		tvPlayer.seek = undefined;
		tvPlayer.scan = undefined;
		tvPlayer.stopScan = undefined;
		tvPlayer.closeMenu = undefined;
		clearInterval(scanTimer);
	});

	// Ten seconds into the closing credits, on to the next episode (unless it's paused).
	$effect(() => {
		if (!tvMode || !autoplayNext || !nextEp || creditsStart === null || autoplayFired || loadingEpisode || !playing) return;
		if (currentTime >= advanceAt - 0.25) {
			autoplayFired = true;
			playEpisode(nextEp);
		}
	});

	let nextEpButton: HTMLButtonElement | undefined = $state();
	$effect(() => {
		if (tvMode && nextEpButton) nextEpButton.focus({ preventScroll: true });
	});

	// On a TV, Skip Intro (or Recap, or Credits) takes the highlight when it appears, so OK
	// skips, as on Netflix — unless something in the controls is being used.
	let skipButton: HTMLButtonElement | undefined = $state();
	$effect(() => {
		if (!tvMode || !skipButton) return;
		const current = untrack(() => document.activeElement as HTMLElement | null);
		const using = current && current !== document.body && current.matches('button, a[href], input, select');
		if (using && current !== skipButton) return;
		skipButton.focus({ preventScroll: true });
	});

	/*
	 * Fast-forward and rewind on the remote: one press scans through the video by itself, faster
	 * with each press (8×, 16×, 32×, 64×), until play/pause or OK stops it there and plays on.
	 * Held down, the button repeats; repeats closer together than a third of a second count once.
	 */
	const SCAN_SPEEDS = [8, 16, 32, 64];
	let scanDir = $state(0);
	let scanLevel = $state(0);
	let scanTimer: ReturnType<typeof setInterval> | undefined;
	let lastScanPress = 0;

	function scan(direction: number) {
		if (!videoEl || !(duration > 0)) return;
		const now = Date.now();
		if (now - lastScanPress < 350) return;
		lastScanPress = now;
		const dir = direction > 0 ? 1 : -1;
		if (scanDir === dir) {
			scanLevel = Math.min(SCAN_SPEEDS.length - 1, scanLevel + 1);
		} else {
			if (!scanDir) seekPreview = (videoEl.currentTime / duration) * 100;
			scanDir = dir;
			scanLevel = 0;
			userPaused = true;
			videoEl.pause();
			clearInterval(scanTimer);
			scanTimer = setInterval(scanTick, 250);
		}
		showControlsBriefly();
	}

	function scanTick() {
		const end = Math.max(0, duration - 1);
		const at = Math.max(0, Math.min(end, (seekPreview / 100) * duration + scanDir * SCAN_SPEEDS[scanLevel] * 0.25));
		seekPreview = (at / duration) * 100;
		showControlsBriefly();
		if (at <= 0 || at >= end) stopScan();
	}

	/** Stops scanning and plays from where it got to. False if it wasn't scanning. */
	function stopScan(): boolean {
		if (!scanDir) return false;
		clearInterval(scanTimer);
		scanTimer = undefined;
		const target = (seekPreview / 100) * duration;
		scanDir = 0;
		scanLevel = 0;
		seekPreview = -1;
		userPaused = false;
		seekTo(target);
		videoEl?.play().catch(() => {});
		showControlsBriefly();
		return true;
	}

	// When the controls fade, let go of the highlighted button so the arrows skip again (and
	// OK can't press a top-bar button nobody can see).
	$effect(() => {
		if (!tvMode || showControls) return;
		const current = document.activeElement as HTMLElement | null;
		if (current && current.closest('.controls, .player-bar') && playerPageEl?.contains(current)) current.blur();
	});

	// Fill the TV once it starts playing. (Needs the press that opened it to still count;
	// if not, the full-screen button in the controls does it.)
	$effect(() => {
		if (!tvMode || !playing || tvFullscreenTried || document.fullscreenElement) return;
		tvFullscreenTried = true;
		playerPageEl?.requestFullscreen().catch(() => {});
	});

	/** On a TV, with nothing in the controls highlighted: OK plays/pauses, up/down bring the controls. */
	function tvKey(e: KeyboardEvent): boolean {
		const current = document.activeElement as HTMLElement | null;
		// The progress bar highlighted: left and right skip 10 seconds, OK plays or pauses, and up
		// and down move on (src/lib/tv.ts has already moved the highlight for those).
		if (current?.classList.contains('progress-wrap')) {
			showControlsBriefly();
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				skip(e.key === 'ArrowLeft' ? -10 : 10);
				return true;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				if (!stopScan()) togglePlay();
				return true;
			}
			return e.key.startsWith('Arrow');
		}
		// Only a real button (or link) counts as highlighted. Anything else holding focus — the
		// invisible layer over the video, the page itself — made OK bring up the controls again
		// and again instead of pausing, and kept them up.
		const onControl =
			current &&
			current !== document.body &&
			current.tagName !== 'VIDEO' &&
			!current.classList.contains('click-layer') &&
			current.matches('button:not([disabled]), a[href], input, select');
		if (current && !onControl && current !== document.body) current.blur();
		if (onControl) {
			// The highlight moves between the controls (src/lib/tv.ts); keep them up meanwhile.
			if (e.key.startsWith('Arrow') || e.key === 'Enter') {
				showControlsBriefly();
				return true;
			}
			return false;
		}
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			showControlsBriefly();
			focusControls();
			return true;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (!stopScan()) togglePlay();
			showControlsBriefly();
			return true;
		}
		return false; // left and right skip, as on a keyboard
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!streamUrl && !useIframe) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (tvMode && tvKey(e)) return;
		if (e.key === 'Escape') {
			if (showSettings) {
				showSettings = false;
				return;
			}
			if (showCaptions) {
				showCaptions = false;
				return;
			}
			if (isFullscreen) {
				document.exitFullscreen();
				return;
			}
			return;
		}
		switch (e.key) {
			case ' ':
			case 'k':
				e.preventDefault();
				togglePlay();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				skip(-10);
				break;
			case 'ArrowRight':
				e.preventDefault();
				skip(10);
				break;
			case 'ArrowUp':
				e.preventDefault();
				{ const next = Math.min(2, volume + 0.1); volume = next; applyVolume(next); }
				break;
			case 'ArrowDown':
				e.preventDefault();
				{ const next = Math.max(0, volume - 0.1); volume = next; applyVolume(next); }
				break;
			case 'f':
				toggleFS();
				break;
			case 'm':
				toggleMute();
				break;
		}
	}

	/* --------------------------------------------------------------- subtitle functions */

	/** Reads the first timestamp in a line, ignoring any cue settings after it. */
	function parseTimestamp(t: string): number {
		const m = t.match(/(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?/);
		if (!m) return NaN;
		return +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +`0.${m[4] ?? 0}`;
	}

	const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

	/** Subtitle files come from strangers: escape everything but italics, bold and underline. */
	function safeSubHtml(text: string): string {
		return text
			.replace(/<\/?(?:font|span|c|v|lang|ruby|rt)\b[^>]*>/gi, '')
			.split(/(<\/?[ibu]>)/i)
			.map((part, i) => (i % 2 ? part.toLowerCase() : part.replace(/[&<>"']/g, (ch) => ESCAPES[ch])))
			.join('');
	}

	function plainSubText(html: string): string {
		return html
			.replace(/<[^>]*>/g, '')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&');
	}

	/** One cue's raw text as display HTML. Null for lines that aren't readable text. */
	function cleanCue(raw: string): { text: string; top: boolean } | null {
		const tags = raw.match(/\{[^}]*\}/g) ?? [];
		// Vector drawings and karaoke syllables render as gibberish once their tags are gone.
		if (tags.some((t) => /\\p[1-9]|\\[kK][fo]?\d/.test(t))) return null;
		const top = tags.some((t) => /\\an[789]|\\a[567](?!\d)/.test(t));
		const text = raw
			.replace(/\{[^}]*\}/g, (block) =>
				(/\\i1(?!\d)/.test(block) ? '<i>' : '') +
				(/\\b1(?!\d)/.test(block) ? '<b>' : '') +
				(/\\i0(?!\d)/.test(block) ? '</i>' : '') +
				(/\\b0(?!\d)/.test(block) ? '</b>' : '')
			)
			.replace(/\\[Nn]/g, '\n')
			.replace(/\\h/g, ' ');
		if (isCredit(plainSubText(text.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim())) return null;
		const kept = text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.replace(/<[^>]*>/g, '').trim() && !isAdvert(line.replace(/<[^>]*>/g, '')))
			.join('\n');
		return kept ? { text: safeSubHtml(kept), top } : null;
	}

	/**
	 * A whole subtitle that's a credit or an advert spread over several lines, where one line alone
	 * doesn't say so ("Subtitles by / SDI Media Group", "Captioning made possible by / Touchstone
	 * Television…", "Press play. Subtitles appear. / 200+ languages. One app: tryray.app"). Found by
	 * going through 209 English subtitle files of 32 films and shows (2026-10-22).
	 */
	function isCredit(cue: string): boolean {
		return (
			/^[-–=[\s]*(english |closed )?(subtit\w*|captions?|synch?(ed|ro\w*)?|titles( re[- ]?edited)?)( (and|&) \w+)?\s*(by\b|:)/i.test(cue) ||
			/\bcaption(ing|ed)( (made possible|provided|performed))? by\b|\bcaptioning institute\b/i.test(cue) ||
			/explosive ?skull|kaboom ?skull|swesubs|press play\.? subtitles appear|\b200\+ languages|copyright (from|by) s?d?i media|\bsdi media group\b/i.test(cue) ||
			/hope you('ve| have)? (liked|enjoyed)( (&|and) enjoyed)? the (movie|film|show|episode)/i.test(cue) ||
			// Labels, not anything said: "[ENGLISH SDH]", "English - US - SDH"
			/^\[?english( - (us|uk))?( - | )?p?sdh\]?$|^\[?english - (us|uk)\]?$/i.test(cue)
		);
	}

	/**
	 * A line the subtitle sites slip in, not anything said: a web address ("Watch Online Movies
	 * and Series for FREE www.osdb.link/lm", "Downloaded From www.AllSubs.org") or their wording
	 * ("Do you want subtitles for any video?", "Support us and become VIP member", "Subtitles by
	 * …"). Only that line goes: a subtitle with nothing else in it is dropped, and every other
	 * one keeps its own times, so the timing isn't touched. Found by going through the English
	 * subtitles of 20 films and shows; ordinary lines like "...to the real world" don't match.
	 */
	function isAdvert(line: string): boolean {
		return (
			// Not "Awww.. Hey.."
			/(https?:\/\/|\bwww\.)\S+/i.test(line) ||
			// Spaced out to get past filters: "www  .  OpenSubtitles  .  org", "—www. ncicap. org—"
			/\bwww\s*\.\s*[a-z0-9-]+\s*\.\s*[a-z]{2,4}\b/i.test(line) ||
			// "-=xXSwesubsXx=-", and letters drawn out of letters ("sssssss    iiiiiii    mmmmmm")
			/^-=.+=-$/.test(line) ||
			/([a-z])\1{7,}(\s{3,}|\t)/i.test(line) ||
			/\b[a-z0-9-]{2,}\.(com|org|net|link|io|me|to|tv|cc|ws|info|xyz|site|club|mx|ag|ru|pt|ro|app)(\/\S*)?(?![a-z])/i.test(line) ||
			// "Tired of searching for subtitles? Ray generates them instantly: getray.app"
			/subtitles for any video|tired of searching for subtitles|generates (them|subtitles) instantly|advertise your product|support us and become|become (a )?vip|downloaded from/i.test(line) ||
			// A subtitle team's, not Madagascar's "The Central Park Zoo proudly presents..."
			/\b(subs|subtitles?|team|group)\b.{0,30}proudly presents/i.test(line) ||
			// "Watch Online Movies and Series for FREE" (the only line it caught in 56,120 kept ones)
			/\bwatch\b.{0,25}\b(movies?|series|tv shows?|anime)\b.{0,25}\bfree\b|\bfree\b.{0,15}\b(movies?|series)\b.{0,15}\bonline\b/i.test(line) ||
			/^[-–=[\s]*(subtitles?|subs|captions?|synch?(ed|roni[sz]ed)?|resynch?(ed)?|corrected|ripped|translated|transcribed|subtitled|timing|encoded)( (and|&) \w+)? by\b/i.test(line)
		);
	}

	function parseSrt(text: string): Cue[] {
		if (text.includes('[Events]') || text.includes('Dialogue:')) return parseAss(text);

		const cues: Cue[] = [];
		const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().split(/\n\n+/);
		for (const block of blocks) {
			const lines = block.split('\n');
			const timeIdx = lines.findIndex((l) => l.includes('-->'));
			if (timeIdx < 0) continue;
			const [s, e] = lines[timeIdx].split('-->').map(parseTimestamp);
			if (!isFinite(s) || !isFinite(e)) continue;
			const cue = cleanCue(lines.slice(timeIdx + 1).join('\n'));
			if (cue) cues.push({ start: s, end: e, ...cue });
		}
		return cues;
	}

	function parseAss(text: string): Cue[] {
		const cues: Cue[] = [];
		for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
			if (!line.startsWith('Dialogue:')) continue;
			const parts = line.substring(9).split(',');
			if (parts.length < 10) continue;
			const s = parseTimestamp(parts[1]);
			const e = parseTimestamp(parts[2]);
			if (!isFinite(s) || !isFinite(e)) continue;
			const raw = parts.slice(9).join(',');
			const cue = cleanCue(raw);
			// Songs' words and signs, by their style ("ED", "Song_Romaji", "Sign") or a placed line.
			const song =
				/song|lyric|karaoke|insert|opening|ending|sign|title|kfx|(^|[^a-z])(op|ed)([^a-z]|$)/i.test(parts[3] ?? '') ||
				/\\(pos|move)\(/.test(raw);
			if (cue) cues.push({ start: s, end: e, ...cue, ...(song ? { song } : {}) });
		}
		// Some files (anime.nexus's English CC) make every line bold; that's their style, not
		// emphasis, so it's dropped and the player's own subtitle style shows.
		const bold = cues.filter((c) => c.text.startsWith('<b>')).length;
		if (cues.length && bold / cues.length > 0.8) {
			for (const c of cues) c.text = c.text.replace(/<\/?b>/g, '');
		}
		return cues;
	}

	/** Every line showing at time `t`, split by position, with duplicate layers dropped. */
	function subsAt(t: number): { top: string; bottom: string } {
		const top: string[] = [];
		const bottom: string[] = [];
		for (const c of subtitleCues) {
			if (t < c.start || t >= c.end) continue;
			const list = c.top ? top : bottom;
			if (!list.includes(c.text)) list.push(c.text);
		}
		return { top: top.join('\n'), bottom: bottom.join('\n') };
	}

	function uploadSubtitle() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.srt,.vtt,.sub,.ass';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const text = await file.text();
			subtitleCues = parseSrt(text);
			subtitlesOn = true;
			showCaptions = false;
		};
		input.click();
	}

	/* --------------------------------------------------------------- file name tooltips */

	const FILE_TOKENS: Record<string, string> = {
		'2160p': '2160p — 4K Ultra HD resolution (3840×2160 pixels), the sharpest consumer video available',
		'1080p': '1080p — Full HD resolution (1920×1080 pixels), the standard for most streaming and Blu-rays',
		'720p': '720p — HD resolution (1280×720 pixels), decent quality at smaller file sizes',
		'480p': '480p — standard definition (640×480 pixels), DVD-era quality',
		'4K': '4K — Ultra HD resolution, four times the detail of 1080p',
		'UHD': 'UHD — Ultra High Definition, same as 4K (3840×2160)',
		'BluRay': 'BluRay — ripped directly from a Blu-ray disc, usually the highest quality source',
		'Bluray': 'BluRay — ripped directly from a Blu-ray disc, usually the highest quality source',
		'BRRip': 'BRRip — re-encoded from a Blu-ray rip, smaller file but some quality loss',
		'BDRip': 'BDRip — ripped from a Blu-ray disc, encoded to a smaller size',
		'WEBRip': 'WEBRip — screen-captured from a streaming service like Netflix or Disney+',
		'WEB': 'WEB — sourced from a streaming platform (Netflix, Amazon, etc.)',
		'HDRip': 'HDRip — ripped from an HD source, could be streaming or broadcast',
		'DVDRip': 'DVDRip — ripped from a DVD, limited to 480p resolution',
		'HDTV': 'HDTV — captured from an HD television broadcast',
		'REMUX': 'REMUX — lossless copy straight from the disc with zero re-encoding, biggest files but perfect quality',
		'H264': 'H.264 — the most widely used video codec, plays on virtually everything',
		'H265': 'H.265/HEVC — newer codec that halves file size compared to H.264 at the same quality',
		'x264': 'x264 — popular open-source H.264 encoder, known for reliable quality',
		'x265': 'x265 — open-source H.265/HEVC encoder, smaller files than x264 at similar quality',
		'HEVC': 'HEVC — High Efficiency Video Coding (H.265), cuts file size in half vs older codecs',
		'AVC': 'AVC — Advanced Video Coding, the technical name for H.264',
		'XviD': 'XviD — older MPEG-4 codec from the DVD-rip era, rarely used now',
		'VP9': 'VP9 — Google\'s video codec used heavily on YouTube',
		'AV1': 'AV1 — the newest video codec with the best compression, still gaining device support',
		'10bit': '10-bit — deeper color depth (1 billion colors vs 16 million), smoother gradients and fewer banding artifacts',
		'AAC': 'AAC — Advanced Audio Coding, the standard audio format for streaming and Apple devices',
		'AC3': 'AC3 — Dolby Digital 5.1 surround sound, the standard for DVDs and many Blu-rays',
		'EAC3': 'EAC3 — Dolby Digital Plus, an upgraded version of AC3 used by Netflix and streaming',
		'DTS': 'DTS — competing surround sound format to Dolby, common on Blu-rays',
		'FLAC': 'FLAC — lossless audio with no quality loss, larger files than AAC/MP3',
		'MP3': 'MP3 — the universal compressed audio format, small files but lossy',
		'Atmos': 'Dolby Atmos — 3D spatial audio that places sounds above and around you, needs compatible speakers',
		'TrueHD': 'Dolby TrueHD — lossless surround sound found on Blu-rays, bit-perfect audio',
		'OPUS': 'Opus — modern audio codec that beats AAC and MP3 at the same bitrate',
		'HDR': 'HDR — High Dynamic Range, brighter highlights and deeper blacks than standard video',
		'HDR10': 'HDR10 — the baseline HDR standard supported by all HDR TVs',
		'DV': 'Dolby Vision — premium HDR format with scene-by-scene optimization, needs a compatible display',
		'DoVi': 'Dolby Vision — premium HDR format with scene-by-scene optimization, needs a compatible display',
		'PROPER': 'PROPER — a corrected re-release that fixes problems in an earlier version',
		'REPACK': 'REPACK — repacked to fix a specific issue (bad audio, sync, etc.) in the first release',
		'EXTENDED': 'EXTENDED — the extended cut with extra scenes not in the theatrical release',
		'UNRATED': 'UNRATED — unrated version that was never submitted for a rating, may have additional content',
		'DC': "Director's Cut — the director's preferred version, often with restored or altered scenes",
		'IMAX': 'IMAX — filmed or formatted for IMAX, with a taller aspect ratio on select scenes',
		'REMASTERED': 'REMASTERED — remastered with improved picture/audio quality from the original elements',
		'mp4': 'MP4 — the most common video container, plays everywhere',
		'mkv': 'MKV — Matroska container, supports multiple audio/subtitle tracks in one file',
		'avi': 'AVI — an older Microsoft container format, limited feature support',
		'webm': 'WebM — Google\'s web-optimized container, used on YouTube',
		'm4v': 'M4V — Apple\'s variant of MP4, sometimes has DRM',
		'RARBG': 'RARBG — popular torrent site known for verified, high-quality uploads',
		'YTS': 'YTS/YIFY — release group known for very small file sizes with decent visual quality',
		'YIFY': 'YIFY — release group known for very small file sizes with decent visual quality',
		'FGT': 'FGT — release group that produces solid quality rips across many titles',
		'EVO': 'EVO — release group that specializes in early releases, often before official streaming dates',
		'SPARKS': 'SPARKS — one of the most well-known scene release groups in piracy history',
		'NTb': 'NTb — release group known for top-tier WEB-DL captures from streaming services',
		'FLUX': 'FLUX — release group specializing in high-quality streaming rips',
		'PSA': 'PSA — release group focused on efficient encodes that balance quality and file size',
		'GalaxyRG': 'GalaxyRG — active release group with a wide variety of movie and TV encodes',
		'ION10': 'ION10 — release group specializing in 10-bit encodes for better color depth',
		'tigole': 'Tigole — release group famous for the highest quality encodes, often with extras and commentary',
		'FraMeSToR': 'FraMeSToR — premium release group known for full REMUX and high-bitrate encodes',
		'ESiR': 'ESiR — release group producing quality x264 encodes, especially for older films',
		'GalaxyTV': 'GalaxyTV — release group focused on TV series encodes',
		'AMIABLE': 'AMIABLE — scene release group producing consistent quality rips',
		'STUTTERSHIT': 'STUTTERSHIT — release group known for high-quality Blu-ray encodes',
		'QxR': 'QxR — release group producing efficient, high-quality encodes with small file sizes',
		'DDP5': 'DDP 5.1 — Dolby Digital Plus surround sound, used by most streaming platforms',
		'DDP': 'Dolby Digital Plus — enhanced Dolby audio used by Netflix and other streaming services',
		'SDR': 'SDR — Standard Dynamic Range, the traditional video format without HDR enhancements',
		'5.1': '5.1 surround sound — six audio channels: front left/center/right, rear left/right, and subwoofer',
		'7.1': '7.1 surround sound — eight audio channels for even more immersive audio',
		'2.0': '2.0 stereo — standard two-channel left/right audio',
	};

	function parseFileTokens(name: string): { text: string; tip: string }[] {
		const ext = name.match(/\.([a-z0-9]{2,4})$/i);
		const base = ext ? name.slice(0, -ext[0].length) : name;
		const extStr = ext ? ext[0] : '';
		const parts = base.split(/([.\-_\s\[\]\(\)])/);
		const tokens: { text: string; tip: string }[] = [];

		for (const part of parts) {
			if (!part) continue;
			if (/^[.\-_\s\[\]\(\)]$/.test(part)) {
				tokens.push({ text: part, tip: '' });
				continue;
			}
			const upper = part.toUpperCase();
			const found = Object.entries(FILE_TOKENS).find(([k]) => k.toUpperCase() === upper);
			if (found) {
				tokens.push({ text: part, tip: found[1] });
			} else if (/^\d{4}$/.test(part) && +part > 1900 && +part < 2100) {
				tokens.push({ text: part, tip: 'Year of release' });
			} else if (/^\d+\.\d+$/.test(part)) {
				tokens.push({ text: part, tip: `${part} audio channels` });
			} else {
				tokens.push({ text: part, tip: '' });
			}
		}

		if (extStr) {
			const extKey = extStr.slice(1).toLowerCase();
			const found = Object.entries(FILE_TOKENS).find(([k]) => k.toLowerCase() === extKey);
			tokens.push({ text: extStr, tip: found?.[1] ?? '' });
		}

		return tokens;
	}

	/* --------------------------------------------------------------- watch progress */

	function buildProgressBody(): string | null {
		// Between episodes the video is still the one before: its place isn't this episode's. (And
		// while the mini player plays, it's the one saving.)
		if (liveMode || !videoTitle || !videoEl || switchingEpisode || loadingEpisode || inMini) return null;
		const ct = videoEl.currentTime;
		const dur = videoEl.duration;
		if (!dur || !isFinite(dur) || dur < 10 || ct < 3) return null;
		// A replay keeps its place too (Continue Watching, Live TV's Recently watched), by its title.
		if (replayMode) return JSON.stringify({ title: videoTitle, type: 'replay', season: 0, episode: 0, currentTime: ct, duration: dur, posterUrl: replayPoster });
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const s = showType === 'tv' && activeEpisode ? activeEpisode.season : 0;
		const e = showType === 'tv' && activeEpisode ? activeEpisode.episode : 0;
		return JSON.stringify({
			title: baseTitle, type: showType, season: s, episode: e,
			currentTime: ct, duration: dur,
			subUrl: subtitlesOn ? activeSubUrl : '',
			subDelay: subtitleDelay,
			subFileName: subtitlesOn ? activeSubFileName : '',
			posterUrl: watchPosterUrl,
			shareKey, fid: activeFileFid
		});
	}

	function saveProgressSync() {
		const body = buildProgressBody();
		if (!body) return;
		try {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', '/api/watch/progress', false);
			xhr.setRequestHeader('Content-Type', 'application/json');
			xhr.send(body);
		} catch {}
		noteUpNext();
	}

	function saveProgress() {
		const body = buildProgressBody();
		if (!body) return;
		fetch('/api/watch/progress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			keepalive: true
		}).then((r) => {
			if (r.ok) {
				if (showType === 'tv' && activeEpisode && duration > 0) {
					const key = `${activeEpisode.season}-${activeEpisode.episode}`;
					const pct = currentTime / duration;
					const prev = watchedEpisodeMap.get(key) ?? 0;
					if (pct > prev) {
						watchedEpisodeMap = new Map(watchedEpisodeMap).set(key, pct);
					}
				}
				noteUpNext();
				askForRating();
			}
		}).catch(() => {});
	}

	/*
	 * Finished a film, or a series' last episode there is: "Rate it", with the stars right there.
	 * Nobody opened a title's page, scrolled to Edit and saved just to rate it (2026-10-23: none of
	 * 438 titles had a rating). Once per visit, only for what's in the library and not yet rated,
	 * on the computer (not a TV, whose profiles' lists have no ratings, nor the mini player).
	 * Asked once the player is left (RatePrompt.svelte), not over the film's last scenes (Hurt
	 * Locker's came up before it ended, 2026-10-25): here it's only noted that 90% was watched.
	 */
	let ratingAsked = false;
	let rateWanted = false;

	function askForRating() {
		if (ratingAsked || tvMode || miniMode || !libraryEntryId || libraryEntryRating !== null || !videoEl) return;
		const length = videoEl.duration;
		if (!length || !isFinite(length) || videoEl.currentTime / length < 0.9) return;
		if (showType === 'tv' && nextEpisode()) return;
		rateWanted = true;
	}

	/** Leaving the player: "Rate it" on the page that comes next, if it was watched. */
	function offerRatingOnLeaving() {
		askForRating();
		if (!rateWanted || ratingAsked || !libraryEntryId || libraryEntryRating !== null) return;
		ratingAsked = true;
		ratePrompt.offer = { entryId: libraryEntryId, title: videoTitle.replace(/ S\d+E\d+$/, '') };
	}

	function saveProgressBeacon() {
		const body = buildProgressBody();
		if (!body) return;
		navigator.sendBeacon('/api/watch/progress', new Blob([body], { type: 'application/json' }));
		noteUpNext();
	}

	/*
	 * Most of an episode watched (the credits rolling): Continue Watching moves on to the next
	 * one, "Up next". It used to wait for the last frame, so stopping in the credits left the card
	 * on the episode just watched ("S2E17 · 97% · 0m left"). Sent again after every save of this
	 * episode, or that save would put this one back on top.
	 */
	function noteUpNext() {
		if (showType !== 'tv' || !videoEl || switchingEpisode || loadingEpisode) return;
		const length = videoEl.duration;
		if (!length || !isFinite(length) || videoEl.currentTime / length < 0.95) return;
		const next = nextEpisode();
		if (!next) return;
		const payload = JSON.stringify({
			title: videoTitle.replace(/ S\d+E\d+$/, ''), type: 'tv',
			season: next.season, episode: next.episode,
			currentTime: 0, duration: 0,
			posterUrl: watchPosterUrl
		});
		navigator.sendBeacon('/api/watch/progress', new Blob([payload], { type: 'application/json' }));
	}

	function startProgressSaving() {
		stopProgressSaving();
		progressSaveTimer = setInterval(saveProgress, 10000);
	}

	function stopProgressSaving() {
		if (progressSaveTimer) { clearInterval(progressSaveTimer); progressSaveTimer = null; }
	}

	type SavedPlace = { at: number; subUrl?: string; subFileName?: string; subDelay?: number };

	/**
	 * Where this video was left, in seconds (0: from the start), with the subtitles saved there.
	 * An episode already finished moves on to the next one instead (null). Asked for as soon as
	 * the video is chosen, so the video can start loading right there rather than at the start.
	 */
	async function savedPlace(): Promise<SavedPlace | null> {
		if (!videoTitle) return { at: 0 };
		if (skipResume) { skipResume = false; return { at: 0 }; }
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const s = showType === 'tv' && activeEpisode ? activeEpisode.season : 0;
		const e = showType === 'tv' && activeEpisode ? activeEpisode.episode : 0;
		try {
			const resp = await fetch(`/api/watch/progress?title=${encodeURIComponent(baseTitle)}&type=${showType}&season=${s}&episode=${e}`);
			if (!resp.ok) return { at: 0 };
			const data = await resp.json();
			if (!data) return { at: 0 };
			let at = 0;
			const pct = data.duration > 0 ? data.currentTime / data.duration : 0;
			// Finished already: on to the next one, leaving this one's finished place as it is. (Also
			// one ticked by hand, kept as 1 s of 1: it was played again from its start, and its tick
			// went once it had played a few seconds.)
			const moveOn = mayMoveOn;
			mayMoveOn = false;
			if (pct >= 0.95 && showType === 'tv' && moveOn) {
				const next = nextEpisode();
				if (next) { playEpisode(next, true); return null; }
			}
			// Finished with nothing after it (the last episode, a film): from the start, not the end.
			if (data.currentTime > 5 && pct < 0.95) at = data.currentTime;
			return { at, subUrl: data.subUrl, subFileName: data.subFileName, subDelay: data.subDelay };
		} catch {
			return { at: 0 };
		}
	}

	/**
	 * The subtitles that were on, back on. Not plain subtitles over the English dub: they were on
	 * for Japanese audio (captions, which follow the dub, still come back).
	 */
	async function restoreSavedSubs(place: SavedPlace) {
		const forDub = /\bCC\b|SDH/i.test(place.subFileName ?? '');
		// Not over subtitles in the picture, nor for a show they were turned off for.
		if (activeFile?.burnedIn || captionsOffForShow()) return;
		// Whether English audio is a dub depends on this being anime (asked as it opened).
		await animeKnown;
		if (place.subUrl && (!hearingDub() || forDub)) {
			loadSub({ id: '0', url: place.subUrl, lang: 'eng', language: 'English', fileName: place.subFileName || '' });
			if (place.subDelay) subtitleDelay = place.subDelay;
		}
	}

	/** For a plain video file (not a playlist): jumps to where it was left once it has loaded. */
	async function loadAndResumeProgress() {
		const place = await savedPlace();
		if (!place || !videoEl) return;
		const seekTo = place.at;
		if (seekTo > 0) {
			if (videoEl.readyState >= 1) {
				videoEl.currentTime = seekTo;
			} else {
				videoEl.addEventListener('loadeddata', () => {
					if (videoEl) videoEl.currentTime = seekTo;
				}, { once: true });
			}
		}
		restoreSavedSubs(place);
	}

	/** Files that came at low quality and were given a fresh link (once each). */
	const lowQualityRetried = new Set<number>();

	/**
	 * A 720p-or-better file whose picture arrives at 480p or less: Showbox sometimes hands over a
	 * link held to low quality. A fresh one is fetched, once per file, so it never stays at 360p
	 * unless that's the file picked.
	 */
	function checkLowQuality() {
		const height = videoEl?.videoHeight ?? 0;
		const fileQuality = parseInt(activeFile?.quality ?? '') || 0;
		if (!activeFile || activeFile.source || fileQuality < 720 || !height || height > 480) return;
		// Held back a second time (or Febbox's limit already seen): another source, if there is one.
		if (lowQualityRetried.has(activeFile.fid) || lowOnly(activeFile.fid) || febboxOut()) {
			showboxHeldBack([height]);
			return;
		}
		lowQualityRetried.add(activeFile.fid);
		debugInfo = (debugInfo ? debugInfo + ' | ' : '') + `low quality (${height}p): fresh link`;
		refreshStream();
	}

	/** Gets a brand-new link for the current file and picks up where it left off. Capped so it can't loop forever. */
	async function refreshStream() {
		notePlayerEvent('fresh link');
		// Live: the channel loaded again (its playlist asks for a fresh stream), a few times at most.
		if (sportsMode) {
			if (liveRestarts++ >= 4) {
				tellChannel(false);
				problem = liveMode ? "This channel can't be played right now." : "This replay can't be played right now. Try another version.";
				stalledOut = true;
				return;
			}
			if (replayMode && videoEl) seekAfterLoad = videoEl.currentTime;
			streamNonce++;
			return;
		}
		if (refreshingStream) return;
		const fid = activeFile?.fid;
		const share = shareOf(activeFile);
		if (!fid || !share || !videoEl) return;

		const now = performance.now();
		if (now - lastRefreshAt > 120_000) streamRefreshes = 0;
		if (streamRefreshes >= 2) {
			clearStallWatch();
			stalledOut = true;
			problem = 'The video keeps getting stuck.';
			return;
		}
		streamRefreshes++;
		lastRefreshAt = now;
		if (hlsInstance?.levels.some((l) => l.details?.fragments.some((f) => f.url.includes('&part=')))) piecesWhole = true;

		refreshingStream = true;
		const savedTime = videoEl.currentTime || seekAfterLoad;
		try {
			const resp = await fetch(`/api/watch/stream?share_key=${share}&fid=${fid}&refresh=1`);
			if (!resp.ok) throw new Error();
			const result = await resp.json();
			if (!result.url) throw new Error();
			if (result.debug) debugInfo = result.debug;
			seekAfterLoad = savedTime;
			loadPaused = userPaused;
			streamUrl = result.url;
			streamNonce++;
		} catch {
			clearStallWatch();
			stalledOut = true;
			problem = 'Could not get a fresh link for this video.';
		} finally {
			refreshingStream = false;
		}
	}

	function retryStream() {
		if (sportsMode) {
			liveRestarts = 0;
			stalledOut = false;
			problem = '';
			streamNonce++;
			return;
		}
		stalledOut = false;
		problem = '';
		streamRefreshes = 0;
		refreshStream();
	}

	function markBytes() {
		lastBytesAt = performance.now();
	}

	function bufferedAhead(): number {
		return videoEl ? aheadIn(videoEl.buffered) : 0;
	}

	/** How far past the current spot `ranges` reach without a gap. */
	function aheadIn(ranges: TimeRanges): number {
		if (!videoEl) return 0;
		const t = videoEl.currentTime;
		for (let i = 0; i < ranges.length; i++) {
			if (ranges.start(i) <= t + 0.5 && ranges.end(i) > t) return ranges.end(i) - t;
		}
		return 0;
	}

	/** Watches a stall (or a start) and steps up: skip a gap, reopen the connection, then fetch a fresh link. */
	function watchForStall() {
		stallSince = performance.now();
		stallNudged = false;
		stallReloaded = false;
		if (!stallTimer) stallTimer = setInterval(checkStall, 2000);
	}

	function clearStallWatch() {
		if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
	}

	function checkStall() {
		if (!videoEl || loadingEpisode || changingQuality || refreshingStream) return;
		// Paused on purpose: nothing downloading is normal, and a fresh link would start it playing.
		if (userPaused) { clearStallWatch(); return; }
		if (!videoEl.paused && videoEl.readyState >= 3) { clearStallWatch(); return; }

		// Stuck in its last seconds: that's the end, not a broken link.
		if (duration > 0 && videoEl.currentTime >= duration - 3) {
			clearStallWatch();
			episodeEnded();
			return;
		}

		const now = performance.now();
		const stuckFor = now - stallSince;
		// Silence on the wire, not slowness: a slow download still delivers bytes.
		const quietFor = now - Math.max(lastBytesAt, stallSince);

		if (!stallNudged && stuckFor > 6000 && bufferedAhead() > 3) {
			stallNudged = true;
			videoEl.currentTime = videoEl.currentTime + 0.1;
			return;
		}
		if (!stallReloaded && quietFor > 10_000 && hlsInstance) {
			stallReloaded = true;
			stallSince = now;
			hlsInstance.stopLoad();
			hlsInstance.startLoad(videoEl.currentTime);
			return;
		}
		if ((stallReloaded && quietFor > 12_000) || (!hlsInstance && stuckFor > 20_000)) {
			clearStallWatch();
			refreshStream();
		}
	}

	/**
	 * The end of the video: its last frame played, or it stuck for good in its last few seconds
	 * (which used to fetch a fresh link and play the end again instead of moving on).
	 */
	/** Watched to the end: what the computer downloaded of it ahead can go (7Movies, Movy). */
	let finishedCopy = '';
	function finishedDownload(file: FileOption | null | undefined = activeFile) {
		const copy = file?.source ? shareOf(file) : '';
		if (!copy || copy === finishedCopy || !(file?.source === 'Movy' || file?.source === '7Movies')) return;
		finishedCopy = copy;
		fetch(`/api/watch/download-ahead?copy=${encodeURIComponent(copy)}`, { method: 'DELETE' }).catch(() => {});
	}

	function episodeEnded() {
		if (sportsMode) return;
		finishedDownload();
		playing = false;
		showControls = true;
		saveProgress();
		askForRating();
		const next = nextEpisode();
		if (showType === 'tv' && next) {
			const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
			const payload = JSON.stringify({
				title: baseTitle, type: 'tv',
				season: next.season, episode: next.episode,
				currentTime: 0, duration: 0,
				posterUrl: watchPosterUrl
			});
			navigator.sendBeacon('/api/watch/progress', new Blob([payload], { type: 'application/json' }));
			// Only once the last frame has played — firing early cut off endings.
			if (autoplayNext && !autoplayFired && !loadingEpisode) {
				autoplayFired = true;
				playEpisode(next);
			}
		}
	}

	/** Server-side link for the next episode, fetched ahead so it starts at once. */
	/** The pieces of the playing quality that are on the computer, as time ranges (see heldRanges). */
	async function readHeld() {
		const hls = hlsInstance;
		const level = hls ? hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : Math.max(0, hls.loadLevel)] : null;
		const pieces = level?.details?.fragments ?? [];
		const copy = pieces.length ? new URL(pieces[0].url, location.href).searchParams.get('copy') : null;
		if (!copy) {
			heldRanges = [];
			return;
		}
		const answer = await fetch(`/api/watch/download-ahead?copy=${encodeURIComponent(copy)}`)
			.then((r) => (r.ok ? (r.json() as Promise<{ held: number[]; total: number; going: number }>) : null))
			.catch(() => null);
		if (!answer || hls !== hlsInstance) return;
		const held = new Set(answer.held);
		heldCount = { held: answer.held.length, total: answer.total, going: answer.going };
		const ranges: { start: number; end: number }[] = [];
		for (const piece of pieces) {
			if (!held.has(Number(new URL(piece.url, location.href).searchParams.get('n')))) continue;
			const last = ranges[ranges.length - 1];
			if (last && piece.start - last.end < 0.5) last.end = piece.start + piece.duration;
			else ranges.push({ start: piece.start, end: piece.start + piece.duration });
		}
		heldRanges = ranges;
	}

	// Asked every few seconds while a copy that's downloaded ahead plays.
	$effect(() => {
		const file = activeFile;
		heldRanges = [];
		heldCount = { held: 0, total: 0, going: 0 };
		if (!file || !(file.source === 'Movy' || file.source === '7Movies')) return;
		const timer = setInterval(() => untrack(readHeld), 5000);
		return () => clearInterval(timer);
	});

	let downloadAheadKey = '';
	function prefetchNextEpisode() {
		// (Not only with a Showbox share: with Showbox down, 7Movies' and Movy's next links were
		// never fetched ahead, and Next Episode waited ~30 s on their lookups.)
		if (showType !== 'tv' || !videoEl || duration <= 0) return;
		const next = nextEpisode();
		const file = next ? pickFor(next.files) : null;
		if (!next || !file) return;
		const remaining = duration - currentTime;
		// 7Movies' and Movy's next episode is downloaded onto the computer while this one plays
		// (episodeDownloads.ts), from a minute in: it then starts with nothing to wait for, on a TV too.
		if (file.source && currentTime >= 60 && (file.source === 'Movy' || file.source === '7Movies')) {
			const ahead = `${shareOf(file)}:${file.fid}`;
			if (ahead !== downloadAheadKey) {
				downloadAheadKey = ahead;
				fetch('/api/watch/download-ahead', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ share_key: shareOf(file), fid: file.fid })
				}).catch(() => {});
			}
		}
		// Another source's link is a few quick lookups, so it's fetched early and kept fresh
		// (asked again every four minutes; the server only re-fetches one that's getting old).
		// Showbox's waits until this episode is fully loaded.
		let round = '';
		if (file.source) {
			if (currentTime < 20) return;
			round = `:${Math.floor(performance.now() / 240_000)}`;
		} else {
			if (remaining > 180) return;
			if (remaining > 60 && bufferedAhead() < remaining - 2) return;
		}
		const share = file.source ? shareOf(file) : next.shareKey || mainShareKey;
		if (!share) return;
		const key = `${share}:${file.fid}${round}`;
		if (key === nextPrefetchKey) return;
		nextPrefetchKey = key;
		fetch('/api/watch/prefetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ share_key: share, fids: [file.fid] })
		}).catch(() => {});
	}

	/** Links for the other qualities, held back until playback is settled so they never compete with it. */
	function queueQualityPrefetch(files: FileOption[], activeFid: number) {
		pendingQualityPrefetch = files.filter((f) => f.fid !== activeFid && !f.source).map((f) => f.fid);
	}

	function flushQualityPrefetch() {
		if (!pendingQualityPrefetch.length || !shareKey || currentTime < 45) return;
		const fids = pendingQualityPrefetch;
		pendingQualityPrefetch = [];
		fetch('/api/watch/prefetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ share_key: shareKey, fids })
		}).catch(() => {});
	}

	/**
	 * How much of what's on has actually played (jumping ahead doesn't count), so a film is only
	 * marked watched when it really was.
	 */
	let playedSeconds = 0;
	let playedFrom = -1;
	function countPlayed() {
		if (!videoEl || !playing || seeking || isVideoSeeking || switchingEpisode) {
			playedFrom = -1;
			return;
		}
		const t = videoEl.currentTime;
		const step = t - playedFrom;
		if (playedFrom >= 0 && step > 0 && step < 3) playedSeconds += step;
		playedFrom = t;
	}

	/*
	 * A hole of up to 3 s in the picture while the sound goes on. 7Movies' HEVC copy of SVU S28E3
	 * has pieces whose third frame repeats the keyframe's time, so the browser drops the keyframe
	 * and the 2 s of picture after it. The sound then played over a still picture with no sign of
	 * loading (2026-10-25). It's stepped over instead, but only once it has stayed a hole for 5 s
	 * (a piece still on its way fills in by then).
	 */
	/*
	 * The video going back by itself: a friend's films "every once in a while stop and go back a
	 * few seconds" (2026-10-25, on 3.5.0), and nothing in the player is meant to. A jump back of
	 * over a second with no click, key or touch just before is kept in the stop log, with what
	 * happened in the 30 s before it, to find which part did it.
	 */
	let lastPosition = 0;
	let lastInputAt = 0;
	$effect(() => {
		const touched = () => (lastInputAt = performance.now());
		for (const kind of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(kind, touched, { capture: true });
		return () => {
			for (const kind of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(kind, touched, { capture: true });
		};
	});
	function noteJumpBack() {
		const v = videoEl;
		if (!v || loadingEpisode || switchingEpisode || inMini || performance.now() - lastInputAt < 2000) return;
		const back = lastPosition - v.currentTime;
		if (back < 1 || v.currentTime < 1) return;
		fetch('/api/watch/playback-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...playbackNow(), ...stopDetails(), what: `Went back ${Math.round(back * 10) / 10} s by itself (from ${fmt(lastPosition)})` }),
			keepalive: true
		}).catch(() => {});
	}

	/*
	 * A seam where two loaded parts of the picture meet (7Movies' HEVC, 2026-10-25). Each of its
	 * pieces starts with a few frames shown before its keyframe ("leading" ones, see
	 * pieceRepair.ts). When a piece is the first one loaded after a jump, the browser throws
	 * those frames away, so once the part before it is loaded too, a hole of a few frames is left
	 * there and the player skipped half a second over it. The picture from the hole on is loaded
	 * again (from this computer's copy), straight after the piece before it, so they stay. (Only
	 * from the hole to the end: taking out one piece takes the next one's leading frames with it.)
	 */
	const seamsMended = new Set<string>();
	function mendPictureSeam(hls: Hls, ranges: TimeRanges | undefined, appendedEnd: number) {
		if (!ranges) return;
		for (let i = 0; i + 1 < ranges.length; i++) {
			const end = ranges.end(i);
			const hole = ranges.start(i + 1) - end;
			if (hole <= 0.01 || hole > 0.3 || Math.abs(end - appendedEnd) > 0.5) continue;
			const key = end.toFixed(1);
			if (seamsMended.has(key)) return;
			seamsMended.add(key);
			notePlayerEvent(`loaded the picture after a ${hole.toFixed(2)} s seam again`);
			hls.trigger(Hls.Events.BUFFER_FLUSHING, { startOffset: end, endOffset: Infinity, type: 'video' });
			return;
		}
	}

	const holesSeen = new Map<string, number>();
	function stepOverPictureHole() {
		const v = videoEl;
		const ranges = trackRanges.video ?? v?.buffered;
		if (!v || !ranges || v.paused || v.seeking) return;
		const t = v.currentTime;
		const now = performance.now();
		for (let i = 0; i + 1 < ranges.length; i++) {
			const end = ranges.end(i);
			const next = ranges.start(i + 1);
			if (next - end <= 0.1 || next - end > 3 || next < t) continue;
			const key = end.toFixed(1);
			if (!holesSeen.has(key)) holesSeen.set(key, now);
			if (t > end - 0.4 && now - holesSeen.get(key)! >= 5000) {
				notePlayerEvent(`stepped over a ${(next - end).toFixed(1)} s hole in the picture`);
				v.currentTime = next + 0.05;
				return;
			}
		}
	}

	function onTimeUpdate() {
		countPlayed();
		stepOverPictureHole();
		if (videoEl && !videoEl.seeking) lastPosition = videoEl.currentTime;
		if (videoEl && !seeking && !isVideoSeeking && !switchingEpisode) currentTime = videoEl.currentTime;
		if (replayMode) return;
		if (liveMode) {
			const edge = hlsInstance?.liveSyncPosition;
			liveBehind = edge ? Math.max(0, edge - currentTime) : 0;
			if (!liveNoted && currentTime > 1) {
				liveNoted = true;
				fetch('/api/live/watched', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: liveNow.id, name: liveNow.name }) }).catch(() => {});
				liveVerdict = { channel: liveNow.id, from: currentTime, told: false };
			}
			if (liveVerdict && !liveVerdict.told && currentTime - liveVerdict.from >= 60) tellChannel(true);
			return;
		}
		if (currentTime >= 60) autosyncEpisode();
		if (duration > 0 && currentTime >= duration - Math.min(120, duration * 0.1)) {
			autosyncFinished();
			noteCaughtUp();
		}
		if (duration > 0 && (currentTime >= duration * 0.95 || (creditsStart !== null && currentTime >= creditsStart))) filmFinished();
		flushQualityPrefetch();
		prefetchNextEpisode();
		autoSkipCheck();
		// "Video failed to load" while the video plays on: it goes once a few seconds more have played.
		if (loadProblemAt !== null && currentTime > loadProblemAt + 3) {
			if (problem.startsWith('Video failed to load')) problem = '';
			loadProblemAt = null;
		}
	}
	/** Where the video was when "Video failed to load" showed (null: not showing). */
	let loadProblemAt: number | null = null;

	function overallEpisodeNumber(ep: Episode): number {
		let n = ep.episode;
		for (const s of seasons) {
			if (s < 1 || s >= ep.season) continue;
			n += Math.max(0, ...episodes.filter((e) => e.season === s).map((e) => e.episode));
		}
		return n;
	}

	let skipFindStop: AbortController | null = null;

	/**
	 * Intro, recap and credits: AniSkip's (crowd-sourced, anime only), and what Catalog found
	 * itself by comparing this episode's sound with a neighbour's (src/lib/skipFinder.ts) — that's
	 * timed on this very file, so it wins where both have an answer.
	 */
	async function loadSkipTimes(ep: Episode, length: number) {
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		// Any copy, from any source: each is timed on its own (other sources' copies are often
		// other cuts, so another copy's times can't be borrowed).
		const file = activeFile;
		const copy = file ? skipKeyOf(file) : '';
		const key = `${baseTitle}:${ep.season}:${ep.episode}:${copy}`;
		if (key === skipLookupKey) return;
		skipLookupKey = key;
		skipSegments = [];
		skipFindStop?.abort();
		const params = new URLSearchParams({
			title: baseTitle,
			episode: String(overallEpisodeNumber(ep)),
			duration: String(Math.round(length)),
			season: String(ep.season),
			number: String(ep.episode)
		});
		const [fromAniSkip, found] = await Promise.all([
			fetch(`/api/watch/skip-times?${params}`)
				.then((r) => (r.ok ? (r.json() as Promise<SkipSegment[]>) : []))
				.catch(() => [] as SkipSegment[]),
			copy ? keptSkips(copy) : Promise.resolve(null)
		]);
		if (key !== skipLookupKey) return;
		skipSegments = withFound(fromAniSkip, found ?? []);
		// Not looked for yet: compared with a neighbouring episode once this one is playing well.
		// A TV asks the computer instead: it would compete with the TV's own video. The computer
		// can't hear what the TV downloads, though, so for a copy with its sound inside the picture
		// (Bleach on Aniwave) the TV does the light part itself: the computer works out the next
		// episode's intro and credits, and the TV finds that sound in its own downloads.
		// (Also another source's copy kept with an intro and no credits: the first build of this
		// only found credits once the end had downloaded, so many were kept without them.)
		const incomplete = Boolean(found && file?.source && !file.hevc && !found.some((s) => s.type === 'credits'));
		if ((found === null || incomplete) && file && copy) {
			if (!isTv()) findSkipsFor(ep, file, key, copy, fromAniSkip, false, incomplete ? found : null);
			else if (!file.source || file.hevc) askComputerForSkips(ep, file, key, copy, fromAniSkip);
			else findSkipsFor(ep, file, key, copy, fromAniSkip, true, incomplete ? found : null);
		}
	}

	/** The intro and credits found for a copy before (null: not looked for yet). */
	function keptSkips(copy: string): Promise<SkipSegment[] | null> {
		return fetch(`/api/watch/skip-found?key=${encodeURIComponent(copy)}`)
			.then((r) => (r.ok ? r.json() : { segments: null }))
			.then((r) => r.segments as SkipSegment[] | null)
			.catch(() => null);
	}

	async function findSkipsFor(ep: Episode, file: FileOption, key: string, copy: string, fromAniSkip: SkipSegment[], onTv = false, known: SkipSegment[] | null = null) {
		const stop = new AbortController();
		skipFindStop = stop;
		const show = (found: SkipSegment[]) => {
			if (key === skipLookupKey) skipSegments = withFound(fromAniSkip, found);
		};
		const found = await findAndKeepSkips({
			episodes,
			season: ep.season,
			episode: ep.episode,
			key: copy,
			quality: file.quality,
			master: streamUrl,
			mainShareKey,
			// The neighbour in the same language (Aniwave's dub copy says English).
			language: hlsInstance?.audioTracks[hlsInstance.audioTrack]?.lang || (file.audio === 'English' ? 'en' : isAnime ? 'ja' : ''),
			// A copy with its sound inside the picture is heard from what the player downloads.
			heard: file.source && downloadedFor === copy ? downloadedSound : null,
			onFound: show,
			referenceFrom: onTv ? (neighbour) => computerFindsSkipsOf(neighbour, neighbour.copy, stop.signal) : undefined,
			known: known?.filter((s): s is Found => s.type !== 'recap'),
			canFetch: () => !videoEl || bufferedAhead() > 30,
			signal: stop.signal
		}).catch(() => null);
		if (found) show(found);
	}

	/**
	 * A TV asks the computer for another episode's intro and credits (/skip-maker, from copies
	 * with separate sound tracks), then waits for them: up to 2 minutes. Null if they never came.
	 */
	async function computerFindsSkipsOf(other: { season: number; episode: number; files: { fid: number; source?: string; shareKey?: string }[] }, copy: string, signal: AbortSignal): Promise<Found[] | null> {
		const file = other.files.find((f) => skipKeyOf(f) === copy);
		if (!file) return null;
		fetch('/api/watch/skip-found/prepare', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: videoTitle.replace(/ S\d+E\d+$/, ''), year: lastResolveArgs?.year ?? '', season: other.season, episode: other.episode, fid: file.fid, key: copy })
		}).catch(() => {});
		for (let tries = 0; tries < 8 && !signal.aborted; tries++) {
			await new Promise((r) => setTimeout(r, 15_000));
			const found = await keptSkips(copy);
			// (Only an intro and credits are ever kept from comparing.)
			if (found !== null) return found.filter((s): s is Found => s.type !== 'recap');
		}
		return null;
	}

	/** A TV asks the computer to find them (/skip-maker), then looks again in a while. */
	function askComputerForSkips(ep: Episode, file: FileOption, key: string, copy: string, fromAniSkip: SkipSegment[]) {
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		fetch('/api/watch/skip-found/prepare', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: baseTitle, year: lastResolveArgs?.year ?? '', season: ep.season, episode: ep.episode, fid: file.fid, key: copy })
		}).catch(() => {});
		for (const wait of [30_000, 75_000]) {
			setTimeout(async () => {
				if (key !== skipLookupKey) return;
				const found = await keptSkips(copy);
				if (found?.length && key === skipLookupKey) skipSegments = withFound(fromAniSkip, found);
			}, wait);
		}
	}

	/*
	 * What the player downloads of a copy with its sound inside the picture (7Movies' H.264 copy,
	 * Movy, Aniwave), heard for finding its intro and credits (src/lib/downloadedSound.ts). Kept
	 * per copy, so a fresh link partway through doesn't throw away what was heard.
	 */
	let downloadedSound: DownloadedSound | null = null;
	let downloadedFor = '';

	function hearDownloadsOf(file: FileOption | null) {
		const copy = file?.source ? skipKeyOf(file) : '';
		if (copy === downloadedFor) return;
		downloadedFor = copy;
		downloadedSound = copy ? new DownloadedSound(() => videoEl?.duration ?? NaN) : null;
	}

	function handleBeforeUnload() {
		saveProgressBeacon();
	}

	beforeNavigate(() => {
		saveProgressSync();
		offerRatingOnLeaving();
	});

	/* --------------------------------------------------------------- watched episodes */

	async function fetchWatchedEpisodes() {
		if (showType !== 'tv' || !videoTitle) return;
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const map = new Map<string, number>();
		try {
			const resp = await fetch(`/api/watch/progress?title=${encodeURIComponent(baseTitle)}&type=tv&episodes=1`);
			if (resp.ok) {
				const data = await resp.json() as { season: number; episode: number; pct: number }[];
				for (const row of data) map.set(`${row.season}-${row.episode}`, row.pct);
			}
		} catch {}
		// Fill in episodes before the library entry's tracked position
		if (libLastSeason > 0 && libLastEpisode > 0) {
			for (const ep of episodes) {
				const key = `${ep.season}-${ep.episode}`;
				if (map.has(key)) continue;
				if (ep.season < libLastSeason || (ep.season === libLastSeason && ep.episode < libLastEpisode)) {
					map.set(key, 1.0);
				}
			}
		}
		watchedEpisodeMap = map;
	}

	/* --------------------------------------------------------------- episode list menu */

	let epMenu = $state<{ x: number; y: number; ep: Episode } | null>(null);

	/** The remote's Back with a menu open: that menu closes, and the episode stays (true). */
	function closeOpenMenu(): boolean {
		if (epMenu) epMenu = null;
		else if (showSettings || showCaptions || showDelay || showAudioPicker || showFilePicker) {
			showSettings = showCaptions = showDelay = showAudioPicker = showFilePicker = false;
		} else if (castOpen) castOpen = false;
		else return false;
		// The highlight was on something in the menu: back onto the player's buttons.
		tick().then(() => {
			const lost = !document.activeElement || document.activeElement === document.body;
			if (lost) document.querySelector<HTMLElement>('.ctrl-row .ctrl-btn')?.focus({ preventScroll: true });
		});
		return true;
	}

	function openEpMenu(e: MouseEvent, ep: Episode) {
		e.preventDefault();
		epMenu = { x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 200), ep };
	}

	/** What a greyed-out episode says: when it airs, or that no source has it. */
	function notAvailableText(ep: Episode): string {
		// Not aired yet, by the same rule the server lists episodes by (hasAired: from 06:00 UTC the
		// day after its US air date), so an episode airing tonight says when.
		if (ep.airDate && Date.now() < Date.parse(`${ep.airDate}T00:00:00Z`) + 30 * 60 * 60 * 1000) {
			const day = new Date(`${ep.airDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
			return `Airs ${day}`;
		}
		return 'Not available yet';
	}

	/** Ticks episodes on or off by hand. Shown straight away, saved behind. */
	async function markEps(list: Episode[], watched: boolean) {
		epMenu = null;
		if (!videoTitle || list.length === 0) return;
		const map = new Map(watchedEpisodeMap);
		for (const ep of list) map.set(`${ep.season}-${ep.episode}`, watched ? 1 : 0);
		watchedEpisodeMap = map;
		await fetch('/api/watch/progress', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: videoTitle.replace(/ S\d+E\d+$/, ''),
				episodes: list.map((ep) => ({ season: ep.season, episode: ep.episode })),
				watched
			})
		});
		if (!watched) return;
		// The furthest one ticked: the library's "reached" moves up to it (as Autosync does when
		// playing), and if nothing after it can be played the show is caught up.
		const furthest = list.filter((ep) => ep.season > 0).reduce<Episode | null>((best, ep) => (!best || ep.season > best.season || (ep.season === best.season && ep.episode > best.episode) ? ep : best), null);
		if (!furthest) return;
		noteCaughtUp(furthest);
		const ahead = furthest.season > libLastSeason || (furthest.season === libLastSeason && furthest.episode > libLastEpisode);
		if (libraryEntryId && ahead) {
			libLastSeason = furthest.season;
			libLastEpisode = furthest.episode;
			fetch('/api/entries', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: libraryEntryId, action: 'update_progress', season: furthest.season, episode: furthest.episode })
			}).catch(() => {});
		}
	}

	/** This one and every episode before it, earlier seasons included. */
	function upTo(ep: Episode): Episode[] {
		const at = episodes.indexOf(ep);
		return at === -1 ? [ep] : episodes.slice(0, at + 1);
	}

	/** The next episode that can be played. The show's last episode doesn't run on into its specials. */
	function nextEpisode(): Episode | null {
		if (!activeEpisode) return null;
		const current = activeEpisode;
		const idx = episodes.findIndex(ep => ep.season === current.season && ep.episode === current.episode);
		if (idx < 0) return null;
		const next = episodes.slice(idx + 1).find(playable) ?? null;
		if (next && next.season === 0 && current.season !== 0) return null;
		return next;
	}

	/** The playable episode before this one (specials aside, unless this is one). */
	function previousEpisode(): Episode | null {
		if (!activeEpisode) return null;
		const current = activeEpisode;
		const idx = episodes.findIndex(ep => ep.season === current.season && ep.episode === current.episode);
		if (idx <= 0) return null;
		const before = episodes.slice(0, idx).reverse().find(playable) ?? null;
		if (before && before.season === 0 && current.season !== 0) return null;
		return before;
	}

	async function addToLibraryQuick() {
		if (addingToLibrary || libraryEntryId) return;
		addingToLibrary = true;
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		try {
			const resp = await fetch('/api/watch/add-to-library', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: baseTitle, type: showType })
			});
			if (!resp.ok) return;
			const data = await resp.json();
			if (data.id) libraryEntryId = data.id;
		} catch {} finally {
			addingToLibrary = false;
		}
	}

	async function markEntryWatched() {
		if (!libraryEntryId) return;
		try {
			await fetch('/api/entries', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: libraryEntryId, action: 'complete' })
			});
			libraryEntryStatus = 'completed';
		} catch {}
	}

	function toggleAutoplay() {
		autoplayNext = !autoplayNext;
		try { localStorage.setItem(AUTOPLAY_KEY, autoplayNext ? '1' : '0'); } catch {}
	}

	/**
	 * Auto-skip: intros and end credits are skipped without pressing anything. Credits that run to
	 * the end go straight to the next episode (or past them, when there's a scene after). Each is
	 * skipped once per episode, so going back into an intro on purpose lets it play. Only
	 * shows with known intro times (anime) have anything to skip.
	 */
	let autoSkip = $state(false);
	const autoSkipped = new Set<string>();

	/**
	 * Whether the story carries on during an intro or ending: a database says so (`mixed`), or the
	 * subtitles have people talking in it (three lines or more, not counting the song's words, signs
	 * or sounds in brackets). Re:Zero S2E16's ending song plays over the episode's last scene, and
	 * auto-skip jumped straight to the next episode. Such a part is never skipped by itself, and the
	 * TV doesn't start the next episode partway into it.
	 */
	function storyDuring(seg: SkipSegment): boolean {
		if (seg.mixed) return true;
		if (seg.type === 'recap' || !subtitleCues.length) return false;
		const from = subTimeAt(seg.start + 3);
		const to = subTimeAt(seg.end - 3);
		let talking = 0;
		for (const cue of subtitleCues) {
			if (cue.song || cue.start < from || cue.start > to) continue;
			const words = plainSubText(cue.text).trim();
			if (!words || /♪|♫|^#|#$/.test(words) || /^[([][^)\]]*[)\]]$/s.test(words)) continue;
			if (++talking >= 3) return true;
		}
		return false;
	}

	function toggleAutoSkip() {
		autoSkip = !autoSkip;
		try { localStorage.setItem(AUTOSKIP_KEY, autoSkip ? '1' : '0'); } catch {}
	}

	function autoSkipCheck() {
		if (!autoSkip || !videoEl || videoEl.paused || seeking || isVideoSeeking || switchingEpisode || loadingEpisode) return;
		const seg = skipSegments.find(
			(s) => (s.type === 'intro' || s.type === 'credits') && currentTime >= s.start && currentTime < s.end - 1
		);
		if (!seg) return;
		const key = `${skipLookupKey}|${seg.type}|${seg.start}`;
		if (autoSkipped.has(key)) return;
		autoSkipped.add(key);
		// Story over the song: watched, not skipped (the Skip button is still there).
		if (storyDuring(seg)) return;
		const next = nextEpisode();
		if (seg.type === 'credits' && seg.end >= duration - 20 && next && playable(next)) {
			showQualityToast('Skipped the credits');
			playEpisode(next);
			return;
		}
		showQualityToast(seg.type === 'intro' ? 'Skipped the intro' : 'Skipped the credits');
		skipSegment(seg);
	}

	/*
	 * Autosync keeps the library up to date as you watch a show:
	 *   - a minute into an episode, a show not in the library is added as watching, and the
	 *     entry's episode reached moves forward to this one (never back);
	 *   - finishing the show's last episode (no later one listed, not even one still to air)
	 *     marks it completed.
	 */
	let autosync = $state(true);
	let autosyncedKey = '';
	let autosyncedEnd = '';

	function toggleAutosync() {
		autosync = !autosync;
		try { localStorage.setItem('catalog-autosync', autosync ? '1' : '0'); } catch {}
		if (autosync && currentTime >= 60) autosyncEpisode();
	}

	async function autosyncEpisode() {
		const ep = activeEpisode;
		if (!autosync || !ep || ep.season < 1 || showType !== 'tv') return;
		const key = `${videoTitle}:${ep.season}-${ep.episode}`;
		if (key === autosyncedKey) return;
		autosyncedKey = key;
		if (!libraryEntryId) {
			try {
				const resp = await fetch('/api/watch/add-to-library', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: videoTitle.replace(/ S\d+E\d+$/, ''),
						type: 'tv',
						watching: true,
						season: ep.season,
						episode: ep.episode
					})
				});
				const data = resp.ok ? await resp.json() : null;
				if (!data?.id) return;
				libraryEntryId = data.id;
				libraryEntryStatus = data.already ? libraryEntryStatus : 'watching';
				if (!data.already) {
					libLastSeason = ep.season;
					libLastEpisode = ep.episode;
					return;
				}
			} catch {
				return;
			}
		}
		const ahead = ep.season > libLastSeason || (ep.season === libLastSeason && ep.episode > libLastEpisode);
		if (!ahead) return;
		libLastSeason = ep.season;
		libLastEpisode = ep.episode;
		await syncProgressToEntry();
	}

	/** Near the end of the show's very last episode: completed. */
	async function autosyncFinished() {
		const ep = activeEpisode;
		// A film in the Specials tab ("Memory Snow · Movie"): the film itself is marked completed.
		if (autosync && ep && ep.season === 0 && showType === 'tv' && / · Movie$/.test(ep.name ?? '')) {
			const key = `${videoTitle}:film-${ep.episode}`;
			const ref = ep.files.find((f) => f.source === 'Aniwave')?.shareKey;
			if (key === autosyncedEnd || !ref) return;
			autosyncedEnd = key;
			fetch('/api/watch/finish-film', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: videoTitle.replace(/ S\d+E\d+$/, ''), year: lastResolveArgs?.year ?? '', ref })
			}).catch(() => {});
			return;
		}
		if (!autosync || !ep || ep.season < 1 || showType !== 'tv' || libraryEntryStatus === 'completed') return;
		const key = `${videoTitle}:${ep.season}-${ep.episode}`;
		if (key === autosyncedEnd) return;
		const later = episodes.some((e) => e.season > ep.season || (e.season === ep.season && e.episode > ep.episode));
		if (later) return;
		autosyncedEnd = key;
		await autosyncEpisode();
		await markEntryWatched();
	}

	/**
	 * Near the end of an episode with nothing after it to play (the newest one out, or the show's
	 * last): caught up. The show leaves Continue Watching and comes back marked new when a later
	 * episode can be played (src/lib/server/newEpisodes.ts). Not while the list is short of
	 * Showbox's files, when "nothing after it" may not be so.
	 */
	let caughtUpKey = '';
	function noteCaughtUp(ep: Episode | null = activeEpisode) {
		if (!ep || ep.season < 1 || showType !== 'tv' || !episodeListWhole) return;
		const key = `${videoTitle}:${ep.season}-${ep.episode}`;
		if (key === caughtUpKey) return;
		const idx = episodes.findIndex((e) => e.season === ep.season && e.episode === ep.episode);
		if (idx < 0 || episodes.slice(idx + 1).some((e) => e.season > 0 && playable(e))) return;
		caughtUpKey = key;
		const title = videoTitle.replace(/ S\d+E\d+$/, '');
		fetch('/api/watch/caught-up', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, year: lastResolveArgs?.title === title ? lastResolveArgs.year : '', season: ep.season, episode: ep.episode })
		}).catch(() => {});
	}
	/** False while Showbox's files are missing from the episode list (Febbox refused just then). */
	let episodeListWhole = true;

	/**
	 * A film watched to the end (the last twentieth, or into the credits) is marked completed,
	 * as a show is when its last episode ends: in the library, or added to it as completed if it
	 * isn't there yet (someone else's profile on the TV: their own list). Only with Autosync on,
	 * and only when most of it (70%) has actually played, so skipping to the end doesn't count.
	 */
	let filmMarked = '';
	async function filmFinished() {
		if (showType === 'movie' && duration > 600 && currentTime >= duration * 0.95) finishedDownload();
		if (!autosync || showType !== 'movie' || duration < 600 || filmMarked === videoTitle) return;
		if (playedSeconds < duration * 0.7) return;
		filmMarked = videoTitle;
		if (libraryEntryStatus === 'completed') return;
		if (!libraryEntryId) {
			try {
				const resp = await fetch('/api/watch/add-to-library', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: videoTitle, type: 'movie' })
				});
				const data = await resp.json();
				if (!data.id) return;
				libraryEntryId = data.id;
				// Added just now as completed; already there, it's marked so below.
				if (!data.already) {
					libraryEntryStatus = 'completed';
					return;
				}
			} catch {
				return;
			}
		}
		await markEntryWatched();
	}

	async function syncProgressToEntry() {
		if (!libraryEntryId || !activeEpisode) return;
		try {
			await fetch('/api/entries', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: libraryEntryId,
					action: 'update_progress',
					season: activeEpisode.season,
					episode: activeEpisode.episode
				})
			});
		} catch {}
	}

	/* --------------------------------------------------------------- febbox subtitles */

	let subsKey = '';
	let subsInFlight = false;
	/** Whether the last lookup was for the English dub. */
	let subsForDub = false;
	/** The subtitles showing went on by themselves (not picked), so a change to the dub can take them off. */
	let subsAuto = false;
	/** Every subtitle file listed, not just the first five of each language. */
	let allSubsShown = $state(false);

	/*
	 * Captions turned off for a show stay off for it on this device: they don't come back on
	 * by themselves for the next episode (anime on the TV turns them on otherwise).
	 */
	const captionsOffKey = () => `catalog:captionsOff:${(lastResolveArgs?.title ?? '').toLowerCase()}`;
	function captionsOffForShow(): boolean {
		try {
			return localStorage.getItem(captionsOffKey()) === '1';
		} catch {
			return false;
		}
	}
	function keepCaptionsOff(off: boolean) {
		try {
			if (off) localStorage.setItem(captionsOffKey(), '1');
			else localStorage.removeItem(captionsOffKey());
		} catch {}
	}

	/**
	 * A Showbox file's English audio track is only known once the video has loaded, after the
	 * subtitles were looked up: on a switch to or from the dub they're looked up again, and ones
	 * that went on by themselves for Japanese audio come off.
	 */
	function recheckSubsForAudio() {
		if (!videoTitle || hearingDub() === subsForDub) return;
		// (On the TV they're picked again for the new audio instead.)
		if (subsAuto && (hearingDub() || tvMode)) {
			subtitlesOn = false;
			subsAuto = false;
		}
		fetchSubtitles();
	}

	/**
	 * The English dub or not: another source says (Aniwave), otherwise the audio track playing
	 * does — but only for anime. An English film's English audio isn't a dub: taking it for one
	 * left Madagascar 2's subtitles off when it was resumed (only captions come back over a dub).
	 */
	function hearingDub(): boolean {
		if (activeFile?.audio) return /^(english|eng)\b/i.test(activeFile.audio);
		if (!isAnime) return false;
		// Before a Showbox video has loaded its audio tracks, the one picked last time (it's put back on).
		const track = hlsAudioTracks.find((t) => t.id === hlsActiveAudio)?.name ?? (activeFile?.source ? '' : preferredAudioName);
		return /^(english|eng)\b/i.test(track ?? '');
	}

	async function fetchSubtitles(autoMatch?: { fileName: string; language: string; delay: number }) {
		if (sportsMode) return;
		if (!videoTitle) return;
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const ep = showType === 'tv' ? activeEpisode : null;
		const dub = hearingDub();
		subsForDub = dub;
		const share = activeFile?.source ? shareOf(activeFile) : '';
		const key = `${baseTitle}:${showType}:${ep?.season ?? 0}:${ep?.episode ?? 0}:${dub ? 'dub' : ''}:${share}`;
		// Two overlapping lookups used to race, and a throttled empty answer could wipe a good list.
		if (key === subsKey && !autoMatch && (subsInFlight || febboxSubs.length > 0)) return;
		subsKey = key;
		subsInFlight = true;
		loadingSubs = true;
		let list: SubOption[] = [];
		try {
			const params = new URLSearchParams({ title: baseTitle, type: showType });
			if (ep) {
				params.set('season', String(ep.season));
				params.set('episode', String(ep.episode));
			}
			if (lastResolveArgs?.year) params.set('year', lastResolveArgs.year);
			if (dub) params.set('audio', 'dub');
			if (share) params.set('share', share);
			// Which Aniwave episode this is, so other sources line up even when Showbox numbers
			// the seasons its own way.
			const aniwaveRef = ep?.files.find((f) => f.source === 'Aniwave')?.shareKey;
			if (aniwaveRef) params.set('ref', aniwaveRef);
			const resp = await fetch(`/api/watch/subtitles?${params}`);
			if (resp.ok) list = await resp.json();
		} catch {}
		if (key !== subsKey) return;
		subsInFlight = false;
		febboxSubs = byCut(list, duration);
		loadingSubs = false;

		if (autoMatch && febboxSubs.length > 0) {
			const stripEp = (n: string) => n.replace(/\.?S\d+\.?E\d+\.?/i, '.').replace(/\.?E\d+\.?/i, '.');
			const prevPattern = stripEp(autoMatch.fileName);
			// A file named for another episode is never the right pick, even in the right language.
			const otherEpisode = (n: string) => {
				const m = n.match(/S(\d{1,2})[ .]?E(\d{1,3})/i);
				return Boolean(ep && m && (+m[1] !== ep.season || +m[2] !== ep.episode));
			};
			const candidates = febboxSubs.filter((s) => !otherEpisode(s.fileName));
			const match = candidates.find(s => s.fileName === autoMatch.fileName)
				?? candidates.find(s => stripEp(s.fileName) === prevPattern)
				?? candidates.find(s => s.language === autoMatch.language && /S\d+[ .]?E\d+/i.test(s.fileName))
				?? candidates.find(s => s.language === autoMatch.language);
			if (match) {
				await loadSub(match);
				subtitleDelay = autoMatch.delay;
			}
		} else if (!autoMatch && !subtitlesOn && !activeFile?.burnedIn && !captionsOffForShow()) {
			// Anime in Japanese starts with subtitles on: the chosen one, or the next English
			// ones if it won't download. Not over subtitles already in the picture, nor for a
			// show they were turned off for.
			// On the TV, everything starts with captions on: English CC where there are some
			// (they cover sounds too), else English.
			const english = febboxSubs.filter((s) => !s.check && s.language === 'English');
			const pick =
				febboxSubs.find((s) => s.default) ??
				(tvMode ? (english.find((s) => /\bCC\b|SDH/i.test(s.fileName)) ?? english[0]) : undefined);
			if (pick) {
				const tries = [pick, ...febboxSubs.filter((s) => s !== pick && !s.check && s.language === 'English')].slice(0, 4);
				// Subtitles that run on well past the end of the video were timed for a longer copy
				// of it (Bleach's DVD ones on the TV version): they fall further behind as it plays,
				// so the next is tried, and the first one comes back if none fits.
				const fitsVideo = () => {
					const length = videoEl?.duration ?? NaN;
					const last = subtitleCues.reduce((most, cue) => Math.max(most, cue.end), 0);
					return !Number.isFinite(length) || last <= length + 8;
				};
				const video = videoEl;
				if (video && !Number.isFinite(video.duration)) {
					await new Promise<void>((resolve) => {
						video.addEventListener('durationchange', () => resolve(), { once: true });
						setTimeout(resolve, 8000);
					});
				}
				let tooLong: SubOption | null = null;
				for (const sub of tries) {
					if (key !== subsKey || (subtitlesOn && !tooLong)) break;
					if (!(await loadSub(sub))) continue;
					subsAuto = true;
					if (fitsVideo()) {
						tooLong = null;
						break;
					}
					tooLong ??= sub;
				}
				if (tooLong && key === subsKey && subsAuto && activeSubUrl !== tooLong.url && (await loadSub(tooLong))) subsAuto = true;
			}
		}
	}

	let nexusChecking = $state(false);

	/**
	 * anime.nexus wants its human check before handing over its subtitles: its page opens in a
	 * window for that and closes by itself, then its subtitles join the list and the right one
	 * goes on (English CC on the dub, English otherwise).
	 */
	async function passNexusCheck() {
		const ep = activeEpisode;
		if (nexusChecking || !ep) return;
		nexusChecking = true;
		try {
			const resp = await fetch('/api/watch/nexus-check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: videoTitle.replace(/ S\d+E\d+$/, ''),
					year: lastResolveArgs?.year ?? '',
					season: ep.season,
					episode: ep.episode,
					ref: ep.files.find((f) => f.source === 'Aniwave')?.shareKey
				})
			});
			const data = await resp.json();
			if (!data.ok || ep !== activeEpisode) return;
			subsKey = '';
			febboxSubs = [];
			await fetchSubtitles();
			const wanted = hearingDub() ? 'English CC' : 'English';
			const pick = febboxSubs.find((s) => s.source === 'anime.nexus' && s.fileName === wanted);
			if (pick) await loadSub(pick);
		} catch {
		} finally {
			nexusChecking = false;
		}
	}

	/**
	 * Auto-timing heard that the subtitles that went on by themselves don't fit this video
	 * (another episode's, another cut's): the other English ones are tried against the talking
	 * it has already heard, and the one that fits best goes on instead. Ones picked by hand stay.
	 */
	async function switchToFittingSubs() {
		const sync = subSync;
		const key = subsKey;
		if (!sync || !subsAuto) {
			showQualityToast("These subtitles don't match this video");
			return;
		}
		if (fitTriedFor !== key) {
			fitTried = new Set();
			fitTriedFor = key;
		}
		fitTried.add(activeSubUrl);
		const others = febboxSubs.filter((s) => !s.check && s.language === 'English' && !fitTried.has(s.url)).slice(0, 8);
		for (const sub of others) fitTried.add(sub.url);
		const downloaded = await Promise.all(others.map(async (sub) => ({ sub, cues: await downloadSub(sub) })));
		const usable = downloaded.filter((d): d is { sub: SubOption; cues: Cue[] } => Boolean(d.cues?.length));
		const index = usable.length ? await sync.bestOf(usable.map((d) => d.cues)) : -1;
		// Meanwhile another episode came on, or subtitles were picked by hand.
		if (key !== subsKey || !subsAuto || sync !== subSync) return;
		if (index < 0) {
			showQualityToast("These subtitles don't match this video");
			return;
		}
		sync.useChoice(index);
		showSub(usable[index].sub, usable[index].cues);
		subsAuto = true;
		showQualityToast('Switched to subtitles that match this video');
	}
	/** The subtitles already tried by `switchToFittingSubs` (their addresses), for `fitTriedFor`. */
	let fitTried = new Set<string>();
	let fitTriedFor = '';

	/** Downloads and shows a subtitle. False if it couldn't be had (the ones showing stay). */
	async function loadSub(sub: SubOption): Promise<boolean> {
		showCaptions = false;
		const cues = await downloadSub(sub);
		if (!cues) return false;
		subsAuto = false;
		showSub(sub, cues);
		return true;
	}

	function showSub(sub: SubOption, cues: Cue[]) {
		subtitleCues = cues;
		subtitlesOn = true;
		activeSubFid = sub.id;
		activeSubUrl = sub.url;
		activeSubFileName = sub.fileName || sub.language;
	}

	/** A subtitle's lines, or null if it couldn't be had. */
	async function downloadSub(sub: SubOption): Promise<Cue[] | null> {
		try {
			// The show's name lets the file be kept on this PC while you're watching it.
			const params = new URLSearchParams({ url: sub.url, show: videoTitle.replace(/ S\d+E\d+$/, '') });
			// Season packs are a zip of every episode; this says which one to take.
			if (showType === 'tv' && activeEpisode) {
				params.set('season', String(activeEpisode.season));
				params.set('episode', String(activeEpisode.episode));
			}
			const resp = await fetch(`/api/watch/subtitle-content?${params}`);
			if (!resp.ok) return null;
			const data = await resp.json();
			// No lines in it at all counts as not had (so the next one is tried).
			const cues = data.content ? parseSrt(data.content) : [];
			if (cues.length) return cues;
		} catch {}
		return null;
	}

	/* --------------------------------------------------------------- episode names */

	async function loadEpisodeNames(title: string, season: number) {
		// How many episodes come before this season, and how many it has: TMDB may number the
		// show as one long season (Re:Zero), and these find this season's stretch of it.
		const lastOf = (n: number) => Math.max(0, ...untrack(() => episodes).filter((e) => e.season === n).map((e) => e.episode));
		let before = 0;
		for (let n = 1; n < season; n++) before += lastOf(n);
		const params = new URLSearchParams({ title, season: String(season), before: String(before), count: String(lastOf(season)) });
		try {
			const resp = await fetch(`/api/watch/episode-names?${params}`);
			if (resp.ok) episodeNames = await resp.json();
		} catch {}
	}

	let lastCastKey = '';

	async function loadCast(title: string, type: 'movie' | 'tv', season = 0, episode = 0) {
		if (sportsMode) return;
		const key = `${title}:${season}:${episode}`;
		// Once per episode, even when the answer is empty — re-asking on empty looped forever.
		if (key === lastCastKey) return;
		lastCastKey = key;
		loadingCast = true;
		try {
			let url = `/api/watch/cast?title=${encodeURIComponent(title)}&type=${type}`;
			if (type === 'tv' && season > 0 && episode > 0) url += `&season=${season}&episode=${episode}`;
			const resp = await fetch(url);
			if (resp.ok && key === lastCastKey) castMembers = await resp.json();
		} catch {}
		if (key === lastCastKey) loadingCast = false;
	}

	/** Japanese original and animated (TMDB, via /api/watch/is-anime): starts in Japanese. */
	let isAnime = false;
	/** Settles once it's known whether this is anime (asked as each title opens). */
	let animeKnown: Promise<boolean> = Promise.resolve(false);
	const isJapaneseTrack = (t: { lang?: string; name?: string }) => /^ja/i.test(t.lang ?? '') || /\b(jpn|japanese)\b/i.test(t.name ?? '');
	const isEnglishTrack = (t: { lang?: string; name?: string }) => /^en/i.test(t.lang ?? '') || /\b(eng|english)\b/i.test(t.name ?? '');

	function applyPreferredAudio() {
		if (!hlsInstance || hlsInstance.audioTracks.length < 2) return;
		const tracks = hlsInstance.audioTracks;
		let match = preferredAudioName
			? tracks.findIndex((t) => (t.name || t.lang || '').toLowerCase() === preferredAudioName.toLowerCase())
			: -1;
		// Nothing picked yet, on an anime (Japanese original, not a film with a Japanese dub): the
		// audio last picked for anime, which is Japanese unless the dub was — not the file's own
		// default, which for Bleach's dual-audio copies is the dub.
		if (match < 0 && isAnime && tracks.some(isJapaneseTrack)) {
			match = tracks.findIndex(animeAudio() === 'English' ? isEnglishTrack : isJapaneseTrack);
		}
		if (match >= 0 && match !== hlsInstance.audioTrack) {
			hlsInstance.audioTrack = match;
			hlsActiveAudio = match;
		}
	}

	/*
	 * One click to watch a game (liveChannelPicks.ts): whether this channel played a minute, or
	 * wouldn't play, or was left for another within the minute. Leaving Live TV doesn't count.
	 */
	let liveVerdict: { channel: number; from: number; told: boolean } | null = null;
	function tellChannel(ok: boolean) {
		const verdict = liveVerdict;
		if (!liveMode || !verdict || verdict.told) return;
		verdict.told = true;
		fetch('/api/live/watched', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: verdict.channel, ok, league: liveGame?.league ?? '', sport: liveGame?.sport ?? '' }),
			keepalive: true
		}).catch(() => {});
	}

	/** Live: the channel's playlist, at one address while the token behind it changes. */
	function startLive() {
		// Another channel picked within the minute: this one counts against.
		tellChannel(false);
		liveVerdict = { channel: liveNow.id, from: Infinity, told: false };
		loading = false;
		liveCaptions = false;
		liveCues = [];
		subtitleCues = [];
		subtitlesOn = false;
		activeSubFileName = '';
		videoTitle = liveGame?.title ?? (liveNow.name || `Channel ${liveNow.id}`);
		streamUrl = `/api/live/playlist?ch=${liveNow.id}`;
	}

	/** The game it was opened for (its other channels), and whether that or the channel is saved. */
	async function loadLiveGame() {
		const id = page.url.searchParams.get('game');
		const [found, kept] = await Promise.all([
			id ? fetch(`/api/live/game?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null) : null,
			fetch('/api/live/saved').then((r) => r.json()).catch(() => null)
		]);
		liveGame = found?.game ?? null;
		if (liveGame) videoTitle = liveGame.title;
		liveSaved = liveGame ? Boolean(kept?.games?.includes(liveGame.id)) : Boolean(kept?.channels?.includes(liveNow.id));
	}

	/**
	 * A replay: its versions, and the address of one (`version`; null: the first that plays —
	 * a game only hours old may not have its first one ready).
	 */
	async function startReplay(version: number | null) {
		showFilePicker = false;
		problem = '';
		videoTitle = videoTitle || page.url.searchParams.get('name') || 'Replay';
		const params = new URLSearchParams({ id: page.url.searchParams.get('replay') ?? '' });
		if (version !== null) params.set('v', String(version));
		// Loading until its address is known (the search page showed meanwhile).
		if (!streamUrl) loading = true;
		const answer = await fetch(`/api/live/replay?${params}`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		loading = false;
		if (!answer) {
			problem = "This replay can't be found right now.";
			return;
		}
		if (answer.replay?.title) videoTitle = answer.replay.title;
		replayPoster = answer.replay?.poster ?? '';
		replayVersions = answer.versions ?? [];
		if (answer.error || !answer.url) {
			problem = answer.error ?? "This replay can't be played right now.";
			return;
		}
		replayVersion = answer.v ?? 0;
		// Only a condensed game so far (the whole one isn't ready): said, not passed off as the game.
		if (answer.condensed) showQualityToast(`The full game isn't ready yet: this is a ${answer.condensed}-minute condensed version.`);
		liveRestarts = 0;
		streamUrl = answer.url;
		// Watched lately (Live TV, Continue Watching), with what's needed to show and open it again.
		fetch('/api/live/watched', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ replay: page.url.searchParams.get('replay'), title: videoTitle, poster: replayPoster || null, sport: answer.replay?.sport ?? 'other' })
		}).catch(() => {});
	}

	/** Where a replay was left (its place kept as type "replay"), unless it was watched to the end. */
	async function replayPlace(): Promise<SavedPlace | null> {
		const kept = await fetch(`/api/watch/progress?title=${encodeURIComponent(videoTitle)}&type=replay&season=0&episode=0`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (!kept || !(kept.duration > 0) || kept.currentTime < 5 || kept.currentTime / kept.duration >= 0.95) return null;
		return { at: kept.currentTime };
	}

	/** Another channel showing the game: played here, the address following along. */
	function switchLiveChannel(channel: { id: number; name: string }) {
		showFilePicker = false;
		if (channel.id === liveNow.id) return;
		liveNow = { id: channel.id, name: channel.name };
		const params = new URLSearchParams(page.url.search);
		params.set('live', String(channel.id));
		params.set('name', channel.name);
		replaceState(`/watch?${params}`, {});
		liveNoted = false;
		liveRestarts = 0;
		problem = '';
		startLive();
	}

	function toggleLiveSaved() {
		liveSaved = !liveSaved;
		if (liveGame) sendSaved({ kind: 'game', game: liveGame }, liveSaved);
		else sendSaved({ kind: 'channel', id: liveNow.id, name: liveNow.name }, liveSaved);
	}

	/** Back to the live edge, after a pause or a jump back. */
	function goLive() {
		const at = hlsInstance?.liveSyncPosition;
		if (videoEl && at) videoEl.currentTime = at;
		userPaused = false;
		videoEl?.play().catch(() => {});
	}

	/** Captions the channel carries, as hls.js reads them out of the video: kept for the last few minutes. */
	function addLiveCues(cues: { startTime: number; endTime: number; text: string }[]) {
		for (const cue of cues) {
			const text = cue.text.trim();
			if (text) liveCues.push({ start: cue.startTime, end: cue.endTime, text, top: false });
		}
		const now = videoEl?.currentTime ?? 0;
		liveCues = liveCues.filter((c) => c.end > now - 300);
		subtitleCues = liveCues.slice();
		if (!liveCaptions && liveCues.length) {
			try {
				subtitleDelay = Number(localStorage.getItem(LIVE_CAPTION_DELAY)) || 0;
			} catch {}
			liveCaptions = true;
			activeSubFileName = 'Captions from the channel';
			// On a TV captions start on, as everything does there.
			if (tvMode && !captionsOffForShow()) subtitlesOn = true;
		}
	}

	function goBack() {
		if (isAuto) {
			history.back();
		} else if (sportsMode) {
			// Live and replays came from Live TV, not from the search (which Back used to open).
			if (cameFromApp) history.back();
			else goto('/live');
		} else {
			backToSearch();
		}
	}

	/* --------------------------------------------------------------- webview extraction */

	let webviewEl: HTMLElement | undefined = $state();
	let webviewReady = $state(false);
	let extracting = $state(false);

	async function extractVideoFromWebview(wv: any, fid: number, sk: string) {
		extracting = true;
		try {
			const html: string = await Promise.race([
				wv.executeJavaScript(`
					new Promise(function(resolve) {
						var attempts = 0;
						function tryFetch() {
							attempts++;
							if (attempts > 30) { resolve(''); return; }
							if (typeof $ === 'undefined' || typeof $.ajax === 'undefined') {
								setTimeout(tryFetch, 500);
								return;
							}
							$.ajax({
								type: 'POST',
								url: '/file/player',
								data: { fid: ${fid}, share_key: '${sk}' },
								dataType: 'text',
								success: function(d) { resolve(d); },
								error: function() { resolve(''); }
							});
						}
						tryFetch();
					});
				`),
				new Promise<string>(r => setTimeout(() => r(''), 20000))
			]);

			if (!html) {
				problem = 'Could not load video — try logging in again in Settings → Services.';
				extracting = false;
				return;
			}

			try {
				const d = JSON.parse(html);
				if (d.code < 0) {
					problem = 'Session expired — try logging in again.';
					extracting = false;
					return;
				}
			} catch {}

			const m =
				html.match(/<source[^>]+src=["']([^"']+)["']/i) ||
				html.match(/file:\s*["']([^"']+)/i) ||
				html.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i) ||
				html.match(/(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i);

			if (m) {
				streamUrl = m[1];
				useIframe = false;
			} else {
				problem = 'Video found but could not extract stream URL.';
				debugInfo = html.slice(0, 500);
			}
		} catch {
			problem = 'Failed to extract video URL.';
		}
		extracting = false;
	}

	/* --------------------------------------------------------------- effects */

	$effect(() => {
		if (useIframe && webviewEl && iframeFid && !webviewReady) {
			webviewReady = true;
			const wv = webviewEl as any;
			let started = false;
			wv.addEventListener('dom-ready', () => {
				started = true;
				extractVideoFromWebview(wv, iframeFid, shareKey);
			});
			setTimeout(() => {
				if (!started && useIframe && !problem) {
					problem = 'Could not load video — try logging in again in Settings → Services.';
					extracting = false;
				}
			}, 25000);
		}
	});

	$effect(() => {
		if (!videoEl || !streamUrl) return;
		void streamNonce;
		clearStallWatch();

		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
		hlsLevels = [];
		hlsActiveLevel = -1;
		videoResolution = '';

		currentTime = 0;
		duration = 0;
		bufferedEnd = 0;
		playing = false;
		// A fresh link fetched while paused stays paused.
		const stayPaused = loadPaused;
		loadPaused = false;
		videoEl.autoplay = !stayPaused;
		videoEl.pause();
		videoEl.removeAttribute('src');
		videoEl.removeAttribute('crossorigin');
		soundBlocked = false;
		videoEl.load();

		if (isPlaylist(streamUrl) && Hls.isSupported()) {
			// Where to start: the place a reload or a change of file was at, else where it was left
			// (asked for now, alongside the playlist). Nothing loads until it's known, so the first
			// piece fetched is the one at that place, in the quality that will play — before, the
			// start was fetched, then fetched again in another quality, then the place itself.
			const reloadAt = seekAfterLoad;
			seekAfterLoad = 0;
			// (untrack: what it reads mustn't make this effect run again and reload the video.)
			const placeSoon: Promise<SavedPlace | null> = liveMode
				? Promise.resolve(null)
				: reloadAt > 0
					? Promise.resolve({ at: reloadAt })
					: replayMode
						? untrack(() => replayPlace())
						: untrack(() => savedPlace());
			// (Its pieces come a couple ahead: src/lib/fetchAhead.ts says why.)
			let player: Hls | null = null;
			const hls = new Hls({
				// (Live: its pieces are fetched as they appear, not ahead.)
				...(liveMode ? {} : { fLoader: fetchAheadLoader(() => player) }),
				autoStartLoad: false,
				// Catalog draws its own subtitles: none of the browser's, from captions some videos
				// carry inside them or a subtitle track their playlist lists. Live: the captions a
				// channel carries are read, and drawn by Catalog like any subtitles (addLiveCues).
				enableCEA708Captions: sportsMode,
				renderTextTracksNatively: false,
				// Live: finding a channel's stream can take the computer half a minute.
				...(liveMode
					? { manifestLoadPolicy: { default: { maxTimeToFirstByteMs: 40_000, maxLoadTimeMs: 60_000, timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 2, retryDelayMs: 2000, maxRetryDelayMs: 4000 } } } }
					: {}),
				enableWebVTT: false,
				enableIMSC1: false,
				maxBufferLength: 300,
				maxMaxBufferLength: 600,
				maxBufferHole: 0.5,
				highBufferWatchdogPeriod: 2,
				nudgeMaxRetry: 5,
				liveSyncDurationCount: 3,
				enableWorker: true,
				startFragPrefetch: true,
				backBufferLength: 90,
				// A piece with no answer after 5 s is asked for again (a busy server leaves one
				// hanging now and then); a slow one that is arriving is never cut off.
				fragLoadPolicy: {
					default: {
						maxTimeToFirstByteMs: 5000,
						maxLoadTimeMs: 120_000,
						timeoutRetry: { maxNumRetry: 6, retryDelayMs: 0, maxRetryDelayMs: 0 },
						errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
					}
				},
				abrEwmaDefaultEstimate: 50_000_000,
				xhrSetup: (xhr: XMLHttpRequest) => {
					xhr.addEventListener('progress', markBytes);
					try { xhr.setRequestHeader('Referer', 'https://www.febbox.com/'); } catch {}
				}
			});
			hls.subtitleDisplay = false;
			appendedSound = [];
			trackRanges = {};
			holesSeen.clear();
			seamsMended.clear();
			// A stop under way ends with the video it was in.
			stopEnded('left');
			piecesAsked.clear();
			frameMarks = [];
			hls.on(Hls.Events.FRAG_LOADING, (_e, data) => pieceAsked(data.frag));
			hls.on(Hls.Events.FRAG_LOADED, (_e, data) => pieceArrived(data.frag));
			hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => notePlayerEvent('sound track changed'));
			hls.on(Hls.Events.BUFFER_APPENDED, (_e, data) => {
				trackRanges = { ...trackRanges, ...data.timeRanges };
				if (data.type === 'video') mendPictureSeam(hls, data.timeRanges.video, data.frag.end);
			});
			// (untrack: reading the copy here made this effect run again the moment another episode
			// was picked, replaying the one before from its start under "Loading episode…".)
			if (!sportsMode) untrack(() => hearDownloadsOf(activeFile));
			else hls.on(Hls.Events.CUES_PARSED, (_e, data) => addLiveCues(data.cues as { startTime: number; endTime: number; text: string }[]));
			hls.on(Hls.Events.BUFFER_APPENDING, (_e, data) => noteAppendedSound(data.type, data.data, data.frag ?? null));
			hls.loadSource(withPieces(streamUrl));
			hls.attachMedia(videoEl);
			hls.on(Hls.Events.FRAG_LOADED, markBytes);
			hls.on(Hls.Events.MANIFEST_PARSED, () => {
				hlsLevels = hls.levels.map((l, i) => ({
					index: i, height: l.height, bitrate: l.bitrate
				}));
				const lvlInfo = hls.levels.map((l: { height: number; codecSet?: string; videoCodec?: string }) =>
					`${l.height}p/${l.codecSet || l.videoCodec || '?'}`
				).join(', ');
				debugInfo = (debugInfo ? debugInfo + ' | ' : '') + `hls: ${hls.levels.length} lvl (${lvlInfo}), ${hls.subtitleTracks.length} sub tracks`;
				slowStops = [];
				slowOffer = null;
				slowOfferDeclined = false;
				if (hls.levels.length > 1) {
					const isH264 = (i: number) => /avc[13]/.test(hls.levels[i].codecSet || hls.levels[i].videoCodec || '');
					playableLevels = hls.levels.map((_, i) => i).filter(isH264);
					if (!playableLevels.length) playableLevels = hls.levels.map((_, i) => i);
					const best = playableLevels[playableLevels.length - 1];
					// Chosen before loading starts: no first piece in another quality to throw away.
					hls.startLevel = best;
					hls.loadLevel = best;
					hlsActiveLevel = best;
				} else {
					playableLevels = [];
					hlsActiveLevel = 0;
				}
				if (showboxHeldBack(hls.levels.map((l) => l.height))) return;
				videoEl?.addEventListener('loadedmetadata', checkLowQuality, { once: true });
				switchingEpisode = false;
				autoplayFired = false;
				if (!stayPaused) videoEl?.play().catch(() => {});
				hlsAudioTracks = hls.audioTracks.map((t, i) => ({
					id: i,
					name: t.name || t.lang || `Track ${i + 1}`,
					url: t.url ?? ''
				}));
				hlsActiveAudio = hls.audioTrack;
				applyPreferredAudio();
				recheckSubsForAudio();
				placeSoon.then((place) => {
					if (hlsInstance !== hls) return; // another video took its place meanwhile
					const at = place?.at ?? 0;
					hls.startLoad(at > 0 ? at : -1);
					if (at > 0 && videoEl) videoEl.currentTime = at;
					if (place) restoreSavedSubs(place);
				});
			});
			hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
				hlsAudioTracks = hls.audioTracks.map((t, i) => ({
					id: i,
					name: t.name || t.lang || `Track ${i + 1}`,
					url: t.url ?? ''
				}));
				hlsActiveAudio = hls.audioTrack;
				applyPreferredAudio();
				recheckSubsForAudio();
			});
			hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
				hlsActiveLevel = data.level;
				const height = hls.levels[data.level]?.height;
				notePlayerEvent(height ? `quality changed to ${height}p` : 'quality changed');
			});
			hls.on(Hls.Events.ERROR, (_e, data) => {
				const errDetail = `${data.type}/${data.details}` +
					((data as any).response?.code ? ` http=${(data as any).response.code}` : '') +
					((data as any).reason ? ` reason=${(data as any).reason}` : '') +
					(data.url ? ` url=${data.url.substring(0, 120)}` : '');
				if (!data.fatal) {
					notePlayerEvent(`player: ${PLAYER_WARNINGS[data.details] ?? data.details}`);
					if (data.details === 'bufferStalledError') {
						hls.startLoad(-1);
					}
					if (data.type === 'networkError' && (data.details === 'fragLoadError' || data.details === 'fragLoadTimeOut')) {
						if ((data as any).response?.code === 403 || (data as any).response?.code === 410) {
							refreshStream();
						}
					}
					return;
				}
				debugInfo = (debugInfo ? debugInfo + ' | ' : '') + 'fatal: ' + errDetail;
				if (prevStreamUrl) {
					if (qualityTimer) { clearTimeout(qualityTimer); qualityTimer = null; }
					showQualityToast('That file could not be played. Try a different one.');
					const t = videoEl?.currentTime ?? 0;
					seekAfterLoad = t;
					streamUrl = prevStreamUrl;
					activeFileFid = prevFileFid;
					activeQuality = prevQuality;
					prevStreamUrl = '';
					return;
				}
				// A decode hiccup isn't fixed by a new link; hls.js can rebuild the decoder in place.
				if (data.type === Hls.ErrorTypes.MEDIA_ERROR && performance.now() - mediaRecoveredAt > 10_000) {
					mediaRecoveredAt = performance.now();
					notePlayerEvent('decoder rebuilt after an error');
					hls.recoverMediaError();
					return;
				}
				// Another source's copy has its own share key: a fresh link works for it too. (Checking
				// the show's Showbox key here left 7Movies with "fragLoadTimeOut" for good while
				// Showbox was down, though the video went on playing.)
				if (sportsMode) {
					refreshStream();
					return;
				}
				if (!activeFile?.fid || !shareOf(activeFile)) {
					problem = `Video failed to load (${data.details}).`;
					loadProblemAt = videoEl?.currentTime ?? 0;
					return;
				}
				refreshStream();
			});
			hlsInstance = hls;			player = hls;
		} else {
			// Another site's file is asked for with CORS, so its sound can go through the page's audio
			// (auto-timing listens there, and volume past 100% is made there). Without it the browser
			// hands the page silence, and silence is all that plays: Dungeon Meshi E8's Showbox file,
			// a plain MP4, had no sound at all (2026-10-23). A site that refuses CORS is asked again
			// without it, and its sound is left out of the page's audio (`soundBlocked`).
			const url = streamUrl;
			const crossSite = new URL(url, location.href).origin !== location.origin;
			if (crossSite) videoEl.crossOrigin = 'anonymous';
			videoEl.src = url;
			if (!stayPaused) videoEl.play().catch(() => {});
			hlsAudioTracks = [];
			if (crossSite) {
				videoEl.addEventListener('error', () => {
					if (!videoEl || videoEl.src !== url || videoEl.readyState > 0) return;
					soundBlocked = true;
					videoEl.removeAttribute('crossorigin');
					videoEl.src = url;
					if (!stayPaused) videoEl.play().catch(() => {});
				}, { once: true });
			}
			videoEl.addEventListener('loadedmetadata', () => {
				switchingEpisode = false;
				autoplayFired = false;
				// (Its length came just before, while still switching, so it wasn't taken then:
				// the bar read "0:07 / 0:00".)
				if (videoEl) duration = videoEl.duration;
				if (seekAfterLoad > 0) {
					const t = seekAfterLoad;
					seekAfterLoad = 0;
					if (videoEl) videoEl.currentTime = t;
				} else {
					loadAndResumeProgress();
				}
			}, { once: true });
		}

		watchForStall();
		startProgressSaving();
		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	$effect(() => {
		const onChange = () => {
			isFullscreen = !!document.fullscreenElement || !!(videoEl as any)?.webkitDisplayingFullscreen;
		};
		document.addEventListener('fullscreenchange', onChange);
		videoEl?.addEventListener('webkitbeginfullscreen', onChange);
		videoEl?.addEventListener('webkitendfullscreen', onChange);
		return () => {
			document.removeEventListener('fullscreenchange', onChange);
			videoEl?.removeEventListener('webkitbeginfullscreen', onChange);
			videoEl?.removeEventListener('webkitendfullscreen', onChange);
		};
	});

	$effect(() => {
		if (inPiP) return () => cleanupPiP();
	});

	// Another episode in the mini player: previous/next are for that one now.
	$effect(() => {
		void activeEpisode;
		void episodes;
		untrack(() => {
			if (pipVideo) setPiPActions(true);
		});
	});

	$effect(() => {
		if (!videoEl) return;
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		if (!isIOS) return;
		while (videoEl.textTracks.length > 0) {
			videoEl.textTracks[0].mode = 'disabled';
			const track = videoEl.querySelector('track');
			if (track) track.remove(); else break;
		}
		if (!subtitlesOn || subtitleCues.length === 0) return;
		const track = videoEl.addTextTrack('subtitles', 'Subtitles', 'en');
		track.mode = 'showing';
		for (const c of subtitleCues) {
			const rate = subAutoSync ? subtitleRate : 1;
			const cue = new VTTCue(c.start * rate + subtitleDelay, c.end * rate + subtitleDelay, plainSubText(c.text));
			if (c.top) cue.line = 0;
			track.addCue(cue);
		}
	});

	$effect(() => {
		if (!videoEl) { videoResolution = ''; return; }
		const update = () => {
			if (videoEl && videoEl.videoWidth > 0) videoResolution = `${videoEl.videoWidth}×${videoEl.videoHeight}`;
		};
		videoEl.addEventListener('loadeddata', update);
		videoEl.addEventListener('resize', update);
		update();
		return () => {
			videoEl?.removeEventListener('loadeddata', update);
			videoEl?.removeEventListener('resize', update);
		};
	});

	$effect(() => {
		if (!playing) {
			showControls = true;
			if (controlsTimer) clearTimeout(controlsTimer);
		}
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
		if (controlsTimer) clearTimeout(controlsTimer);
		if (cursorTimer) clearTimeout(cursorTimer);
		if (clickTimeout) clearTimeout(clickTimeout);
		clearStallWatch();
		if (qualityTimer) clearTimeout(qualityTimer);
		if (qualityToastTimer) clearTimeout(qualityToastTimer);
		stopProgressSaving();
		saveProgressBeacon();
		window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	$effect(() => {
		if ((streamUrl || useIframe) && videoTitle) {
			const sub = restoreSub;
			restoreSub = null;
			untrack(() => fetchSubtitles(sub ?? undefined));
		}
	});

	$effect(() => {
		if ((streamUrl || useIframe) && videoTitle) {
			const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
			const s = activeEpisode?.season ?? 0;
			const e = activeEpisode?.episode ?? 0;
			const type = showType;
			untrack(() => loadCast(baseTitle, type, s, e));
		}
	});

	$effect(() => {
		if (seekTarget >= 0 && Math.abs(progressPct - seekTarget) <= 1) seekTarget = -1;
	});

	$effect(() => {
		if (showType === 'tv' && videoTitle && activeSeason) {
			const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
			loadEpisodeNames(baseTitle, activeSeason);
		}
	});

	$effect(() => {
		const ep = activeEpisode;
		const length = duration;
		if (showType !== 'tv' || !ep || !streamUrl || length < 60) return;
		untrack(() => loadSkipTimes(ep, length));
	});

	$effect(() => {
		const q = query;
		if (!streamUrl && !useIframe && !needsLogin && !loading) {
			const timer = setTimeout(() => doSearch(q), 350);
			return () => clearTimeout(timer);
		}
	});

	function scrollToActiveEpisode() {
		tick().then(() => {
			setTimeout(() => {
				const active = document.querySelector('.ep-btn.playing');
				if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
			}, 150);
		});
	}

	$effect(() => {
		const ep = activeEpisode;
		const _url = streamUrl;
		if (!ep) return;
		scrollToActiveEpisode();
	});

	/* --------------------------------------------------------------- content functions */

	onMount(async () => {
		// On the TV, the next episode follows by itself unless it's been turned off there (its own
		// setting, so turning it off on the computer doesn't carry over), and Autosync is always on.
		try {
			const saved = localStorage.getItem(AUTOPLAY_KEY);
			autoplayNext = saved === null ? tvMode : saved === '1';
		} catch {}
		try { autosync = tvMode || localStorage.getItem('catalog-autosync') !== '0'; } catch {}
		// On a TV it's on until turned off (its own setting, like Autoplay): nobody wants to reach
		// for the remote every intro.
		try {
			const saved = localStorage.getItem(AUTOSKIP_KEY);
			autoSkip = saved === null ? tvMode : saved === '1';
		} catch {}
		try {
			const kept = JSON.parse(localStorage.getItem(SUB_LANGUAGES) ?? 'null');
			if (Array.isArray(kept) && kept.length) subLanguages = kept;
		} catch {}
		try { if (localStorage.getItem(VIDEO_FIT) === 'contain') videoFit = 'contain'; } catch {}
		const title = page.url.searchParams.get('title');
		isAuto = page.url.searchParams.get('auto') === '1';
		const type = page.url.searchParams.get('type') ?? '';
		const year = page.url.searchParams.get('year') ?? '';
		resumeSeason = Number(page.url.searchParams.get('resume_s') ?? 0);
		resumeEpisode = Number(page.url.searchParams.get('resume_e') ?? 0);

		if (liveMode) {
			startLive();
			loadLiveGame();
		} else if (replayMode) {
			startReplay(null);
		} else if (title && isAuto) {
			videoTitle = title;
			await resolve(title, type, year);
		} else if (title) {
			query = title;
			loading = false;
			doSearch(title);
		} else {
			loading = false;
		}
	});

	/** Times in a row Showbox was busy for this title (asked again, up to six times). */
	let busyTries = 0;

	/**
	 * Asks again for a title whose Showbox folder was busy, and adds Showbox's files to the
	 * lists when they come — without touching what's playing. Up to four tries.
	 */
	function fetchShowboxFilesLater(title: string, type: string, year: string, waitSeconds: number, tries = 0) {
		if (tries >= 4) return;
		setTimeout(async () => {
			if (lastResolveArgs?.title !== title) return;
			const params = new URLSearchParams({ title, nostream: '1' });
			if (type) params.set('type', type);
			if (year) params.set('year', year);
			const data = await fetch(`/api/watch/resolve?${params}`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			if (lastResolveArgs?.title !== title) return;
			if (!data || data.error || data.showboxBusy) {
				fetchShowboxFilesLater(title, type, year, data?.showboxBusy || data?.retryIn || 60, tries + 1);
				return;
			}
			if (!shareKey && data.shareKey) shareKey = data.shareKey;
			if (!mainShareKey && data.shareKey) mainShareKey = data.shareKey;
			if (data.files) {
				const showbox = (data.files as FileOption[]).filter((f) => !f.source);
				if (!showbox.length) return;
				movieFiles = [...showbox, ...movieFiles.filter((f) => f.source)];
			} else if (data.episodes) {
				let added = 0;
				for (const fresh of data.episodes.episodes as Episode[]) {
					const showbox = fresh.files.filter((f) => !f.source);
					const mine = episodes.find((e) => e.season === fresh.season && e.episode === fresh.episode);
					if (mine) {
						if (!showbox.length || mine.files.some((f) => !f.source)) continue;
						mine.files = [...showbox, ...mine.files];
						if (fresh.shareKey) mine.shareKey = fresh.shareKey;
						mine.available = true;
					} else {
						episodes.push(fresh);
					}
					added++;
				}
				episodeListWhole = true;
				if (!added) return;
				seasons = data.episodes.seasons;
			}
			showQualityToast("Showbox's files are back in the list");
		}, waitSeconds * 1000);
	}

	async function resolve(title: string, type: string, year: string) {
		loading = true;
		loadingStatus = pm ? pRandom() : 'Searching for title...';
		problem = '';
		debugInfo = '';
		needsLogin = false;
		resolveFailed = false;
		stalledOut = false;
		streamRefreshes = 0;
		lastResolveArgs = { title, type, year };
		// Anime starts in Japanese (asked alongside; the audio is put right when it answers).
		isAnime = false;
		animeKnown = fetch(`/api/watch/is-anime?${new URLSearchParams({ title, type: type === 'movie' ? 'movie' : 'tv', year: year ?? '' })}`)
			.then((r) => (r.ok ? r.json() : { anime: false }))
			.then((r: { anime?: boolean }) => {
				if (lastResolveArgs?.title !== title) return false;
				isAnime = r.anime === true;
				if (isAnime) {
					applyPreferredAudio();
					// Picked before this was known: English audio is the dub after all.
					recheckSubsForAudio();
				}
				return isAnime;
			})
			.catch(() => false);
		// Nothing of the last title's carries over (its subtitles stayed on after "Wrong one?").
		febboxSubs = [];
		subsKey = '';
		subtitleCues = [];
		subtitlesOn = false;
		subsAuto = false;
		activeSubFid = '';
		activeSubUrl = '';
		activeSubFileName = '';

		try {
			// A series asks for no stream here; it fetches only the episode it ends up playing —
			// but the computer starts that episode's link meanwhile (warm=1), so asking for it
			// below picks up the one already on its way.
			const params = new URLSearchParams({ title, nostream: '1', warm: '1' });
			if (type) params.set('type', type);
			if (year) params.set('year', year);
			if (resumeSeason && resumeEpisode) {
				params.set('resume_s', String(resumeSeason));
				params.set('resume_e', String(resumeEpisode));
			}

			const resp = await fetch(`/api/watch/resolve?${params}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.error === 'busy' && busyTries < 6) {
				// Showbox found it, but Febbox won't list its files for a moment (and no other source
				// has it): asked again when Febbox allows, rather than giving up.
				busyTries++;
				loadingStatus = `Showbox is busy: trying again in ${data.retryIn} s…`;
				setTimeout(() => {
					if (lastResolveArgs?.title === title && !streamUrl) resolve(title, type, year);
				}, data.retryIn * 1000);
				return;
			}
			busyTries = 0;
			if (data.error) {
				if (data.error === 'busy') {
					problem = 'Showbox is busy right now. Try again in a few minutes.';
				} else if (data.error === 'not_found') {
					problem = 'This title is unavailable.';
				} else if (data.error === 'no_link') problem = 'This title is unavailable.';
				else if (data.error === 'no_file') problem = 'This title has no video file.';
				else problem = 'Something went wrong.';
				loading = false;
				return;
			}

			videoTitle = data.title;
			showType = data.type;
			playedSeconds = 0;
			playedFrom = -1;
			// On the TV the picture gets the whole screen; the Episodes button opens the list.
			sidebarOpen = !tvMode && !episodesHiddenFor().has(data.title);
			shareKey = data.shareKey;
			mainShareKey = data.shareKey;
			libraryEntryId = data.libraryEntry?.id ?? null;
			libraryEntryStatus = data.libraryEntry?.status ?? '';
			libraryEntryRating = data.libraryEntry?.rating ?? null;
			libLastSeason = data.libraryEntry?.lastSeason ?? 0;
			libLastEpisode = data.libraryEntry?.lastEpisode ?? 0;
			watchPosterUrl = data.posterUrl ?? '';
			loadingStatus = pm ? pRandom() : (data.episodes ? 'Loading episodes...' : 'Getting stream...');

			if (data.files) movieFiles = data.files;
			// Showbox's folder couldn't be listed just now: another source plays meanwhile, and
			// Showbox's files join the list when Febbox lets them be asked for again.
			if (data.showboxBusy) fetchShowboxFilesLater(title, type, year, data.showboxBusy);
			episodeListWhole = !data.showboxBusy && !data.episodes?.partial;

			let needsResume = false;
			if (data.episodes) {
				episodes = data.episodes.episodes;
				seasons = data.episodes.seasons;
				if (resumeSeason && resumeEpisode) {
					activeSeason = seasons.includes(resumeSeason) ? resumeSeason : seasons[0];
					const target = episodes.find(ep => ep.season === activeSeason && ep.episode === resumeEpisode);
					activeEpisode = target ?? episodes[0] ?? null;
					needsResume = Boolean(target && (target.season !== seasons[0] || target.episode !== episodes[0]?.episode));
				} else {
					try {
						const progResp = await fetch(`/api/watch/progress?title=${encodeURIComponent(data.title)}&type=tv&episodes=1`);
						if (progResp.ok) {
							const watched = await progResp.json() as { season: number; episode: number; pct: number }[];
							if (watched.length > 0) {
								const last = watched.reduce((best, ep) =>
									ep.season > best.season || (ep.season === best.season && ep.episode > best.episode) ? ep : best
								);
								let ts = last.season, te = last.episode;
								if (last.pct >= 0.9) {
									const idx = episodes.findIndex(ep => ep.season === ts && ep.episode === te);
									if (idx >= 0 && idx + 1 < episodes.length) {
										ts = episodes[idx + 1].season;
										te = episodes[idx + 1].episode;
									}
								}
								activeSeason = seasons.includes(ts) ? ts : seasons[0];
								const target = episodes.find(ep => ep.season === ts && ep.episode === te);
								if (target) {
									activeEpisode = target;
									resumeSeason = ts;
									resumeEpisode = te;
									needsResume = true;
								}
							}
						}
					} catch {}
					if (!resumeSeason) {
						if (data.startSeason && seasons.includes(data.startSeason)) {
							activeSeason = data.startSeason;
							const first = episodes.find(ep => ep.season === data.startSeason);
							activeEpisode = first ?? episodes[0] ?? null;
							needsResume = Boolean(first);
						} else {
							if (seasons.length) activeSeason = seasons[0];
							if (episodes.length) activeEpisode = episodes[0];
						}
					}
				}
			}

			loggedIn = Boolean(data.hasToken);
			if (typeof data.febboxAccount === 'string') {
				febboxAccount = data.febboxAccount;
				// Another account than last time: files noted "360p only" may have been the last
				// account's used-up allowance (its links were still in use for a while). They go.
				try {
					if (localStorage.getItem(FEBBOX_ACCOUNT) !== febboxAccount) {
						for (const key of Object.keys(localStorage)) if (key.startsWith(LOW_ONLY)) localStorage.removeItem(key);
						localStorage.setItem(FEBBOX_ACCOUNT, febboxAccount);
					}
				} catch {}
			}

			if (data.debug) debugInfo = data.debug;

			if (data.episodes) {
				// Resuming can land on a greyed-out episode: take the first one that plays instead.
				if (!playable(activeEpisode)) {
					activeEpisode = episodes.find((e) => e.season === activeSeason && playable(e)) ?? episodes.find(playable) ?? null;
					if (activeEpisode) activeSeason = activeEpisode.season;
				}
				const ep = activeEpisode;
				if (ep) shareKey = ep.shareKey || mainShareKey;
				const file = ep ? pickFor(ep.files) : null;
				if (!ep || !file) {
					problem = 'No video file found for this title.';
					return;
				}
				videoTitle = `${data.title} S${ep.season}E${ep.episode}`;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				// Another source's file needs no Febbox sign-in.
				if (!data.hasToken && !file.source) {
					needsLogin = true;
					return;
				}
				loadingStatus = needsResume
					? (pm ? "PAPA'S BACK resuming..." : `Resuming S${ep.season}E${ep.episode}...`)
					: (pm ? pRandom() : 'Getting stream...');
				const got = await linkFor(ep.files, file);
				const url = got.url;
				// About the copy that plays: the first one looked up may have had nothing ("7Movies has
				// nothing for this right now" showed under Movy's stream).
				if (url || got.debug) debugInfo = got.debug ?? '';
				if (url) {
					activeQuality = got.file.quality;
					activeFileFid = got.file.fid;
					streamUrl = url;
					sayIfOnlyDub(got.file);
				} else if (file.source) {
					problem = `${file.source} couldn't play this episode right now.`;
				} else {
					useIframe = true;
					iframeFid = file.fid;
				}
				return;
			}

			// A film from another source (Aniwave): the version in the audio picked last, no sign-in.
			const film = pickFor(currentFiles);
			if (film?.source) {
				activeQuality = film.quality;
				activeFileFid = film.fid;
				const got = await linkFor(currentFiles, film);
				if (got.url) {
					activeQuality = got.file.quality;
					activeFileFid = got.file.fid;
					streamUrl = got.url;
				} else problem = `${film.source} couldn't play this right now.`;
				return;
			}

			// The mini player, on another Showbox copy than the one the computer fetched a link for.
			const start = startFid !== null ? currentFiles.find((f) => f.fid === startFid && !f.source) : null;
			if (start && start.fid !== data.fid) {
				startFid = null;
				const got = await linkFor(currentFiles, start);
				if (got.url) {
					activeQuality = got.file.quality;
					activeFileFid = got.file.fid;
					streamUrl = got.url;
					return;
				}
			}
			if (data.streamUrl) {
				streamUrl = data.streamUrl;
				const af = currentFiles.find((f) => f.fid === data.fid);
				activeQuality = af?.quality ?? currentFiles[0]?.quality ?? '';
				activeFileFid = af?.fid ?? currentFiles[0]?.fid ?? 0;
			} else if (!data.hasToken) {
				needsLogin = true;
			} else {
				const defaultFile = pickFor(currentFiles);
				// Showbox gave no link: another source's copy, in the language last picked.
				const other = pickFile(currentFiles.filter((f) => f.source), preferredQuality, animeAudio());
				const got = other ? await linkFor(currentFiles, other) : null;
				if (got?.url) {
					activeQuality = got.file.quality;
					activeFileFid = got.file.fid;
					streamUrl = got.url;
				} else if (defaultFile) {
					useIframe = true;
					iframeFid = defaultFile.fid;
					activeQuality = defaultFile.quality;
					activeFileFid = defaultFile.fid;
				} else {
					problem = 'No video file found for this title.';
				}
			}
		} catch {
			problem = 'Could not load that title.';
			resolveFailed = true;
		} finally {
			loading = false;
			loadingStatus = '';
			fetchWatchedEpisodes();
			if (shareKey) queueQualityPrefetch(currentFiles, activeFileFid);
		}
	}

	/** The dub started for someone watching in Japanese: only when no Japanese copy was there to pick. */
	function sayIfOnlyDub(file: FileOption) {
		if (isDub(file) && animeAudio() !== 'English') showQualityToast('Only the English dub is available for this episode');
	}

	function showQualityToast(msg: string) {
		if (qualityToastTimer) clearTimeout(qualityToastTimer);
		qualityToast = msg;
		qualityToastTimer = setTimeout(() => { qualityToast = ''; qualityToastTimer = null; }, 5000);
	}

	/** `byItself`: Catalog switched (Showbox held to low quality), not you: nothing is remembered. */
	async function changeToFile(file: FileOption, byItself = false) {
		// (Other sources' copies share one fid across episodes: the episode before's isn't this one's.)
		if (!file || (file.fid === activeFileFid && !oldPicture)) return;
		// Picked while the episode is still loading (waiting on a slow source): this takes over, and
		// the load's answer is dropped. The source menu used to do nothing then.
		const takingOver = loadingEpisode;
		if (takingOver) {
			episodeSwitch++;
			loadingEpisode = false;
		}
		if (!byItself) preferredQuality = file.quality;
		streamRefreshes = 0;
		if (stalledOut) { stalledOut = false; problem = ''; }
		if (qualityToast && !byItself) { qualityToast = ''; if (qualityToastTimer) { clearTimeout(qualityToastTimer); qualityToastTimer = null; } }

		// Picking another source's copy remembers it (and its audio) for the next episodes.
		if (!byItself) keepSource(file);
		// Subtitles in the picture: Catalog's own would sit on top of them.
		if (file.burnedIn) subtitlesOn = false;
		// Only a copy picked by hand says which language you want.
		if (file.audio && !byItself) {
			try {
				localStorage.setItem(ANIME_AUDIO, file.audio);
			} catch {}
		}

		if (useIframe && !file.source) {
			iframeFid = file.fid;
			activeQuality = file.quality;
			activeFileFid = file.fid;
			reloadWebview();
			return;
		}
		useIframe = false;

		if (qualityTimer) { clearTimeout(qualityTimer); qualityTimer = null; }
		// Nothing to go back to, or carry on from, while the video still holds the episode before.
		const fresh = oldPicture;
		prevStreamUrl = fresh ? '' : streamUrl;
		prevFileFid = activeFileFid;
		prevQuality = activeQuality;
		changingQuality = true;
		const savedTime = fresh ? 0 : (videoEl?.currentTime ?? 0);
		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareOf(file)}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			if (data.url) {
				oldPicture = false;
				seekAfterLoad = savedTime;
				streamUrl = data.url;
				streamNonce++;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				if (fresh) fetchSubtitles();
				// "… couldn't play this one" from a try before: this one has a link.
				problem = '';
				// (What's said about this copy, not about one tried before.)
				debugInfo = data.debug ?? '';
				qualityTimer = setTimeout(() => {
					qualityTimer = null;
					if (!prevStreamUrl) return;
					// Playing, or loaded and paused by hand: it works.
					if ((playing && !buffering) || userPaused || (videoEl?.readyState ?? 0) >= 2) { prevStreamUrl = ''; return; }
					showQualityToast('That file could not be played. Try a different one.');
					seekAfterLoad = savedTime;
					streamUrl = prevStreamUrl;
					activeFileFid = prevFileFid;
					activeQuality = prevQuality;
					prevStreamUrl = '';
				}, 20000);
			} else {
				prevStreamUrl = '';
				const said = file.source ? `${file.source} couldn't play this one right now.` : 'Could not get that quality.';
				// Something still playing: it carries on, so a passing message, and the stream info
				// stays about it. (It was a red line that never went, and "7Movies has nothing for
				// this right now" under Movy's stream info.)
				if (fresh) {
					problem = said;
					if (data.debug) debugInfo = data.debug;
				} else showQualityToast(said);
			}
		} catch {
			prevStreamUrl = '';
			if (fresh) problem = 'Failed to switch quality.';
			else showQualityToast('Could not switch to that one.');
		} finally {
			changingQuality = false;
			if (takingOver) fetchWatchedEpisodes();
		}
	}

	/** Counts episode changes: one picked while another was still loading takes over from it. */
	let episodeSwitch = 0;

	async function playEpisode(ep: Episode, passingFinished = false) {
		if (ep === activeEpisode || !playable(ep)) return;
		// Left nearly done (the credits skipped to here): its download can go.
		if (duration > 0 && currentTime >= duration * 0.9) finishedDownload();
		const mine = ++episodeSwitch;
		mayMoveOn = false;
		if (!passingFinished && !loadingEpisode) saveProgress();
		// The episode before stops here and now. It used to play on while the next one's link was
		// fetched (Movy: up to 50 s), under the next one's name — and its place was saved as the
		// next one's (Dungeon Meshi E6 marked 98% watched from E5's position).
		// (Marked as switching first, or the pause would count as you pausing.)
		skipResume = true;
		switchingEpisode = true;
		oldPicture = true;
		videoEl?.pause();
		hlsInstance?.stopLoad();
		// The mini player stays open for the next episode (its next button is how it got here). Only
		// the browser's own one, showing the video itself, closes.
		if (inPiP && !pipVideo) cleanupPiP();
		lastCastKey = '';

		// Subtitles picked by hand carry on to the next episode; ones that went on by themselves
		// are decided again there (they don't go on over the dub).
		const prevSub = subtitlesOn && activeSubFileName && !subsAuto
			? { fileName: activeSubFileName, language: febboxSubs.find(s => s.url === activeSubUrl)?.language ?? '', delay: subtitleDelay }
			: undefined;

		activeEpisode = ep;
		if (ep.season !== activeSeason) activeSeason = ep.season;
		problem = '';
		stalledOut = false;
		streamRefreshes = 0;
		skipSegments = [];
		skipLookupKey = '';
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		// Its name at the top straight away, as the episode list already shows.
		videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
		const file = pickFor(ep.files);
		if (!file) {
			problem = 'No video file for that episode.';
			return;
		}
		// From here on everything (stream, qualities, subtitles) uses this episode's share.
		shareKey = ep.shareKey || mainShareKey;

		// Started: Continue Watching shows this episode from now, even if it's left straight away
		// (a place already saved in it is kept).
		if (showType === 'tv') {
			fetch('/api/watch/progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: baseTitle, type: 'tv', season: ep.season, episode: ep.episode, currentTime: 0, duration: 0, posterUrl: watchPosterUrl }),
				keepalive: true
			}).catch(() => {});
		}

		currentTime = 0;
		duration = 0;
		bufferedEnd = 0;
		seekTarget = -1;
		seekPreview = -1;
		febboxSubs = [];
		activeSubFid = '';
		activeSubUrl = '';
		activeSubFileName = '';
		subtitleCues = [];
		subtitlesOn = false;

		if (useIframe && !file.source) {
			iframeFid = file.fid;
			activeQuality = file.quality;
			activeFileFid = file.fid;
			videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
			reloadWebview();
			fetchSubtitles(prevSub);
			return;
		}

		useIframe = false;
		loadingEpisode = true;
		try {
			const data = await linkFor(ep.files, file);
			// Another episode was picked meanwhile: that one carries on, this answer is dropped.
			if (mine !== episodeSwitch) return;
			if (data.url) {
				oldPicture = false;
				streamUrl = data.url;
				streamNonce++;
				activeQuality = data.file.quality;
				activeFileFid = data.file.fid;
				// What's said about the copy that plays (the others' "nothing here" isn't about it).
				debugInfo = data.debug ?? '';
				sayIfOnlyDub(data.file);
				fetchSubtitles(prevSub);
			} else {
				problem = file.source ? `${file.source} couldn't play this episode right now.` : 'Could not get a link for that episode.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			if (mine === episodeSwitch) problem = 'Failed to load episode.';
		} finally {
			if (mine === episodeSwitch) {
				loadingEpisode = false;
				fetchWatchedEpisodes();
				if (shareKey) queueQualityPrefetch(ep.files, file.fid);
			}
		}
	}

	async function doSearch(q: string) {
		q = q.trim();
		if (!q) {
			results = [];
			searched = false;
			return;
		}
		searching = true;
		problem = '';
		try {
			const resp = await fetch(`/api/watch/search?q=${encodeURIComponent(q)}`);
			if (!resp.ok) throw new Error();
			results = await resp.json();
			searched = true;
		} catch {
			problem = 'Search failed. Try again in a moment.';
		} finally {
			searching = false;
		}
	}

	async function watchResult(result: Result) {
		resolving = true;
		loadingStatus = pm ? pRandom() : 'Searching for title...';
		videoTitle = result.title;
		await resolve(result.title, result.type, '');
		resolving = false;
	}

	function wrongShow() {
		const searchTitle = lastResolveArgs?.title ?? videoTitle.replace(/ S\d+E\d+$/, '');
		if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
		streamUrl = '';
		videoTitle = '';
		problem = '';
		debugInfo = '';
		episodes = [];
		seasons = [];
		movieFiles = [];
		activeEpisode = null;
		useIframe = false;
		needsLogin = false;
		loading = false;
		query = searchTitle;
		isAuto = false;
		doSearch(searchTitle);
	}

	function reloadWebview() {
		if (!webviewEl) return;
		extractVideoFromWebview(webviewEl as any, iframeFid, shareKey);
	}

	function loginToFebbox() {
		const popup = window.open('https://www.febbox.com/login', '_blank');
		if (!popup) return;
		const check = setInterval(async () => {
			try {
				if (popup.closed) {
					clearInterval(check);
					const result = await fetch('/api/watch/sync-cookies', { method: 'POST' })
						.then((r) => r.json())
						.catch(() => null);
					if (result?.signedIn === false) {
						problem = "Febbox didn't log you in. Check the email and password, and try again.";
						return;
					}
					if (lastResolveArgs)
						resolve(lastResolveArgs.title, lastResolveArgs.type, lastResolveArgs.year);
				}
			} catch {
				clearInterval(check);
			}
		}, 500);
	}

	function backToSearch() {
		streamUrl = '';
		videoTitle = '';
		problem = '';
		debugInfo = '';
		episodes = [];
		seasons = [];
		movieFiles = [];
		activeEpisode = null;
		useIframe = false;
		iframeFid = 0;
		webviewReady = false;
		needsLogin = false;
		loading = false;
		subtitleCues = [];
		subtitlesOn = false;
		activeSubUrl = '';
		activeSubFileName = '';
		showSettings = false;
		showCaptions = false;
		showAudioPicker = false;
		febboxSubs = [];
		activeSubFid = '';
		episodeNames = {};
	}
</script>

<svelte:head><title>{videoTitle ? `${videoTitle} · ` : ''}Watch · Catalog</title></svelte:head>
<svelte:window onkeydown={handleKeyDown} />

<!-- Where the video comes from, and the other copies (the top bar's, and the mini player's). -->
{#snippet filePicker()}
	<div class="file-pick-wrap">
		<button
			type="button"
			class="bar-btn file-pick-btn"
			disabled={changingQuality}
			onclick={() => {
				showFilePicker = !showFilePicker;
				// One menu open at a time (on a TV two at once were in each other's way).
				if (showFilePicker) showSettings = showCaptions = showDelay = showAudioPicker = false;
			}}
		>
			{activeFile ? fileLabel(activeFile) : ''} · {activeFile?.source ?? 'Showbox'}
			<svg class="file-arrow" class:open={showFilePicker} viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
		</button>
		{#if showFilePicker}
			<div class="popup popup-files">
				<p class="popup-label">Files</p>
				{#each currentFiles as f (f.fid)}
					<button
						class="popup-item"
						class:active={activeFileFid === f.fid}
						onclick={() => { changeToFile(f); showFilePicker = false; }}
					>
						{#if activeFileFid === f.fid}<span class="popup-check">&#10003;</span>{/if}
						<span class="sub-name-row">
							<span class="sub-name-text">{fileLabel(f)}</span>
							<span class="sub-source-badge">{f.source ?? 'Showbox'}</span>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}


{#if streamUrl || useIframe || needsLogin}
	<!-- ============================================================= PLAYER VIEW -->
	<div
		class="player-page"
		class:mini={miniMode}
		class:has-sidebar={!miniMode && (castOpen || (showType === 'tv' && seasons.length > 0 && sidebarOpen))}
		class:hide-cursor={isFullscreen && cursorIdle && !showControls && playing}
		bind:this={playerPageEl}
		data-tv-player={streamUrl || useIframe ? '' : undefined}
		onmousemove={wakeCursor}
	>
		<div
			class="player-bar"
			class:bar-hidden={(isFullscreen || tvMode) && !showControls}
			onmouseenter={() => { showControls = true; if (controlsTimer) clearTimeout(controlsTimer); }}
			onmouseleave={scheduleHide}
		>
			<button type="button" class="bar-btn" onclick={goBack}>&larr; Back</button>
			<h1 class="player-title">{videoTitle}</h1>

			{#if liveMode}
				<span class="live-badge">LIVE</span>
				<!-- The game's channels, where the files would be. -->
				<div class="file-pick-wrap">
					<button
						type="button"
						class="bar-btn file-pick-btn"
						disabled={!liveGame || liveGame.channels.length < 2}
						onclick={() => {
							showFilePicker = !showFilePicker;
							if (showFilePicker) showSettings = showCaptions = showDelay = showAudioPicker = false;
						}}
					>
						{liveNow.name || `Channel ${liveNow.id}`}
						{#if liveGame && liveGame.channels.length > 1}
							<svg class="file-arrow" class:open={showFilePicker} viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
						{/if}
					</button>
					{#if showFilePicker && liveGame}
						<div class="popup popup-files">
							<p class="popup-label">Channels showing it</p>
							{#each liveGame.channels as channel (channel.id)}
								<button class="popup-item" class:active={liveNow.id === channel.id} onclick={() => switchLiveChannel(channel)}>
									{#if liveNow.id === channel.id}<span class="popup-check">&#10003;</span>{/if}
									<span class="sub-name-text">{channel.name}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<span class="live-star"><LiveStar saved={liveSaved} label={videoTitle} onclick={toggleLiveSaved} /></span>
			{/if}

			{#if replayMode && replayVersions.length}
				<span class="live-badge replay-badge">REPLAY</span>
				<div class="file-pick-wrap">
					<button
						type="button"
						class="bar-btn file-pick-btn"
						disabled={replayVersions.filter(Boolean).length < 2}
						onclick={() => {
							showFilePicker = !showFilePicker;
							if (showFilePicker) showSettings = showCaptions = showDelay = showAudioPicker = false;
						}}
					>
						{replayVersions[replayVersion] ?? 'Replay'}
						{#if replayVersions.filter(Boolean).length > 1}
							<svg class="file-arrow" class:open={showFilePicker} viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
						{/if}
					</button>
					{#if showFilePicker}
						<div class="popup popup-files">
							<p class="popup-label">Versions</p>
							{#each replayVersions as label, at (at)}
								{#if label}
									<button class="popup-item" class:active={replayVersion === at} onclick={() => startReplay(at)}>
										{#if replayVersion === at}<span class="popup-check">&#10003;</span>{/if}
										<span class="sub-name-text">{label}</span>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Shown even with one file, so it always says where the video comes from. -->
			{#if currentFiles.length > 0}
				{@render filePicker()}
			{/if}

			{#if !sportsMode}
				<button
					type="button"
					class="bar-btn cast-btn"
					class:active={castOpen}
					onclick={() => { castOpen = !castOpen; }}
				>{pm ? p('Cast') : 'Cast'}</button>
			{/if}

			{#if showType === 'tv' && seasons.length > 0}
				<button
					type="button"
					class="bar-btn episodes-btn"
					onclick={toggleEpisodes}
				>{sidebarOpen ? (pm ? 'Hide' : 'Hide episodes') : (pm ? p('Episodes') : 'Episodes')}</button>
			{/if}

			{#if showType === 'tv'}
				<button type="button" class="bar-btn autoplay-btn" class:active={autoplayNext} onclick={toggleAutoplay}>
					{autoplayNext ? '⏭ Autoplay: On' : '⏭ Autoplay: Off'}
				</button>
				<button
					type="button"
					class="bar-btn autoplay-btn autosync-btn"
					class:active={autosync}
					onclick={toggleAutosync}
					title="Adds the show to your library as you watch, keeps its episode up to date, and marks it completed after the last one"
				>{autosync ? '↑ Autosync: On' : '↑ Autosync: Off'}</button>
				<button
					type="button"
					class="bar-btn autoplay-btn"
					class:active={autoSkip}
					onclick={toggleAutoSkip}
					title="Skips intros and end credits by itself"
				>{autoSkip ? '⏩ Auto-skip: On' : '⏩ Auto-skip: Off'}</button>
			{/if}

			{#if sportsMode}
				<!-- (Nothing of the library's for a live channel or a replay.) -->
			{:else if !loggedIn}
				<button type="button" class="bar-btn login-btn" onclick={loginToFebbox}>Log in</button>
			{/if}

			{#if sportsMode}
				<!-- -->
			{:else if libraryEntryId}
				<a href="/entry/{libraryEntryId}" class="bar-btn in-library-btn">{pm ? 'Giblet claimed' : 'In library'}</a>
				{#if libraryEntryStatus && libraryEntryStatus !== 'completed'}
					<button type="button" class="bar-btn mark-watched-btn" onclick={markEntryWatched}>✓ Mark as completed</button>
				{/if}
			{:else}
				<button
					type="button"
					class="bar-btn add-btn"
					disabled={addingToLibrary}
					onclick={addToLibraryQuick}
				>{addingToLibrary ? (pm ? 'hold on...' : 'Adding...') : (pm ? p('+ Add to library') : '+ Add to library')}</button>
			{/if}
		</div>

		{#if problem}
			<p class="player-error">
				{problem}
				{#if stalledOut}
					<button type="button" class="retry-btn" onclick={retryStream}>Retry</button>
				{/if}
			</p>
		{/if}

		<!-- The episode and cast lists count as the player too: their buttons sit in the top bar
			 right above them, and the bar has to stay up on the way there in full screen. -->
		<div
			class="player-body"
			onmousemove={showControlsBriefly}
			ontouchstart={showControlsBriefly}
			onmouseleave={() => {
				if (playing && !showSettings && !showCaptions && !showAudioPicker) showControls = false;
			}}
		>
			{#if showType === 'tv' && seasons.length > 0 && sidebarOpen && !miniMode}
				<aside class="sidebar">
					<div class="season-tabs">
						{#each seasons as s (s)}
							<button
								type="button"
								class="season-tab"
								class:active={activeSeason === s}
								onclick={() => (activeSeason = s)}
							>{s === 0 ? 'Specials' : `S${s}`}</button>
						{/each}
					</div>
					<ul class="episode-list">
						{#each seasonEpisodes as ep (`${ep.season}-${ep.episode}`)}
							{@const epPct = watchedEpisodeMap.get(`${ep.season}-${ep.episode}`) ?? 0}
							<li class="has-more ep-li">
								<button
									type="button"
									class="ep-btn"
									class:playing={activeEpisode === ep}
									class:watched={epPct >= 0.9}
									class:partial={epPct > 0.02 && epPct < 0.9}
									class:unavailable={!playable(ep)}
									title={playable(ep) ? undefined : notAvailableText(ep)}
									disabled={!playable(ep)}
									onclick={() => playEpisode(ep)}
									oncontextmenu={(e) => openEpMenu(e, ep)}
								>
									<span class="ep-num">E{ep.episode}</span>
									{#if nameOf(ep)}
										<span class="ep-name">{nameOf(ep)}</span>
									{/if}
									{#if !playable(ep)}
										<span class="ep-missing">{notAvailableText(ep)}</span>
									{/if}
								</button>
								<MoreButton onopen={(e) => openEpMenu(e, ep)} label="Episode options" />
							</li>
						{/each}
					</ul>
				</aside>
				{#if epMenu}
					{@const ep = epMenu.ep}
					{@const seen = (watchedEpisodeMap.get(`${ep.season}-${ep.episode}`) ?? 0) >= 0.9}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="ep-ctx-backdrop" onclick={() => (epMenu = null)} oncontextmenu={(e) => { e.preventDefault(); epMenu = null; }}></div>
					<div class="ep-ctx-menu" style="left: {epMenu.x}px; top: {epMenu.y}px;">
						<button type="button" onclick={() => { epMenu = null; playEpisode(ep); }}>▶ Play S{ep.season}E{ep.episode}</button>
						<hr />
						{#if seen}
							<button type="button" onclick={() => markEps([ep], false)}>Mark as not watched</button>
						{:else}
							<button type="button" onclick={() => markEps([ep], true)}>✓ Mark as watched</button>
						{/if}
						<button type="button" onclick={() => markEps(upTo(ep), true)}>✓ Mark watched up to here</button>
						<button type="button" onclick={() => markEps(episodes.filter((x) => x.season === ep.season), true)}>
							✓ Mark season {ep.season} watched
						</button>
						<hr />
						<button type="button" onclick={() => markEps(episodes.filter((x) => x.season === ep.season), false)}>
							Mark season {ep.season} not watched
						</button>
					</div>
				{/if}
			{/if}

			<div class="video-area">
				{#if qualityToast}
						<div class="quality-toast">{qualityToast}</div>
					{/if}
					{#if needsLogin}
					<div class="login-prompt">
						<p>Log in to start watching.</p>
						<button type="button" class="login-action" onclick={loginToFebbox}>
							Log in with Google
						</button>
					</div>
				{:else if useIframe}
					{#if extracting}
						<p class="player-status">Loading video...</p>
					{/if}
					<!-- svelte-ignore a11y_missing_attribute -->
					<webview
						bind:this={webviewEl}
						src="https://www.febbox.com/share/{shareKey}"
						class="hidden-webview"
					></webview>
				{:else}
					{#if loadingEpisode}
						<p class="player-status">Loading episode...</p>
					{/if}

					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						autoplay
						playsinline
						style:object-fit={videoFit}
						class:buffering={loadingEpisode || changingQuality}
						class:old-picture={oldPicture}
						ontimeupdate={onTimeUpdate}
						ondurationchange={() => {
							if (videoEl && !switchingEpisode) duration = videoEl.duration;
						}}
						onplay={() => {
							if (oldPicture) {
								videoEl?.pause();
								return;
							}
							playing = true;
							userPaused = false;
							scheduleHide();
							if (pipVideo?.paused) pipVideo.play().catch(() => {});
						}}
						onpause={() => {
							// Paused by hand (media keys, picture-in-picture), not by a reload clearing the old video.
							if (videoEl && videoEl.readyState >= 2 && !switchingEpisode && !refreshingStream) userPaused = true;
							playing = false;
							showControls = true;
							saveProgress();
							if (pipVideo && !pipVideo.paused) pipVideo.pause();
						}}
						onvolumechange={() => {
							if (videoEl) {
								if (!gainNode || gainNode.gain.value <= 1) volume = videoEl.volume;
								muted = videoEl.muted;
							}
						}}
						onprogress={() => {
							markBytes();
							if (videoEl && videoEl.buffered.length > 0)
								bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
						}}
						onwaiting={() => {
							buffering = true;
							noteSlowStop();
							stopStarted();
							if (!stalledOut) watchForStall();
						}}
						oncanplay={() => { buffering = false; }}
						onplaying={() => {
							buffering = false;
							clearStallWatch();
							stopEnded('played');
							// A file switched to has started: it works, so a later hiccup isn't a reason to switch back.
							if (prevStreamUrl && !changingQuality) prevStreamUrl = '';
						}}
						onseeking={() => {
							buffering = true;
							isVideoSeeking = true;
							lastSeekAt = performance.now();
							if (videoEl) notePlayerEvent(`jumped to ${fmt(videoEl.currentTime)}`);
							noteJumpBack();
						}}
						onseeked={() => {
							buffering = false;
							isVideoSeeking = false;
							// Paused, nothing else updates the bar after a jump (it waits for playback).
							if (videoEl && !seeking && !switchingEpisode) currentTime = videoEl.currentTime;
						}}
						onended={episodeEnded}
					>
						Your browser doesn't support video playback.
					</video>

					{#if inPiP}
						<div class="pip-placeholder">Playing in picture-in-picture</div>
					{:else if inMini}
						<div class="pip-placeholder">Playing in the mini player</div>
					{/if}

					<!-- click-to-play / double-click-fullscreen layer -->
					<div
						class="click-layer"
						role="button"
						tabindex="-1"
						onclick={handleVideoClick}
						ondblclick={handleVideoDblClick}
					></div>

					<!-- fast-forward / rewind on the remote -->
					{#if scanDir}
						<div class="scan-badge">{scanDir > 0 ? '▶▶' : '◀◀'} {SCAN_SPEEDS[scanLevel]}×</div>
					{/if}

					<!-- buffering spinner -->
					{#if buffering && !loadingEpisode && !changingQuality}
						<div class="buffering-overlay">
							<div class="buffering-spinner"></div>
						</div>
					{/if}

					<!-- quality switch toast -->
					{#if changingQuality}
						<div class="quality-toast">Switching quality…</div>
					{/if}

					<!-- keeps stopping to load: asks what to do -->
					{#if slowOffer}
						<div class="slow-offer" bind:this={slowOfferEl}>
							<span>Keeps stopping to load.</span>
							<!-- First, so the TV's highlight starts on it: another server is what gets it going again. -->
							{#if slowOffer.other}<button type="button" onclick={() => slowChoice('other')}>Play on {slowOffer.other.source ?? 'Showbox'}</button>{/if}
							{#if slowOffer.freshLink}<button type="button" onclick={() => slowChoice('fresh')}>Try a fresh link</button>{/if}
							{#if slowOffer.lower >= 0}<button type="button" onclick={() => slowChoice('lower')}>Lower quality ({slowOffer.height}p)</button>{/if}
							<button type="button" onclick={() => slowChoice('keep')}>Keep loading</button>
							<!-- What's slow, in the corner, for a photo to send (on the TV too): this video only. -->
							{#if !showStats}<button type="button" onclick={() => (showStats = true)}>Show details</button>{/if}
						</div>
					{/if}

					{#if showStats && stats}
						<div class="playback-stats" aria-live="off">
							<div><span>Source</span>{stats.source} · {stats.height ? `${stats.height}p` : stats.quality}{stats.relayed ? ' · through this computer' : ''}</div>
							<div><span>Loaded ahead</span>{stats.aheadSeconds} s</div>
							<div><span>On the computer</span>{stats.heldPercent === null ? 'not downloaded ahead (only 7Movies and Movy are)' : `${stats.heldPercent}% of it · ${fmt(stats.heldAhead)} past here · ${stats.heldGoing} downloading`}</div>
							<div><span>Each piece</span>{stats.piecesMbps.length ? stats.piecesMbps.map((m) => `${m}`).join(' · ') + ' Mbps' : '—'}{stats.needsMbps ? ` (needs ${stats.needsMbps})` : ''}</div>
							<div><span>From memory</span>{stats.fromMemory} of the last {stats.piecesMbps.length}</div>
							<div><span>Server</span>{stats.servers.join(', ') || '—'}</div>
							<div><span>Also downloading</span>{[stats.previewsDownloading ? 'preview pictures' : '', stats.hearingSound ? 'sound for auto-timing' : ''].filter(Boolean).join(', ') || 'nothing'}</div>
						</div>
					{/if}

					<!-- subtitle overlay -->
					{#if !inPiP}
						<!-- cue text is escaped by safeSubHtml(), so only i/b/u tags can reach the page -->
						{#if activeSubs.top}
							<div class="subtitle-display top" class:plain={!subLook.box} class:bold={subLook.bold} style:font-size={subFontSize}>{@html activeSubs.top.replace(/\n/g, '<br>')}</div>
						{/if}
						{#if activeSubs.bottom}
							<div class="subtitle-display" class:plain={!subLook.box} class:bold={subLook.bold} style:font-size={subFontSize}>{@html activeSubs.bottom.replace(/\n/g, '<br>')}</div>
						{/if}
					{/if}

					<!-- "Rate it", once it's finished -->
					<!-- skip intro / next episode -->
					{#if activeSkip || nextEp}
						<div class="next-ep-overlay">
							{#if activeSkip}
								{@const seg = activeSkip}
								<button type="button" class="skip-btn" bind:this={skipButton} onclick={() => skipSegment(seg)}>{SKIP_LABELS[seg.type]}</button>
							{/if}
							{#if nextEp}
								<button type="button" class="next-ep-btn" bind:this={nextEpButton} onclick={() => playEpisode(nextEp)}>
									<span class="next-ep-label">
										{#if countdown !== null}
											Next episode in {countdown}
										{:else if autoplayNext && duration > 0 && (duration - currentTime) <= 0.5}
											Auto-playing...
										{:else if autoplayNext}
											{pm ? p('Next Episode') : 'Next Episode'} (auto)
										{:else}
											{pm ? p('Next Episode') : 'Next Episode'}
										{/if}
									</span>
									<span class="next-ep-title">S{nextEp.season}E{nextEp.episode}{nameOf(nextEp) ? ` — ${nameOf(nextEp)}` : ''}</span>
								</button>
							{/if}
						</div>
					{/if}

					<!-- the mini player's own: dragged by its top edge, back to Catalog and close in its corner -->
					{#if miniMode}
						<div class="mini-top" class:visible={showControls}>
							<span class="mini-title">{videoTitle}</span>
							{#if currentFiles.length > 0}{@render filePicker()}{/if}
							<button type="button" class="mini-btn" onclick={() => leaveMini(true)} title="Back to Catalog">
								<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
							</button>
							<button type="button" class="mini-btn" onclick={() => leaveMini(false)} title="Close">
								<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
							</button>
						</div>
					{/if}

					<!-- custom controls overlay -->
					<div class="controls" class:visible={showControls}>
						<!-- progress bar (on a TV it can be highlighted: left and right skip, up goes on to the top bar) -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							class="progress-wrap"
							tabindex={tvMode ? 0 : undefined}
							data-tv-up=".player-bar button, .player-bar a"
							onmousedown={(e) => { if (!liveMode) onProgressDown(e); }}
							onmousemove={(e) => { if (!liveMode) onProgressHover(e); }}
							onmouseleave={() => (hoverPct = -1)}
						>
							{#if previewPct >= 0 && duration > 0}
								<div class="scrub-preview" style:left="clamp(84px, {previewPct}%, calc(100% - 84px))">
									<canvas bind:this={thumbCanvas} width="192" height="108"></canvas>
									<span class="scrub-time">{fmt((previewPct / 100) * duration)}</span>
								</div>
							{/if}
							<div class="progress-bar" bind:this={progressBarEl}>
								<!-- Downloaded onto the computer (lighter), under what the player holds itself. -->
								{#if duration > 0}
									{#each heldRanges as range (range.start)}
										<div class="prog-held" style:left="{(range.start / duration) * 100}%" style:width="{((Math.min(range.end, duration) - range.start) / duration) * 100}%"></div>
									{/each}
								{/if}
								<div class="prog-buffered" style:width="{bufferedPct}%"></div>
								<!-- Intros and credits sit under the played part, so it shows how far into them you are. -->
								{#if duration > 0}
									{#each skipSegments as seg (seg.type)}
										<div
											class="prog-segment"
											style:left="{(seg.start / duration) * 100}%"
											style:width="{((Math.min(seg.end, duration) - seg.start) / duration) * 100}%"
										></div>
									{/each}
								{/if}
								<div class="prog-played" style:width="{liveMode ? 100 : displayPct}%"></div>
								{#if !liveMode}<div class="prog-handle" style:left="{displayPct}%" class:dragging={seeking}></div>{/if}
								<!-- Dragging or fast-forwarding: where you were, so it's easy to find again. -->
								{#if seekPreview >= 0 && duration > 0}
									<div class="prog-was" style:left="{progressPct}%">
										<span class="prog-was-time">{fmt(currentTime)}</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- button row (on a TV, up goes from here to the progress bar, past Skip Intro sitting on it) -->
						<div class="ctrl-row" data-tv-up=".progress-wrap">
							<button class="ctrl-btn" onclick={togglePlay} title={playing ? 'Pause (k)' : 'Play (k)'}>
								{#if playing}
									<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
								{:else}
									<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M8 5v14l11-7z"/></svg>
								{/if}
							</button>

							<button class="ctrl-btn" onclick={() => skip(-10)} title="Back 10s">
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
									<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
									<text x="12" y="16" text-anchor="middle" font-size="7" font-weight="700" font-family="sans-serif">10</text>
								</svg>
							</button>

							<button class="ctrl-btn" onclick={() => skip(10)} title="Forward 10s">
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
									<path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
									<text x="12" y="16" text-anchor="middle" font-size="7" font-weight="700" font-family="sans-serif">10</text>
								</svg>
							</button>

							{#if miniMode && showType === 'tv' && previousEpisode()}
								<button
									class="ctrl-btn"
									disabled={loadingEpisode}
									onclick={() => { const ep = previousEpisode(); if (ep) playEpisode(ep); }}
									title="Previous episode"
								>
									<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
								</button>
							{/if}

							{#if upcomingEp}
								{@const next = upcomingEp}
								<button
									class="ctrl-btn"
									disabled={loadingEpisode}
									onclick={() => playEpisode(next)}
									title="Next episode: S{next.season}E{next.episode}"
								>
									<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
								</button>
							{/if}

							<div class="vol-group">
								<button class="ctrl-btn" onclick={toggleMute} title={muted ? 'Unmute (m)' : 'Mute (m)'}>
									{#if muted || volume === 0}
										<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
									{:else if volume < 0.5}
										<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M18.5 12A4.5 4.5 0 0016 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>
									{:else}
										<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
									{/if}
								</button>
								<div class="vol-slider">
									<input type="range" min="0" max="2" step="0.05" value={muted ? 0 : volume} oninput={setVol} />
								</div>
							</div>

							{#if liveMode}
								{#if liveBehind > 15}
									<button type="button" class="go-live" onclick={goLive} title="Back to live">{fmt(liveBehind)} behind · Go live</button>
								{:else}
									<span class="time-display live-now"><span class="live-dot"></span>Live</span>
								{/if}
							{:else}
								<span class="time-display">{fmt(seekPreview >= 0 ? seekPreview / 100 * duration : seekTarget >= 0 ? seekTarget / 100 * duration : currentTime)} / {fmt(duration)}</span>
							{/if}

							<div class="ctrl-spacer"></div>

							{#if subtitlesOn}
								<div class="delay-wrap">
									<button
										class="ctrl-btn"
										class:active={showDelay}
										onclick={() => { showDelay = !showDelay; showCaptions = false; showSettings = false; showAudioPicker = false; }}
										title="Subtitle delay ({subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s)"
									>
										<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M13.5 5.5C10.5 5.5 8 8 8 11H5l3.5 4L12 11H9.5c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4c-.9 0-1.7-.3-2.4-.8l-1.1 1.3c1 .7 2.2 1.1 3.5 1.1 3 0 5.5-2.5 5.5-5.5S16.5 5.5 13.5 5.5z"/></svg>
									</button>
									{#if showDelay}
										<div class="delay-popup">
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay - 5) * 10) / 10} title="Push subs 5 seconds later">−5s</button>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay - 0.5) * 10) / 10} title="Subs appear before audio — push them later">−0.5s</button>
											<span class="delay-label">Before audio</span>
											<span class="sub-delay-value">{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s</span>
											<span class="delay-label">After audio</span>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay + 0.5) * 10) / 10} title="Subs appear after audio — push them earlier">+0.5s</button>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay + 5) * 10) / 10} title="Push subs 5 seconds earlier">+5s</button>
											<button class="sub-delay-reset" onclick={resetSubtitleDelay} title={subAutoSync ? 'Back to the auto-timing delay' : 'No delay'}>Reset</button>
										</div>
									{/if}
								</div>
							{/if}

							{#if hlsAudioTracks.length > 1}
								<button
									class="ctrl-btn"
									class:active={showAudioPicker}
									onclick={() => { showAudioPicker = !showAudioPicker; showCaptions = false; showSettings = false; showDelay = false; }}
									title="Audio track"
								>
									<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
								</button>
							{/if}

							<button
								class="ctrl-btn"
								class:active={subtitlesOn}
								onclick={() => {
									// An empty list is usually a lookup that failed; opening the menu asks again.
									if (!showCaptions && febboxSubs.length === 0 && !loadingSubs) fetchSubtitles();
									showCaptions = !showCaptions; showSettings = false; showDelay = false; showAudioPicker = false;
								}}
								title="Subtitles"
							>
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
							</button>

							<button
								class="ctrl-btn"
								class:active={showSettings}
								onclick={() => { showSettings = !showSettings; showCaptions = false; showDelay = false; showAudioPicker = false; }}
								title="Settings"
							>
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>
							</button>

							<button class="ctrl-btn pip-btn" onclick={togglePiP} title="Picture in picture">
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>
							</button>

							<button class="ctrl-btn fs-btn" onclick={toggleFS} title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}>
								{#if isFullscreen}
									<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
								{:else}
									<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
								{/if}
							</button>
						</div>
					</div>

					<!-- settings popup -->
					{#if showSettings}
						<div class="popup popup-settings">
							{#if hlsLevels.length > 1}
								<p class="popup-label">Resolution <span class="popup-hint" title="Higher resolutions may buffer on slower connections">?</span></p>
								{#each [...hlsLevels].sort((a, b) => b.height - a.height) as lvl (lvl.index)}
									<button
										class="popup-item"
										class:active={hlsActiveLevel === lvl.index}
										onclick={() => { setHlsLevel(lvl.index); showSettings = false; }}
									>
										{#if hlsActiveLevel === lvl.index}<span class="popup-check">&#10003;</span>{/if}
										{lvl.height}p
										<span class="popup-sub">{lvl.bitrate > 1_000_000 ? `${(lvl.bitrate / 1_000_000).toFixed(1)} Mbps` : `${Math.round(lvl.bitrate / 1000)} kbps`}</span>
									</button>
								{/each}
							{:else if videoResolution}
								<hr class="popup-divider" />
								<p class="popup-label">Playing at</p>
								<p class="popup-item popup-info">{videoResolution}</p>
							{/if}
							{#if debugInfo}
								<hr class="popup-divider" />
								<p class="popup-label">Stream info
									<button type="button" class="copy-debug-btn" onclick={() => navigator.clipboard.writeText(debugInfo)}>Copy</button>
								</p>
								<p class="popup-item popup-info" style="font-size:0.72rem;word-break:break-all">{debugInfo.length > 80 ? debugInfo.slice(0, 80) + '…' : debugInfo}</p>
							{/if}
							{#if activeFile}
								<hr class="popup-divider" />
								<p class="popup-label">File</p>
								<p class="popup-item popup-info file-name-info">{#each parseFileTokens(activeFile.name) as tok}{#if tok.tip}<span class="file-token" data-tip={tok.tip}>{tok.text}</span>{:else}{tok.text}{/if}{/each} ({activeFile.size ? `${activeFile.size} · ` : ''}{activeFile.source ?? 'Showbox'})</p>
							{/if}
							<hr class="popup-divider" />
							<button class="popup-item" onclick={toggleStats}>Playback stats: {showStats ? 'On' : 'Off'}</button>
							<hr class="popup-divider" />
							<p class="popup-label">Speed</p>
							{#each SPEEDS as s (s.value)}
								<button
									class="popup-item"
									class:active={playbackRate === s.value}
									onclick={() => setRate(s.value)}
								>
									{#if playbackRate === s.value}<span class="popup-check">&#10003;</span>{/if}
									{s.label}
								</button>
							{/each}
							<hr class="popup-divider" />
							<p class="popup-label">Aspect ratio</p>
							<button class="popup-item" class:active={videoFit === 'contain'} onclick={() => chooseFit('contain')}>
								{#if videoFit === 'contain'}<span class="popup-check">&#10003;</span>{/if}
								Fit
								<span class="popup-sub">Black bars on sides</span>
							</button>
							<button class="popup-item" class:active={videoFit === 'cover'} onclick={() => chooseFit('cover')}>
								{#if videoFit === 'cover'}<span class="popup-check">&#10003;</span>{/if}
								Fill
								<span class="popup-sub">Fills the screen, may crop</span>
							</button>
							<hr class="popup-divider" />
							<p class="popup-label">Other</p>
							<button class="popup-item" onclick={() => { wrongShow(); showSettings = false; }}>
								Wrong one?
								<span class="popup-sub">Go back to search results</span>
							</button>
						</div>
					{/if}

					<!-- audio track popup -->
					{#if showAudioPicker && hlsAudioTracks.length > 1}
						<div class="popup popup-audio">
							<p class="popup-label">Audio Track</p>
							{#each hlsAudioTracks as t (t.id)}
								<button
									class="popup-item"
									class:active={hlsActiveAudio === t.id}
									onclick={() => { setAudioTrack(t.id); showAudioPicker = false; }}
								>
									{#if hlsActiveAudio === t.id}<span class="popup-check">&#10003;</span>{/if}
									{t.name}
								</button>
							{/each}
						</div>
					{/if}

					<!-- captions popup -->
					{#if showCaptions}
						<div class="popup popup-captions">
							<!-- On the TV the timing is here, in the captions menu (its own button is hidden there). -->
							{#if tvMode && subtitlesOn}
								<p class="popup-label">Timing</p>
								<div class="tv-delay">
									<button class="sub-delay-jump" onclick={() => (subtitleDelay = Math.round((subtitleDelay - 0.5) * 10) / 10)}>Sooner −0.5s</button>
									<span class="sub-delay-value">{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s</span>
									<button class="sub-delay-jump" onclick={() => (subtitleDelay = Math.round((subtitleDelay + 0.5) * 10) / 10)}>Later +0.5s</button>
									{#if subtitleDelay !== 0}<button class="sub-delay-reset" onclick={resetSubtitleDelay}>Reset</button>{/if}
								</div>
								<hr class="popup-divider" />
							{/if}
							<p class="popup-label">Subtitles</p>
							<button
								class="popup-item"
								class:active={!subtitlesOn}
								onclick={() => { subtitlesOn = false; showCaptions = false; keepCaptionsOff(true); }}
							>
								{#if !subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
								Off
							</button>
							{#if subtitleCues.length > 0}
								<button
									class="popup-item"
									class:active={subtitlesOn}
									onclick={() => { subtitlesOn = true; showCaptions = false; keepCaptionsOff(false); }}
								>
									{#if subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
									{activeSubFileName || 'Loaded subtitle'}
								</button>
							{/if}
							{#if sportsMode && !liveCaptions}
								<span class="popup-item" style="opacity:0.6;cursor:default">{liveMode ? 'No captions from this channel yet' : 'This replay has no captions'}</span>
							{/if}
							{#if febboxSubs.length > 0 || loadingSubs}
								<hr class="popup-divider" />
								{#if loadingSubs}
									<span class="popup-item" style="opacity:0.5;cursor:default">Finding subtitles...</span>
								{:else}
									{#each Object.entries(subsByLanguage) as [lang, subs] (lang)}
										<p class="sub-lang-label">{lang}</p>
										<!-- Five at first (and the one in use), so Look isn't a long scroll away. -->
										{#each allSubsShown ? subs : subs.filter((s, i) => i < 5 || s.id === activeSubFid) as sub (sub.id)}
											<button
												class="popup-item"
												class:active={activeSubFid === sub.id && subtitlesOn}
												onclick={() => {
													keepCaptionsOff(false);
													if (sub.check) passNexusCheck();
													else loadSub(sub).then((ok) => { if (!ok) showQualityToast("Those subtitles couldn't be loaded. Try another."); });
												}}
												title={sub.fileName || sub.language}
											>
												{#if activeSubFid === sub.id && subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
												<span class="sub-name-row">
													<span class="sub-name-text">{sub.check && nexusChecking ? 'Waiting for anime.nexus…' : sub.fileName || sub.language}</span>
													{#if sub.source}<span class="sub-source-badge">{sub.source}</span>{/if}
												</span>
											</button>
										{/each}
									{/each}
									{#if !allSubsShown && Object.values(subsByLanguage).some((subs) => subs.length > 5)}
										<button class="popup-item more-languages" onclick={() => (allSubsShown = true)}>Show more</button>
									{/if}
								{/if}
							{/if}
							{#if !loadingSubs && otherLanguages.length > 0}
								<hr class="popup-divider" />
								<button class="popup-item more-languages" onclick={() => (showMoreLanguages = !showMoreLanguages)}>
									More languages
									<svg class="file-arrow" class:open={showMoreLanguages} viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
								</button>
								{#if showMoreLanguages}
									{#each otherLanguages as language (language)}
										<button class="popup-item language-option" class:active={subLanguages.includes(language)} onclick={() => toggleSubLanguage(language)}>
											{#if subLanguages.includes(language)}<span class="popup-check">&#10003;</span>{/if}
											{language}
										</button>
									{/each}
								{/if}
							{/if}
							<hr class="popup-divider" />
							<p class="popup-label">Look</p>
							{#if !sportsMode}
								<div class="sub-look">
									<button class="sub-delay-jump" class:on={subAutoSync} onclick={toggleAutoSync}>
										{subAutoSync ? 'Auto-timing: On' : 'Auto-timing: Off'}
									</button>
								</div>
							{/if}
							<div class="sub-look">
								<button class="sub-delay-jump" class:on={subLook.box} onclick={() => setSubLook({ box: !subLook.box })}>
									{subLook.box ? 'Dark box: On' : 'Dark box: Off'}
								</button>
								<button class="sub-delay-jump" class:on={subLook.bold} onclick={() => setSubLook({ bold: !subLook.bold })}>
									{subLook.bold ? 'Bold: On' : 'Bold: Off'}
								</button>
								{#each SUB_SIZES as size (size.key)}
									<button class="sub-delay-jump" class:on={subLook.size === size.key} onclick={() => setSubLook({ size: size.key })}>{size.label}</button>
								{/each}
							</div>
							<!-- Not on the TV: there's no picking a file there. -->
							{#if !tvMode && !sportsMode}
								<hr class="popup-divider" />
								<button class="popup-item" onclick={uploadSubtitle}>
									<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="flex:none;opacity:0.6"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
									Upload subtitle file
								</button>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			{#if castOpen}
				<aside class="sidebar cast-sidebar">
					<h3 class="cast-heading">{pm ? p('Cast') : 'Cast'}</h3>
					{#if loadingCast}
						<p class="cast-loading">{pm ? pRandom() : 'Loading cast...'}</p>
					{:else if castMembers.length === 0}
						<p class="cast-loading">No cast info found.</p>
					{:else}
						<ul class="cast-list">
							{#each castMembers as member (member.name + member.character)}
								<li class="cast-item">
									<a href="/person/tmdb:{member.id}?back={encodeURIComponent(page.url.pathname + page.url.search)}" class="cast-link">
										<div class="cast-photo">
											{#if member.photo}
												<img src={member.photo} alt="" loading="lazy" />
											{:else}
												<span class="cast-fallback">?</span>
											{/if}
										</div>
										<div class="cast-info">
											<span class="cast-name">{member.name}</span>
											<span class="cast-char">{member.character}</span>
										</div>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</aside>
			{/if}
		</div>
	</div>
{:else if loading || resolving}
	<!-- ============================================================= LOADING -->
	<BackBar />
	<div class="loading-page">
		<div class="spinner"></div>
		<p>{loadingStatus || (pm ? pRandom() : `Loading ${videoTitle || 'video'}...`)}</p>
	</div>
{:else}
	<!-- ============================================================= SEARCH VIEW -->
	<BackBar />

	{#if problem}
		<div class="problem-page">
			<p class="msg bad" role="alert">{problem}</p>
			{#if resolveFailed && lastResolveArgs}
				{@const args = lastResolveArgs}
				<button type="button" class="btn" onclick={() => resolve(args.title, args.type, args.year)}>Try again</button>
			{/if}
			{#if debugInfo}
				<details class="debug-details">
					<summary>Details</summary>
					<pre class="debug-pre">{debugInfo}</pre>
				</details>
			{/if}
		</div>
	{/if}

	{#if !problem}
		<header class="masthead"><h1>{pm ? 'ARE YOU DUMB lets watch' : 'Watch'}</h1></header>

		<div class="toolbar">
			<input
				type="search"
				placeholder={pm ? "whats the giblet called..." : "Search for a movie or show..."}
				bind:value={query}
				aria-label={pm ? "find a giblet to watch" : "Search for media"}
			/>
		</div>

		{#if searching}
			<p class="muted searching">{pm ? pRandom() : 'Searching...'}</p>
		{:else if results.length > 0}
			<ul class="grid">
				{#each results as result (`${result.type}:${result.id || result.slug || result.title}`)}
					<li>
						<button type="button" class="card" disabled={resolving} onclick={() => watchResult(result)}>
							<div class="poster">
								{#if result.posterUrl}
									<img src={result.posterUrl} alt="" loading="lazy" />
								{:else}
									<span class="fallback" aria-hidden="true">?</span>
								{/if}
								<span class="kind">{result.type === 'tv' ? 'TV' : 'Film'}</span>
							</div>
							<h3 class="name">{result.title}</h3>
							<p class="sub faint">{result.info}</p>
						</button>
					</li>
				{/each}
			</ul>
		{:else if searched}
			<p class="empty-msg muted">Nothing found for that.</p>
		{:else if !page.url.searchParams.get('title')}
			<div class="empty">
				<h2>Search for something to watch</h2>
				<p class="muted">Find a movie or show, then watch it right here.</p>
			</div>
		{/if}
	{/if}
{/if}

<style>
	/* On the TV: only what a remote needs. The TV's own remote does the volume, the picture is
	   always full screen, and Autosync keeps the library up to date by itself. */
	:global(html.tv) .cast-btn,
	:global(html.tv) .autosync-btn,
	:global(html.tv) .in-library-btn,
	:global(html.tv) .mark-watched-btn,
	:global(html.tv) .add-btn,
	:global(html.tv) .vol-group,
	:global(html.tv) .pip-btn,
	:global(html.tv) .fs-btn,
	:global(html.tv) .delay-wrap {
		display: none;
	}

	/* The TV's subtitle timing, at the top of the captions menu: big enough to read across the room. */
	.tv-delay { display: flex; align-items: center; gap: 10px; padding: 6px 14px 10px; white-space: nowrap; }
	.tv-delay .sub-delay-jump { padding: 8px 14px; font-size: 0.95rem; border-radius: 16px; }
	.tv-delay .sub-delay-jump:focus { background: #fff; color: #000; outline: none; }
	.tv-delay .sub-delay-value { font-size: 1.05rem; min-width: 56px; }
	.tv-delay .sub-delay-reset { padding: 6px 12px; font-size: 0.85rem; }
	.tv-delay .sub-delay-reset:focus { border-color: #fff; color: #fff; outline: none; }

	/* --------------------------------------------------------- loading / search */
	.loading-page { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 120px 20px; text-align: center; color: var(--ink-soft); }
	.spinner { width: 36px; height: 36px; border: 3px solid var(--rule); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.problem-page { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 60px 20px 30px; text-align: center; }
	.debug-details { max-width: 520px; width: 100%; text-align: left; }
	.debug-details summary { font-size: 0.82rem; color: var(--ink-faint); cursor: pointer; }
	.debug-pre { font-size: 0.76rem; color: var(--ink-faint); background: var(--sunk); border: 1px solid var(--rule); border-radius: var(--radius-sm); padding: 10px 12px; white-space: pre-wrap; word-break: break-all; margin-top: 6px; }
	.masthead { margin-bottom: 18px; }
	.masthead h1 { font-size: clamp(1.5rem, 4vw, 2rem); }
	.toolbar { margin-bottom: 20px; }
	.toolbar input { width: 100%; }
	.msg { border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 9px 13px; margin: 0 0 18px; font-size: 0.88rem; color: var(--accent); background: var(--surface); max-width: 480px; }
	.searching { margin: 24px 0; text-align: center; }
	.grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 24px 16px; }
	.card { display: flex; flex-direction: column; gap: 7px; width: 100%; padding: 0; background: none; border: none; text-align: left; cursor: pointer; }
	.card:disabled { opacity: 0.6; cursor: wait; }
	.poster { position: relative; aspect-ratio: 2 / 3; background: var(--surface-2); border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; display: grid; place-items: center; transition: border-color 0.14s ease, transform 0.14s ease; }
	.card:hover .poster { border-color: var(--accent); transform: translateY(-2px); }
	.poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.fallback { font-size: 1.8rem; opacity: 0.4; }
	.kind { position: absolute; top: 6px; left: 6px; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--sunk); color: var(--ink-soft); border: 1px solid var(--rule); text-transform: uppercase; }
	.name { font-family: var(--body); font-size: 0.9rem; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
	.sub { font-size: 0.78rem; margin: 0; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 72px 20px; border: 1px dashed var(--rule-firm); border-radius: var(--radius); }
	.empty h2 { font-size: 1.3rem; }
	.empty-msg { margin-top: 34px; text-align: center; }

	/* --------------------------------------------------------- player page (full viewport) */
	.player-page { position: fixed; inset: 0; display: flex; flex-direction: column; z-index: 100; background: #000; }

	/* ---------------------------------------------------------------- the mini player */
	/*
	 * Its own player, with every control the big one has (a friend found only mute, not the
	 * volume, and no subtitles: 2026-10-25), sized for a small window. The top bar is its own
	 * strip (title, the copy playing, back to Catalog, close); fullscreen and picture in picture
	 * are what the mini player already is.
	 */
	.player-page.mini .player-bar,
	.player-page.mini .player-error,
	.player-page.mini .pip-btn,
	.player-page.mini .fs-btn { display: none; }
	.player-page.mini .controls { padding: 18px 8px 4px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.6)); }
	.player-page.mini .ctrl-row { gap: 0; }
	.player-page.mini .ctrl-btn { padding: 4px; }
	.player-page.mini .vol-group:hover .vol-slider { width: 76px; padding-right: 4px; }
	.player-page.mini .vol-slider input[type='range'] { width: 70px; }
	/* Menus fit the window, and scroll when they're longer. */
	.player-page.mini .popup { bottom: 44px; right: 6px; max-height: calc(100vh - 84px); max-width: calc(100vw - 12px); min-width: 0; }
	.player-page.mini .popup-files.popup-files { top: calc(100% + 2px); bottom: auto; left: auto; right: 0; max-height: calc(100vh - 50px); }
	.player-page.mini .delay-popup { right: -40px; padding: 6px 8px; gap: 4px; }
	.player-page.mini .delay-popup .delay-label { display: none; }
	.player-page.mini .mini-top .file-pick-wrap { -webkit-app-region: no-drag; }
	.player-page.mini .mini-top .file-pick-btn { padding: 3px 8px; font-size: 0.74rem; }
	@media (max-width: 430px) {
		.player-page.mini .time-display { display: none; }
	}
	.player-page.mini .time-display { font-size: 0.78rem; }
	.player-page.mini .subtitle-display { font-size: 0.95rem !important; }
	.player-page.mini .next-ep-overlay { transform: scale(0.75); transform-origin: bottom right; }
	/* The top edge moves the window (the buttons in it still click). */
	.mini-top {
		position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 12;
		display: flex; align-items: center; gap: 4px; padding: 0 6px 0 10px;
		background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
		opacity: 0; transition: opacity 0.3s ease;
		-webkit-app-region: drag;
	}
	.mini-top.visible { opacity: 1; }
	.mini-title { flex: 1; min-width: 0; font-size: 0.78rem; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.mini-btn {
		-webkit-app-region: no-drag;
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; border: none; border-radius: 6px;
		background: transparent; color: #fff; cursor: pointer;
	}
	.mini-btn:hover { background: rgba(255, 255, 255, 0.15); }

	/* --------------------------------------------------------- top bar */
	.player-bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: rgba(0, 0, 0, 0.8); border-bottom: 1px solid rgba(255, 255, 255, 0.08); z-index: 20; transition: opacity 0.3s ease, transform 0.3s ease; }
	.playback-stats {
		position: absolute;
		top: 64px;
		left: 16px;
		z-index: 15;
		padding: 10px 12px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.72);
		color: #fff;
		font: 0.78rem/1.55 var(--mono);
		pointer-events: none;
		max-width: min(520px, calc(100% - 32px));
	}
	.playback-stats span {
		display: inline-block;
		min-width: 9.5em;
		opacity: 0.65;
	}
	/* Big enough to read in a photo of the TV, and below the "Keeps stopping" choice. */
	:global(html.tv) .playback-stats { top: 130px; font-size: 1.15rem; max-width: min(900px, calc(100% - 32px)); }
	.player-bar.bar-hidden { opacity: 0; pointer-events: none; transform: translateY(-100%); }
	.bar-btn { flex: none; font-size: 0.82rem; font-weight: 600; padding: 5px 12px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.06); color: #e0e0e0; cursor: pointer; text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
	.bar-btn:hover { border-color: rgba(255, 255, 255, 0.3); color: #fff; }
	.player-title { flex: 1; font-size: 1rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; }
	.player-error { position: absolute; top: 45px; left: 0; right: 0; z-index: 15; margin: 0; padding: 6px 16px; font-size: 0.82rem; color: var(--accent); background: rgba(24, 8, 11, 0.9); border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
	.retry-btn { margin-left: 10px; padding: 2px 12px; font-size: 0.78rem; font-weight: 600; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: none; color: var(--accent); cursor: pointer; }
	.retry-btn:hover { background: rgba(255, 255, 255, 0.06); }
	.quality-toast { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 80; padding: 14px 28px; border-radius: 10px; background: rgba(0, 0, 0, 0.85); color: #fff; font-size: 1rem; text-align: center; pointer-events: none; animation: toast-fade 5s ease-in-out forwards; }
	@keyframes toast-fade { 0% { opacity: 0; } 8% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
	.file-pick-wrap { position: relative; flex: none; }
	.file-pick-btn { font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
	.file-arrow { flex: none; opacity: 0.7; transition: transform 0.15s; }
	.more-languages .file-arrow { margin-left: auto; }
	.language-option { padding-left: 28px; }
	.file-arrow.open { transform: rotate(180deg); }
	.popup-files.popup-files { position: absolute; top: calc(100% + 4px); left: 0; right: auto; bottom: auto; min-width: 180px; z-index: 25; }
	.file-name-info { font-size: 0.7rem; white-space: normal; word-break: break-all; overflow: visible; }

	.episodes-btn { font-size: 0.78rem; }
	.login-btn { color: var(--accent); border-color: var(--accent); font-size: 0.78rem; }
	.add-btn { background: var(--good); color: #fff; border-color: var(--good); cursor: pointer; }
	.add-btn:hover { filter: brightness(1.12); color: #fff; }
	.add-btn:disabled { opacity: 0.6; cursor: wait; }
	.in-library-btn { color: var(--good); border-color: var(--good); text-decoration: none; }
	.in-library-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--good); }
	.autoplay-btn { font-size: 0.78rem; cursor: pointer; }
	.autoplay-btn.active { color: var(--accent); border-color: var(--accent); }
	.autoplay-btn:hover { background: rgba(255, 255, 255, 0.06); }
	.ep-ctx-backdrop { position: fixed; inset: 0; z-index: 900; }
	.ep-ctx-menu {
		position: fixed;
		z-index: 901;
		min-width: 210px;
		padding: 4px 0;
		background: #1c1c1e;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 8px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
	}
	.ep-ctx-menu button {
		display: block;
		width: 100%;
		padding: 8px 14px;
		border: none;
		background: none;
		color: #eee;
		text-align: left;
		font-size: 0.86rem;
		cursor: pointer;
	}
	.ep-ctx-menu button:hover { background: var(--accent); color: var(--accent-ink, #fff); }
	.ep-ctx-menu hr { border: none; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 4px 0; }
	.mark-watched-btn { color: var(--accent); border-color: var(--accent); cursor: pointer; }
	.mark-watched-btn:hover { background: rgba(255, 255, 255, 0.06); }

	/* --------------------------------------------------------- player body */
	/* The video uses the whole screen, under the top bar (which hides while playing); only the
	   side panels start below the bar. */
	.player-body { display: flex; flex: 1; min-height: 0; }

	/* --------------------------------------------------------- sidebar */
	.sidebar { margin-top: 45px; width: 240px; flex: none; display: flex; flex-direction: column; background: rgba(0, 0, 0, 0.75); border-right: 1px solid rgba(255, 255, 255, 0.06); overflow: hidden; }
	.season-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
	.season-tab { padding: 4px 10px; font-size: 0.76rem; font-weight: 600; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: var(--radius-sm); background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.6); cursor: pointer; }
	.season-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
	.season-tab:hover:not(.active) { border-color: rgba(255, 255, 255, 0.25); }
	.episode-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
	.ep-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 14px; border: none; background: none; color: rgba(255, 255, 255, 0.8); cursor: pointer; text-align: left; font-size: 0.84rem; }
	.ep-btn:hover { background: rgba(255, 255, 255, 0.06); }
	.ep-btn.playing { background: rgba(217, 122, 131, 0.15); color: var(--accent); }
	.ep-btn.watched { color: rgba(255, 255, 255, 0.45); border-left: 3px solid var(--good, #4caf50); background: rgba(76, 175, 80, 0.07); }
	.ep-btn.partial { border-left: 3px solid var(--accent); }
	.ep-btn:disabled { opacity: 0.5; cursor: wait; }
	.ep-num { font-weight: 700; min-width: 2.2em; }
	.ep-li { position: relative; }
	.ep-btn.unavailable { opacity: 0.4; cursor: default; }
	.ep-btn.unavailable:hover { background: none; }
	.ep-missing { margin-left: auto; font-size: 0.72rem; white-space: nowrap; }

	/* --------------------------------------------------------- cast sidebar */
	.cast-sidebar { padding: 0; }
	.cast-heading { font-size: 0.82rem; font-weight: 700; color: rgba(255, 255, 255, 0.7); margin: 0; padding: 12px 14px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
	.cast-loading { font-size: 0.8rem; color: rgba(255, 255, 255, 0.4); padding: 16px 14px; margin: 0; }
	.cast-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
	.cast-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
	.cast-photo { width: 48px; height: 64px; border-radius: 6px; overflow: hidden; flex: none; background: rgba(255, 255, 255, 0.06); display: grid; place-items: center; }
	.cast-photo img { width: 100%; height: 100%; object-fit: cover; }
	.cast-fallback { font-size: 0.9rem; color: rgba(255, 255, 255, 0.25); }
	.cast-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
	.cast-name { font-size: 0.88rem; font-weight: 600; color: rgba(255, 255, 255, 0.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cast-char { font-size: 0.76rem; color: rgba(255, 255, 255, 0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cast-sidebar { border-right: none; border-left: 1px solid rgba(255, 255, 255, 0.06); }
	.cast-btn.active { color: var(--accent); border-color: var(--accent); }
	.cast-link { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; width: 100%; }
	.cast-item:hover { background: rgba(255, 255, 255, 0.06); }
	.cast-item:hover .cast-name { color: var(--accent); }

	/* --------------------------------------------------------- video area */
	.video-area { position: relative; flex: 1; background: #000; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.player-page.hide-cursor, .player-page.hide-cursor * { cursor: none !important; }

	.video-area video { width: 100%; height: 100%; display: block; outline: none; }
	.video-area video.buffering { opacity: 0.3; }
	.video-area video.old-picture { opacity: 0; }

	.hidden-webview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden; }

	.player-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; font-size: 0.9rem; color: #888; z-index: 1; }

	.login-prompt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #aaa; font-size: 0.95rem; text-align: center; padding: 40px 20px; width: 100%; }
	.login-action { font-size: 0.95rem; font-weight: 600; padding: 10px 28px; border-radius: var(--radius-sm); border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
	.login-action:hover { filter: brightness(1.12); }

	/* --------------------------------------------------------- click layer */
	.click-layer { position: absolute; inset: 0; z-index: 1; cursor: pointer; }

	/* --------------------------------------------------------- subtitle overlay */
	.subtitle-display { position: absolute; bottom: 80px; left: 10%; right: 10%; text-align: center; color: #fff; font-size: 1.4rem; line-height: 1.5; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.7); pointer-events: none; z-index: 5; background: rgba(0, 0, 0, 0.5); padding: 6px 16px; border-radius: 4px; width: fit-content; margin: 0 auto; }
	.subtitle-display.top { top: 60px; bottom: auto; }
	/* No box: white text with a dark outline all round, so it reads on any picture. */
	.subtitle-display.bold { font-weight: 700; }
	.subtitle-display.plain { background: none; padding: 0 16px; text-shadow: 0 0 3px #000, 0 0 3px #000, 1px 1px 2px #000, -1px -1px 2px #000, 0 2px 8px rgba(0, 0, 0, 0.8); }
	.sub-look { display: flex; align-items: center; gap: 6px; padding: 4px 14px 8px; flex-wrap: wrap; }
	.sub-look .sub-delay-jump.on { background: rgba(255, 255, 255, 0.3); }
	.sub-look .sub-delay-jump:focus { background: #fff; color: #000; outline: none; }
	:global(html.tv) .sub-look .sub-delay-jump { padding: 8px 14px; font-size: 0.95rem; border-radius: 16px; }

	/* --------------------------------------------------------- PiP placeholder */
	.pip-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--ink-faint); font-size: 1.1rem; pointer-events: none; z-index: 2; background: #000; }

	/* --------------------------------------------------------- controls overlay */
	.controls { position: absolute; bottom: 0; left: 0; right: 0; padding: 40px 16px 14px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); opacity: 0; transition: opacity 0.3s ease; pointer-events: none; z-index: 10; }
	.controls.visible { opacity: 1; pointer-events: auto; }

	/* --------------------------------------------------------- progress bar */
	.progress-wrap { position: relative; padding: 8px 0; cursor: pointer; outline: none; }
	/* Highlighted with the remote: thicker, with its handle showing. */
	.progress-wrap:focus .progress-bar { height: 8px; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); }
	.progress-wrap:focus .prog-handle { opacity: 1; }
	.prog-was { position: absolute; top: -6px; bottom: -6px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55); pointer-events: none; z-index: 2; }
	.prog-was-time { position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); padding: 1px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.8); color: #fff; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
	/* The picture of where the mouse is on the bar, with its time. */
	.scrub-preview { position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; z-index: 3; }
	.scrub-preview canvas { width: 168px; height: 94.5px; border-radius: 4px; border: 2px solid rgba(255, 255, 255, 0.85); background: #111; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6); }
	.scrub-time { padding: 2px 7px; border-radius: 4px; background: rgba(0, 0, 0, 0.8); color: #fff; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
	.progress-bar { position: relative; height: 3px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; transition: height 0.1s; }
	.progress-wrap:hover .progress-bar { height: 5px; }
	.prog-held { position: absolute; top: 0; bottom: 0; background: rgba(255, 255, 255, 0.13); pointer-events: none; }
	.prog-buffered { position: absolute; top: 0; left: 0; bottom: 0; background: rgba(255, 255, 255, 0.25); border-radius: inherit; pointer-events: none; }
	.prog-played { position: absolute; top: 0; left: 0; bottom: 0; background: var(--accent, #d97a83); border-radius: inherit; pointer-events: none; }
	.prog-segment { position: absolute; top: 0; bottom: 0; background: rgba(255, 210, 90, 0.8); pointer-events: none; }
	.prog-handle { position: absolute; top: 50%; width: 14px; height: 14px; background: var(--accent, #d97a83); border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; opacity: 0; transition: opacity 0.15s; }
	.prog-handle.dragging { opacity: 1; }
	.progress-wrap:hover .prog-handle { opacity: 1; }

	/* --------------------------------------------------------- control row */
	.ctrl-row { display: flex; align-items: center; gap: 4px; }
	.ctrl-btn { background: none; border: none; color: rgba(255, 255, 255, 0.85); padding: 6px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; justify-content: center; flex: none; transition: color 0.15s, background 0.15s; }
	.ctrl-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
	.ctrl-btn.active { color: var(--accent, #d97a83); }

	.vol-group { display: flex; align-items: center; gap: 0; }
	.vol-slider { width: 0; overflow: hidden; transition: width 0.2s ease; padding-right: 0; }
	.vol-group:hover .vol-slider { width: 138px; padding-right: 8px; }
	.vol-slider input[type='range'] { width: 130px; height: 4px; -webkit-appearance: none; appearance: none; background: rgba(255, 255, 255, 0.25); border-radius: 2px; outline: none; cursor: pointer; vertical-align: middle; }
	.vol-slider input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #fff; border-radius: 50%; cursor: pointer; border: none; }

	.time-display { font-size: 0.8rem; color: rgba(255, 255, 255, 0.75); white-space: nowrap; font-variant-numeric: tabular-nums; padding: 0 6px; user-select: none; }
	.ctrl-spacer { flex: 1; }

	/* --------------------------------------------------------- popups (settings / captions) */
	/* No background blur over the video anywhere here: on a Mac it stopped menus redrawing while
	   subtitles changed underneath (they vanished until the mouse went over them). Own layer too. */
	.popup { transform: translateZ(0); position: absolute; bottom: 60px; right: 16px; background: rgba(18, 18, 18, 0.96); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 0; min-width: 190px; max-width: min(420px, 50vw); max-height: 400px; overflow-y: auto; z-index: 20; }
	.popup-label { display: flex; align-items: center; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255, 255, 255, 0.4); margin: 0; padding: 8px 16px 4px; }
	.popup-item { display: flex; align-items: center; gap: 8px; padding: 7px 16px; font-size: 0.84rem; color: rgba(255, 255, 255, 0.8); cursor: pointer; border: none; background: none; width: 100%; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.popup-item:hover { background: rgba(255, 255, 255, 0.08); }
	.popup-item.active { color: var(--accent, #d97a83); }
	.popup-check { font-size: 0.8rem; min-width: 14px; }
	.popup-sub { font-size: 0.72rem; color: rgba(255, 255, 255, 0.35); margin-left: auto; }
	.popup-hint { font-size: 0.65rem; color: rgba(255, 255, 255, 0.3); cursor: help; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; margin-left: 4px; }
	.copy-debug-btn { margin-left: auto; padding: 1px 8px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; background: none; color: rgba(255, 255, 255, 0.5); font-size: 0.65rem; cursor: pointer; }
	.copy-debug-btn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
	.popup-info { cursor: default; font-size: 0.85rem; color: rgba(255, 255, 255, 0.5); }
	.popup-divider { border: none; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 6px 0; }

	/* --------------------------------------------------------- file name tooltips */
	.file-token { position: relative; cursor: help; text-decoration: underline; text-decoration-style: dotted; text-decoration-color: rgba(255, 255, 255, 0.3); text-underline-offset: 2px; }
	.file-token:hover { text-decoration-color: rgba(255, 255, 255, 0.6); }
	.file-token:hover::after { content: attr(data-tip); position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: normal; max-width: 300px; width: max-content; text-align: center; background: rgba(0, 0, 0, 0.95); color: #ddd; padding: 5px 10px; border-radius: 4px; font-size: 0.72rem; font-weight: 400; pointer-events: none; z-index: 100; border: 1px solid rgba(255, 255, 255, 0.12); }

	/* --------------------------------------------------------- episode names */
	.ep-name { flex: 1; min-width: 0; font-weight: 400; font-size: 0.78rem; color: rgba(255, 255, 255, 0.55); line-height: 1.4; }
	.ep-btn.playing .ep-name { color: var(--accent); opacity: 0.8; }

	/* --------------------------------------------------------- subtitle language groups */
	.sub-lang-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.5); margin: 0; padding: 6px 16px 2px; }
	.sub-name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
	.sub-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
	.sub-source-badge { flex: none; font-size: 0.62rem; padding: 1px 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.4) !important; text-transform: uppercase; letter-spacing: 0.03em; border: 1px solid rgba(255, 255, 255, 0.1); }

	/* --------------------------------------------------------- subtitle delay */
	.delay-wrap { position: relative; }
	.delay-popup { position: absolute; bottom: calc(100% + 10px); right: -60px; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(20, 20, 20, 0.95); border-radius: 8px; white-space: nowrap; }
	.sub-delay-jump { padding: 4px 8px; font-size: 0.72rem; font-weight: 600; background: rgba(255, 255, 255, 0.1); border: none; border-radius: 12px; color: white; cursor: pointer; }
	.sub-delay-jump:hover { background: rgba(255, 255, 255, 0.2); }
	.sub-delay-value { font-size: 0.82rem; font-variant-numeric: tabular-nums; min-width: 48px; text-align: center; color: rgba(255, 255, 255, 0.85); }
	.sub-delay-reset { background: none; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: rgba(255, 255, 255, 0.6); font-size: 0.72rem; padding: 2px 8px; cursor: pointer; }
	.sub-delay-reset:hover { color: white; border-color: rgba(255, 255, 255, 0.4); }
	.delay-label { font-size: 0.62rem; color: rgba(255, 255, 255, 0.35); white-space: nowrap; user-select: none; }

	/* --------------------------------------------------------- buffering spinner */
	.buffering-overlay { position: absolute; inset: 0; display: grid; place-items: center; z-index: 4; pointer-events: none; }
	.slow-offer { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 8px 12px; border-radius: 8px; background: rgba(0, 0, 0, 0.85); color: rgba(255, 255, 255, 0.9); font-size: 0.85rem; max-width: calc(100% - 32px); }
	.slow-offer button { border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.1); color: #fff; border-radius: 6px; padding: 5px 10px; font-size: 0.82rem; cursor: pointer; }
	.slow-offer button:hover, .slow-offer button:focus { background: rgba(255, 255, 255, 0.25); }
	.quality-toast { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: rgba(255, 255, 255, 0.85); font-size: 0.82rem; z-index: 9; pointer-events: none; }

	.scan-badge { position: absolute; top: 50%; left: 50%; z-index: 9; transform: translate(-50%, -50%); padding: 14px 26px; border-radius: 10px; background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 2rem; font-weight: 700; pointer-events: none; }
	:global(html.tv) .next-ep-btn:focus { border-color: #fff; background: #fff; color: #000; outline: none; }
	.next-ep-overlay { position: absolute; bottom: 100px; right: 24px; z-index: 8; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; animation: fadeSlideIn 0.4s ease; }
	.skip-btn { padding: 11px 22px; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s, border-color 0.2s; }
	.skip-btn:hover { background: rgba(30, 30, 30, 0.95); border-color: var(--accent); }
	.next-ep-btn { display: flex; flex-direction: column; gap: 4px; padding: 14px 22px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: #fff; cursor: pointer; transition: background 0.2s, border-color 0.2s; }
	.next-ep-btn:hover { background: rgba(30, 30, 30, 0.95); border-color: var(--accent); }
	.next-ep-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255, 255, 255, 0.6); }
	.next-ep-title { font-size: 0.95rem; font-weight: 600; }
	@keyframes fadeSlideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }

	.buffering-spinner { width: 48px; height: 48px; border: 4px solid rgba(255, 255, 255, 0.15); border-top-color: rgba(255, 255, 255, 0.8); border-radius: 50%; animation: spin 0.8s linear infinite; }

	/* --------------------------------------------------------- responsive */
	@media (max-width: 700px) {
		.sidebar { width: 180px; }
	}

	@media (max-width: 560px) {
		.player-bar { flex-wrap: wrap; gap: 8px; }
		.player-title { order: -1; width: 100%; font-size: 0.9rem; }
		.add-btn { margin-left: 0; flex: 1; text-align: center; }
		.player-body { flex-direction: column; }
		.sidebar { width: 100%; max-height: 200px; border-right: none; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
	}

	/* Live TV in the player. */
	.live-badge {
		flex: none;
		padding: 2px 8px;
		border-radius: 4px;
		background: #d92d3a;
		color: #fff;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
	}
	.live-star :global(.star) { color: rgba(255, 255, 255, 0.85); }
	.live-star :global(.star.saved) { color: var(--star); }
	.live-star :global(.star:hover) { background: rgba(255, 255, 255, 0.15); }
	.replay-badge { background: #4a5a52; }
	.live-now { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
	.live-dot { width: 8px; height: 8px; border-radius: 50%; background: #d92d3a; }
	.go-live {
		padding: 4px 10px;
		border: 1px solid rgba(255, 255, 255, 0.4);
		border-radius: 4px;
		background: transparent;
		color: #fff;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.go-live:hover, .go-live:focus-visible { background: rgba(255, 255, 255, 0.15); }
</style>
