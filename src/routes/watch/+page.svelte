<script lang="ts">
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import Hls from 'hls.js';
	import BackBar from '$lib/BackBar.svelte';
	import { p, pRandom } from '$lib/poison';

	const pm = $derived(page.data.poisonMode);

	interface Result {
		id: number;
		type: 'movie' | 'tv';
		title: string;
		posterUrl: string;
		info: string;
	}

	interface FileOption {
		fid: number;
		quality: string;
		name: string;
		size: string;
	}

	interface Episode {
		season: number;
		episode: number;
		files: FileOption[];
	}

	interface SubOption {
		id: string;
		url: string;
		lang: string;
		language: string;
		fileName: string;
		source?: string;
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
	let showboxId = $state(0);
	let useIframe = $state(false);
	let iframeFid = $state(0);
	let needsLogin = $state(false);
	let loggedIn = $state(false);
	let watchPosterUrl = $state('');
	let hlsInstance: Hls | null = null;

	let movieFiles = $state<FileOption[]>([]);
	let episodes = $state<Episode[]>([]);
	let seasons = $state<number[]>([]);
	let allQualities = $state<string[]>([]);
	let activeSeason = $state(1);
	let activeEpisode = $state<Episode | null>(null);
	let activeQuality = $state('');
	let activeFileFid = $state(0);
	let preferredQuality = $state('1080p');
	let sidebarOpen = $state(true);
	let loadingEpisode = $state(false);
	let changingQuality = $state(false);

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
	let libraryEntryId = $state<number | null>(null);
	let libLastSeason = $state(0);
	let libLastEpisode = $state(0);
	let addingToLibrary = $state(false);
	let watchedEpisodeMap = $state<Map<string, number>>(new Map());
	let skipResume = false;
	let switchingEpisode = false;
	let bufferTimer: ReturnType<typeof setTimeout> | null = null;
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

	let searchTimer: ReturnType<typeof setTimeout>;
	let videoEl: HTMLVideoElement | undefined = $state();

	const seasonEpisodes = $derived(episodes.filter((ep) => ep.season === activeSeason));

	const currentFiles = $derived(
		showType === 'tv' && activeEpisode ? activeEpisode.files : movieFiles
	);

	const availableQualities = $derived(
		[...new Set(currentFiles.map((f) => f.quality).filter(Boolean))].sort(
			(a, b) => parseInt(b) - parseInt(a)
		)
	);

	/* --------------------------------------------------------------- player control state */

	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let bufferedEnd = $state(0);
	let gainNode: GainNode | undefined = $state();
	let audioCtx: AudioContext | undefined = $state();
	let playbackRate = $state(1);
	let isFullscreen = $state(false);

	let showControls = $state(true);
	let controlsTimer: ReturnType<typeof setTimeout> | null = null;
	let showSettings = $state(false);
	let showCaptions = $state(false);
	let showDelay = $state(false);
	let showAudioPicker = $state(false);
	let showFileName = $state(false);
	let seeking = $state(false);
	let seekPreview = $state(-1);
	let seekTarget = $state(-1);
	let buffering = $state(false);
	let clickTimeout: ReturnType<typeof setTimeout> | null = null;
	let progressSaveTimer: ReturnType<typeof setInterval> | null = null;

	let progressBarEl: HTMLDivElement | undefined = $state();
	let playerPageEl: HTMLDivElement | undefined = $state();

	let subtitleCues = $state<{ start: number; end: number; text: string }[]>([]);
	let subtitlesOn = $state(false);
	let subtitleDelay = $state(0);

	let hlsAudioTracks = $state<{ id: number; name: string }[]>([]);
	let hlsActiveAudio = $state(-1);
	let hlsLevels = $state<{ index: number; height: number; bitrate: number }[]>([]);
	let hlsActiveLevel = $state(-1);
	let videoResolution = $state('');

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
	const currentSub = $derived(
		subtitlesOn
			? subtitleCues.find((c) => {
					const t = currentTime - subtitleDelay;
					return t >= c.start && t < c.end;
				})?.text ?? ''
			: ''
	);

	const nearEnd = $derived(showType === 'tv' && duration > 0 && (duration - currentTime) < 90 && !loadingEpisode);
	const nextEp = $derived(nearEnd ? nextEpisode() : null);

	const subsByLanguage = $derived.by(() => {
		const groups: Record<string, SubOption[]> = {};
		for (const sub of febboxSubs) {
			if (!groups[sub.language]) groups[sub.language] = [];
			groups[sub.language].push(sub);
		}
		const entries = Object.entries(groups);
		entries.sort((a, b) => {
			const aEng = a[0].toLowerCase().startsWith('english') ? 0 : 1;
			const bEng = b[0].toLowerCase().startsWith('english') ? 0 : 1;
			return aEng - bEng || a[0].localeCompare(b[0]);
		});
		return Object.fromEntries(entries);
	});

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

	function togglePlay() {
		if (!videoEl) return;
		videoEl.paused ? videoEl.play() : videoEl.pause();
	}

	function skip(delta: number) {
		if (!videoEl) return;
		const cap = duration > 0.5 ? duration - 0.5 : duration;
		videoEl.currentTime = Math.max(0, Math.min(cap, videoEl.currentTime + delta));
	}

	function toggleMute() {
		if (!videoEl) return;
		videoEl.muted = !videoEl.muted;
	}

	function ensureGain() {
		if (gainNode || !videoEl) return;
		audioCtx = new AudioContext();
		const source = audioCtx.createMediaElementSource(videoEl);
		gainNode = audioCtx.createGain();
		source.connect(gainNode);
		gainNode.connect(audioCtx.destination);
	}

	function applyVolume(v: number) {
		if (!videoEl) return;
		if (v > 1) {
			ensureGain();
			videoEl.volume = 1;
			if (gainNode) gainNode.gain.value = v;
		} else {
			videoEl.volume = v;
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
		}
	}

	function setHlsLevel(index: number) {
		if (!hlsInstance) return;
		hlsInstance.currentLevel = index;
		hlsActiveLevel = index;
	}

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

	async function togglePiP() {
		if (!videoEl) return;
		try {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			else await videoEl.requestPictureInPicture();
		} catch {}
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
	}

	function commitSeek(e: MouseEvent) {
		if (!progressBarEl || !videoEl) return;
		const rect = progressBarEl.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seekTarget = ratio * 100;
		videoEl.currentTime = ratio * duration;
	}

	function showControlsBriefly() {
		showControls = true;
		scheduleHide();
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

	function handleKeyDown(e: KeyboardEvent) {
		if (!streamUrl && !useIframe) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

	function parseTimestamp(t: string): number {
		const p = t.trim().replace(',', '.').split(':');
		return p.length === 3
			? +p[0] * 3600 + +p[1] * 60 + parseFloat(p[2])
			: +p[0] * 60 + parseFloat(p[1]);
	}

	function parseSrt(text: string): { start: number; end: number; text: string }[] {
		if (text.includes('[Events]') || text.includes('Dialogue:')) return parseAss(text);

		const cues: { start: number; end: number; text: string }[] = [];
		const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
		for (const block of blocks) {
			const lines = block.split('\n');
			const timeIdx = lines.findIndex((l) => l.includes('-->'));
			if (timeIdx < 0) continue;
			const [s, e] = lines[timeIdx].split('-->').map(parseTimestamp);
			const txt = lines
				.slice(timeIdx + 1)
				.join('\n')
				.trim();
			if (txt) cues.push({ start: s, end: e, text: txt });
		}
		return cues;
	}

	function parseAss(text: string): { start: number; end: number; text: string }[] {
		const cues: { start: number; end: number; text: string }[] = [];
		const lines = text.replace(/\r\n/g, '\n').split('\n');
		for (const line of lines) {
			if (!line.startsWith('Dialogue:')) continue;
			const parts = line.substring(9).split(',');
			if (parts.length < 10) continue;
			const s = parseTimestamp(parts[1]);
			const e = parseTimestamp(parts[2]);
			const raw = parts.slice(9).join(',');
			const txt = raw
				.replace(/\{[^}]*\}/g, '')
				.replace(/\\N/g, '\n')
				.replace(/\\n/g, '\n')
				.trim();
			if (txt) cues.push({ start: s, end: e, text: txt });
		}
		return cues;
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

	let lastSavedTime = 0;

	function buildProgressBody(): string | null {
		if (!videoTitle || !videoEl) return null;
		const ct = videoEl.currentTime;
		const dur = videoEl.duration;
		if (!dur || !isFinite(dur) || dur < 10 || ct < 3) return null;
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const s = showType === 'tv' && activeEpisode ? activeEpisode.season : 0;
		const e = showType === 'tv' && activeEpisode ? activeEpisode.episode : 0;
		return JSON.stringify({
			title: baseTitle, type: showType, season: s, episode: e,
			currentTime: ct, duration: dur,
			subUrl: subtitlesOn ? activeSubUrl : '',
			subDelay: subtitleDelay,
			subFileName: subtitlesOn ? activeSubFileName : '',
			posterUrl: watchPosterUrl
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
			lastSavedTime = JSON.parse(body).currentTime;
		} catch {}
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
				lastSavedTime = JSON.parse(body).currentTime;
				if (showType === 'tv' && activeEpisode && duration > 0) {
					const key = `${activeEpisode.season}-${activeEpisode.episode}`;
					const pct = currentTime / duration;
					const prev = watchedEpisodeMap.get(key) ?? 0;
					if (pct > prev) {
						watchedEpisodeMap = new Map(watchedEpisodeMap).set(key, pct);
					}
				}
			}
		}).catch(() => {});
	}

	function saveProgressBeacon() {
		const body = buildProgressBody();
		if (!body) return;
		navigator.sendBeacon('/api/watch/progress', new Blob([body], { type: 'application/json' }));
	}

	function startProgressSaving() {
		stopProgressSaving();
		progressSaveTimer = setInterval(saveProgress, 10000);
	}

	function stopProgressSaving() {
		if (progressSaveTimer) { clearInterval(progressSaveTimer); progressSaveTimer = null; }
	}

	async function loadAndResumeProgress() {
		if (!videoTitle || !videoEl) return;
		if (skipResume) { skipResume = false; return; }
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const s = showType === 'tv' && activeEpisode ? activeEpisode.season : 0;
		const e = showType === 'tv' && activeEpisode ? activeEpisode.episode : 0;
		try {
			const resp = await fetch(`/api/watch/progress?title=${encodeURIComponent(baseTitle)}&type=${showType}&season=${s}&episode=${e}`);
			if (!resp.ok) return;
			const data = await resp.json();
			if (data && data.currentTime > 5 && data.duration > 0) {
				const pct = data.currentTime / data.duration;
				if (pct < 0.95) {
					const seekTo = data.currentTime;
					if (videoEl.readyState >= 1) {
						videoEl.currentTime = seekTo;
					} else {
						videoEl.addEventListener('loadeddata', () => {
							if (videoEl) videoEl.currentTime = seekTo;
						}, { once: true });
					}
				}
			}
			if (data && data.subUrl) {
				loadSub({ id: '0', url: data.subUrl, lang: 'eng', language: 'English', fileName: data.subFileName || '' });
				if (data.subDelay) subtitleDelay = data.subDelay;
			}
		} catch {}
	}

	function handleBeforeUnload() {
		saveProgressBeacon();
	}

	beforeNavigate(() => {
		saveProgressSync();
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

	function nextEpisode(): Episode | null {
		if (!activeEpisode) return null;
		const idx = episodes.findIndex(ep => ep.season === activeEpisode!.season && ep.episode === activeEpisode!.episode);
		return idx >= 0 && idx + 1 < episodes.length ? episodes[idx + 1] : null;
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

	async function fetchSubtitles(autoMatch?: { fileName: string; language: string; delay: number }) {
		if (!videoTitle) return;
		loadingSubs = true;
		try {
			const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
			const params = new URLSearchParams({ title: baseTitle, type: showType });
			if (showType === 'tv') {
				if (activeSeason) params.set('season', String(activeSeason));
				if (activeEpisode) params.set('episode', String(activeEpisode.episode));
			}
			const resp = await fetch(`/api/watch/subtitles?${params}`);
			if (resp.ok) febboxSubs = await resp.json();
		} catch {}
		loadingSubs = false;

		if (autoMatch && febboxSubs.length > 0) {
			const stripEp = (n: string) => n.replace(/\.?S\d+\.?E\d+\.?/i, '.').replace(/\.?E\d+\.?/i, '.');
			const prevPattern = stripEp(autoMatch.fileName);
			const match = febboxSubs.find(s => s.fileName === autoMatch.fileName)
				?? febboxSubs.find(s => stripEp(s.fileName) === prevPattern)
				?? febboxSubs.find(s => s.language === autoMatch.language);
			if (match) {
				await loadSub(match);
				subtitleDelay = autoMatch.delay;
			}
		}
	}

	async function loadSub(sub: SubOption) {
		showCaptions = false;
		try {
			const resp = await fetch(
				`/api/watch/subtitle-content?url=${encodeURIComponent(sub.url)}`
			);
			if (!resp.ok) return;
			const data = await resp.json();
			if (data.content) {
				subtitleCues = parseSrt(data.content);
				subtitlesOn = true;
				activeSubFid = sub.id;
				activeSubUrl = sub.url;
				activeSubFileName = sub.fileName || sub.language;
			}
		} catch {}
	}

	/* --------------------------------------------------------------- episode names */

	async function loadEpisodeNames(title: string, season: number) {
		try {
			const resp = await fetch(
				`/api/watch/episode-names?title=${encodeURIComponent(title)}&season=${season}`
			);
			if (resp.ok) episodeNames = await resp.json();
		} catch {}
	}

	let lastCastKey = '';

	async function loadCast(title: string, type: 'movie' | 'tv', season = 0, episode = 0) {
		const key = `${title}:${season}:${episode}`;
		if (key === lastCastKey && castMembers.length > 0) return;
		lastCastKey = key;
		loadingCast = true;
		try {
			let url = `/api/watch/cast?title=${encodeURIComponent(title)}&type=${type}`;
			if (type === 'tv' && season > 0 && episode > 0) url += `&season=${season}&episode=${episode}`;
			const resp = await fetch(url);
			if (resp.ok) castMembers = await resp.json();
		} catch {}
		loadingCast = false;
	}

	function applyPreferredAudio() {
		if (!hlsInstance || !preferredAudioName || hlsInstance.audioTracks.length < 2) return;
		const match = hlsInstance.audioTracks.findIndex(
			(t) => (t.name || t.lang || '').toLowerCase() === preferredAudioName.toLowerCase()
		);
		if (match >= 0 && match !== hlsInstance.audioTrack) {
			hlsInstance.audioTrack = match;
			hlsActiveAudio = match;
		}
	}

	function goBack() {
		if (isAuto) {
			history.back();
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
			const html: string = await wv.executeJavaScript(`
				new Promise(function(resolve) {
					function tryFetch() {
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
			`);

			if (!html) {
				problem = 'Could not load video.';
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
			wv.addEventListener('dom-ready', () => {
				extractVideoFromWebview(wv, iframeFid, shareKey);
			});
		}
	});

	$effect(() => {
		if (!videoEl || !streamUrl) return;

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
		videoEl.pause();
		videoEl.removeAttribute('src');
		videoEl.load();

		if (streamUrl.includes('.m3u8') && Hls.isSupported()) {
			const hls = new Hls({
				maxBufferLength: 60,
				maxMaxBufferLength: 120,
				maxBufferHole: 0.5,
				highBufferWatchdogPeriod: 2,
				nudgeMaxRetry: 5,
				liveSyncDurationCount: 3,
				enableWorker: true,
				abrEwmaDefaultEstimate: 50_000_000
			});
			hls.loadSource(streamUrl);
			hls.attachMedia(videoEl);
			hls.on(Hls.Events.MANIFEST_PARSED, () => {
				hlsLevels = hls.levels.map((l, i) => ({
					index: i, height: l.height, bitrate: l.bitrate
				}));
				const lvlInfo = hls.levels.map((l: { height: number; codecSet?: string; videoCodec?: string }) =>
					`${l.height}p/${l.codecSet || l.videoCodec || '?'}`
				).join(', ');
				debugInfo = (debugInfo ? debugInfo + ' | ' : '') + `hls: ${hls.levels.length} lvl (${lvlInfo})`;
				if (hls.levels.length > 1) {
					hls.currentLevel = hls.levels.length - 1;
					hlsActiveLevel = hls.levels.length - 1;
				} else {
					hlsActiveLevel = 0;
				}
				switchingEpisode = false;
				videoEl?.play().catch(() => {});
				hlsAudioTracks = hls.audioTracks.map((t, i) => ({
					id: i,
					name: t.name || t.lang || `Track ${i + 1}`
				}));
				hlsActiveAudio = hls.audioTrack;
				applyPreferredAudio();
				if (seekAfterLoad > 0) {
					const t = seekAfterLoad;
					seekAfterLoad = 0;
					if (videoEl) videoEl.currentTime = t;
				} else {
					loadAndResumeProgress();
				}
			});
			hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
				hlsAudioTracks = hls.audioTracks.map((t, i) => ({
					id: i,
					name: t.name || t.lang || `Track ${i + 1}`
				}));
				hlsActiveAudio = hls.audioTrack;
				applyPreferredAudio();
			});
			hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
				hlsActiveLevel = data.level;
			});
			hls.on(Hls.Events.ERROR, async (_e, data) => {
				if (!data.fatal) return;
				const fid = activeFile?.fid;
				if (!fid || !shareKey) {
					problem = `Video failed to load (${data.type}).`;
					debugInfo = streamUrl;
					return;
				}
				const savedTime = videoEl?.currentTime ?? 0;
				if (subtitlesOn && activeSubFileName) {
					restoreSub = {
						fileName: activeSubFileName,
						language: febboxSubs.find(s => s.url === activeSubUrl)?.language ?? '',
						delay: subtitleDelay
					};
				}
				try {
					const resp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${fid}`);
					if (!resp.ok) throw new Error();
					const result = await resp.json();
					if (result.url) {
						streamUrl = result.url;
						seekAfterLoad = savedTime;
						return;
					}
				} catch {}
				problem = `Video failed to load (${data.type}).`;
				debugInfo = streamUrl;
			});
			hlsInstance = hls;
		} else {
			videoEl.src = streamUrl;
			videoEl.play().catch(() => {});
			hlsAudioTracks = [];
			videoEl.addEventListener('loadedmetadata', () => { switchingEpisode = false; loadAndResumeProgress(); }, { once: true });
		}

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
			const cue = new VTTCue(c.start + subtitleDelay, c.end + subtitleDelay, c.text.replace(/<[^>]*>/g, ''));
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
		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
		if (controlsTimer) clearTimeout(controlsTimer);
		if (clickTimeout) clearTimeout(clickTimeout);
		stopProgressSaving();
		saveProgressBeacon();
		window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	$effect(() => {
		if ((streamUrl || useIframe) && videoTitle) {
			const sub = restoreSub;
			restoreSub = null;
			fetchSubtitles(sub ?? undefined);
		}
	});

	$effect(() => {
		if ((streamUrl || useIframe) && videoTitle) {
			const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
			const s = activeEpisode?.season ?? 0;
			const e = activeEpisode?.episode ?? 0;
			loadCast(baseTitle, showType, s, e);
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

	/* --------------------------------------------------------------- content functions */

	onMount(async () => {
		const title = page.url.searchParams.get('title');
		isAuto = page.url.searchParams.get('auto') === '1';
		const type = page.url.searchParams.get('type') ?? '';
		const year = page.url.searchParams.get('year') ?? '';
		resumeSeason = Number(page.url.searchParams.get('resume_s') ?? 0);
		resumeEpisode = Number(page.url.searchParams.get('resume_e') ?? 0);

		if (title && isAuto) {
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

	function pickFile(files: FileOption[], wanted: string): FileOption | null {
		if (!files.length) return null;
		const exact = files.find((f) => f.quality === wanted);
		if (exact) return exact;
		const target = parseInt(wanted) || 1080;
		return files.reduce((best, f) => {
			const bestDiff = Math.abs((parseInt(best.quality) || 0) - target);
			const fDiff = Math.abs((parseInt(f.quality) || 0) - target);
			return fDiff < bestDiff ? f : best;
		});
	}

	async function resolve(title: string, type: string, year: string) {
		loading = true;
		loadingStatus = pm ? pRandom() : 'Searching for title...';
		problem = '';
		debugInfo = '';
		needsLogin = false;
		lastResolveArgs = { title, type, year };

		try {
			const params = new URLSearchParams({ title });
			if (type) params.set('type', type);
			if (year) params.set('year', year);

			const resp = await fetch(`/api/watch/resolve?${params}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.error) {
				if (data.error === 'not_found') {
					query = lastResolveArgs?.title ?? '';
					streamUrl = '';
					isAuto = false;
					loading = false;
					doSearch(query);
					return;
				} else if (data.error === 'no_link') problem = 'No link available for that title.';
				else if (data.error === 'no_file') problem = 'No video file found.';
				else problem = 'Something went wrong.';
				loading = false;
				return;
			}

			videoTitle = data.title;
			showType = data.type;
			shareKey = data.shareKey;
			showboxId = data.showboxId ?? 0;
			libraryEntryId = data.libraryEntry?.id ?? null;
			libLastSeason = data.libraryEntry?.lastSeason ?? 0;
			libLastEpisode = data.libraryEntry?.lastEpisode ?? 0;
			watchPosterUrl = data.posterUrl ?? '';
			loadingStatus = pm ? pRandom() : (data.episodes ? 'Loading episodes...' : 'Getting stream...');

			if (data.files) movieFiles = data.files;

			let needsResume = false;
			if (data.episodes) {
				episodes = data.episodes.episodes;
				seasons = data.episodes.seasons;
				allQualities = data.episodes.qualities ?? [];
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
						if (seasons.length) activeSeason = seasons[0];
						if (episodes.length) activeEpisode = episodes[0];
					}
				}
			}

			loggedIn = Boolean(data.hasToken);

			if (data.debug) debugInfo = data.debug;

			if (needsResume && activeEpisode) {
				const resumeFile = pickFile(activeEpisode.files, preferredQuality);
				if (resumeFile) {
					loadingStatus = pm ? "PAPA'S BACK resuming..." : `Resuming S${activeEpisode.season}E${activeEpisode.episode}...`;
					videoTitle = `${data.title} S${activeEpisode.season}E${activeEpisode.episode}`;
					try {
						const sResp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${resumeFile.fid}`);
						if (sResp.ok) {
							const sData = await sResp.json();
							if (sData.url) {
								streamUrl = sData.url;
								activeQuality = resumeFile.quality;
								activeFileFid = resumeFile.fid;
								fetchSubtitles();
								loading = false;
								return;
							}
						}
					} catch {}
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
				const defaultFile = pickFile(currentFiles, preferredQuality);
				if (defaultFile) {
					useIframe = true;
					iframeFid = defaultFile.fid;
					activeQuality = defaultFile.quality;
					activeFileFid = defaultFile.fid;
				} else {
					problem = 'No video file found for this title.';
				}
			}
		} catch {
			problem = 'Could not load that title. Try again in a moment.';
		} finally {
			loading = false;
			loadingStatus = '';
			fetchWatchedEpisodes();
		}
	}

	async function changeToFile(file: FileOption) {
		if (!file || file.fid === activeFileFid) return;
		preferredQuality = file.quality;

		if (useIframe) {
			iframeFid = file.fid;
			activeQuality = file.quality;
			activeFileFid = file.fid;
			reloadWebview();
			return;
		}

		changingQuality = true;
		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			if (data.url) {
				streamUrl = data.url;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				if (data.debug) debugInfo = data.debug;
			} else {
				problem = 'Could not get that quality.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Failed to switch quality.';
		} finally {
			changingQuality = false;
		}
	}

	async function playEpisode(ep: Episode) {
		if (loadingEpisode || ep === activeEpisode) return;
		saveProgress();
		skipResume = true;
		switchingEpisode = true;
		lastCastKey = '';

		const prevSub = subtitlesOn && activeSubFileName
			? { fileName: activeSubFileName, language: febboxSubs.find(s => s.url === activeSubUrl)?.language ?? '', delay: subtitleDelay }
			: undefined;

		activeEpisode = ep;
		problem = '';
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const file = pickFile(ep.files, preferredQuality);
		if (!file) {
			problem = 'No video file for that episode.';
			return;
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

		if (useIframe) {
			iframeFid = file.fid;
			activeQuality = file.quality;
			activeFileFid = file.fid;
			videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
			reloadWebview();
			fetchSubtitles(prevSub);
			return;
		}

		loadingEpisode = true;
		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareKey}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			if (data.url) {
				streamUrl = data.url;
				videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				fetchSubtitles(prevSub);
			} else {
				problem = 'Could not get a link for that episode.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Failed to load episode.';
		} finally {
			loadingEpisode = false;
			fetchWatchedEpisodes();
		}
	}

	function onSearch(event: Event) {
		clearTimeout(searchTimer);
		const value = (event.target as HTMLInputElement).value;
		query = value;
		searchTimer = setTimeout(() => doSearch(value), 350);
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
		showboxId = 0;
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
					await fetch('/api/watch/sync-cookies', { method: 'POST' });
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
		showboxId = 0;
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
		showFileName = false;
		febboxSubs = [];
		activeSubFid = 0;
		episodeNames = {};
	}
</script>

<svelte:head><title>{videoTitle ? `${videoTitle} · ` : ''}Watch · Catalog</title></svelte:head>
<svelte:window onkeydown={handleKeyDown} />

{#if streamUrl || useIframe || needsLogin}
	<!-- ============================================================= PLAYER VIEW -->
	<div
		class="player-page"
		class:has-sidebar={castOpen || (showType === 'tv' && seasons.length > 0 && sidebarOpen)}
		bind:this={playerPageEl}
	>
		<div
			class="player-bar"
			class:bar-hidden={isFullscreen && !showControls}
			onmouseenter={() => { showControls = true; if (controlsTimer) clearTimeout(controlsTimer); }}
			onmouseleave={scheduleHide}
		>
			<button type="button" class="bar-btn" onclick={goBack}>&larr; Back</button>
			<h1 class="player-title">{videoTitle}</h1>

			{#if currentFiles.length > 1}
				<div class="quality-picker">
					{#each currentFiles as f (f.fid)}
						<button
							type="button"
							class="q-btn"
							class:active={activeFileFid === f.fid}
							disabled={changingQuality}
							onclick={() => changeToFile(f)}
						>{f.quality}{currentFiles.filter(o => o.quality === f.quality).length > 1 ? ` · ${f.size}` : ''}</button>
					{/each}
				</div>
			{/if}

			{#if activeFile}
				<button
					type="button"
					class="bar-btn file-btn"
					class:expanded={showFileName}
					onclick={() => (showFileName = !showFileName)}
					title={showFileName ? '' : 'Show file info'}
				>
					{#if showFileName}
						<span class="file-name-text">{#each parseFileTokens(activeFile.name) as tok}{#if tok.tip}<span class="file-token" data-tip={tok.tip}>{tok.text}</span>{:else}{tok.text}{/if}{/each} ({activeFile.size})</span>
					{:else}
						<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg>
						File
					{/if}
				</button>
			{/if}

			<button
				type="button"
				class="bar-btn cast-btn"
				class:active={castOpen}
				onclick={() => { castOpen = !castOpen; }}
			>{pm ? p('Cast') : 'Cast'}</button>

			{#if showType === 'tv' && seasons.length > 0}
				<button
					type="button"
					class="bar-btn episodes-btn"
					onclick={() => { sidebarOpen = !sidebarOpen; if (sidebarOpen) castOpen = false; }}
				>{sidebarOpen ? (pm ? 'Hide' : 'Hide episodes') : (pm ? p('Episodes') : 'Episodes')}</button>
			{/if}

			{#if loggedIn}
				<span class="bar-btn logged-in">Logged in</span>
			{:else}
				<button type="button" class="bar-btn login-btn" onclick={loginToFebbox}>Log in</button>
			{/if}

			<button type="button" class="bar-btn wrong-btn" onclick={wrongShow}>{pm ? 'ARE YOU DUMB wrong one?' : 'Wrong one?'}</button>

			{#if libraryEntryId}
				<a href="/entry/{libraryEntryId}" class="bar-btn in-library-btn">{pm ? 'Giblet claimed' : 'In library'}</a>
				{#if showType === 'tv' && activeEpisode}
					<button type="button" class="bar-btn sync-btn" onclick={syncProgressToEntry}
						title="Update season/episode reached to S{activeEpisode.season}E{activeEpisode.episode}"
					>↑ Sync S{activeEpisode.season}E{activeEpisode.episode}</button>
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
			<p class="player-error">{problem}</p>
		{/if}

		<div class="player-body">
			{#if showType === 'tv' && seasons.length > 0 && sidebarOpen}
				<aside class="sidebar">
					<div class="season-tabs">
						{#each seasons as s (s)}
							<button
								type="button"
								class="season-tab"
								class:active={activeSeason === s}
								onclick={() => (activeSeason = s)}
							>S{s}</button>
						{/each}
					</div>
					<ul class="episode-list">
						{#each seasonEpisodes as ep (`${ep.season}-${ep.episode}`)}
							{@const epPct = watchedEpisodeMap.get(`${ep.season}-${ep.episode}`) ?? 0}
							<li>
								<button
									type="button"
									class="ep-btn"
									class:playing={activeEpisode === ep}
									class:watched={epPct >= 0.9}
									class:partial={epPct > 0.02 && epPct < 0.9}
									disabled={loadingEpisode}
									onclick={() => playEpisode(ep)}
								>
									<span class="ep-num">E{ep.episode}</span>
									{#if episodeNames[ep.episode]}
										<span class="ep-name">{episodeNames[ep.episode]}</span>
									{/if}
									<span class="ep-meta">
										{#each ep.files as f (f.fid)}
											<span class="ep-quality">{f.quality || 'SD'}</span>
										{/each}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</aside>
			{/if}

			<div
				class="video-area"
				class:hide-cursor={!showControls && playing}
				onmousemove={showControlsBriefly}
				ontouchstart={showControlsBriefly}
				onmouseleave={() => {
					if (playing && !showSettings && !showCaptions && !showAudioPicker) showControls = false;
				}}
			>
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
						class:buffering={loadingEpisode || changingQuality}
						ontimeupdate={() => {
							if (videoEl && !seeking && !switchingEpisode) currentTime = videoEl.currentTime;
						}}
						ondurationchange={() => {
							if (videoEl && !switchingEpisode) duration = videoEl.duration;
						}}
						onplay={() => {
							playing = true;
							scheduleHide();
						}}
						onpause={() => {
							playing = false;
							showControls = true;
							saveProgress();
						}}
						onvolumechange={() => {
							if (videoEl) {
								if (!gainNode || gainNode.gain.value <= 1) volume = videoEl.volume;
								muted = videoEl.muted;
							}
						}}
						onprogress={() => {
							if (videoEl && videoEl.buffered.length > 0)
								bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
						}}
						onwaiting={() => {
							buffering = true;
							if (bufferTimer) clearTimeout(bufferTimer);
							bufferTimer = setTimeout(() => {
								if (videoEl && buffering && !loadingEpisode) {
									const pos = videoEl.currentTime;
									videoEl.currentTime = Math.max(0, pos - 1);
								}
							}, 12000);
						}}
						oncanplay={() => { buffering = false; if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null; } }}
						onseeking={() => { buffering = true; }}
						onseeked={() => { buffering = false; if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null; } }}
						onended={() => {
							playing = false;
							showControls = true;
							saveProgress();
							const next = nextEpisode();
							if (showType === 'tv' && next) {
								const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
								const payload = JSON.stringify({
									title: baseTitle, type: 'tv',
									season: next.season, episode: next.episode,
									currentTime: 0, duration: 0,
									posterUrl: watchPosterUrl
								});
								setTimeout(() => {
									navigator.sendBeacon('/api/watch/progress', new Blob([payload], { type: 'application/json' }));
								}, 300);
							}
						}}
					>
						Your browser doesn't support video playback.
					</video>

					<!-- click-to-play / double-click-fullscreen layer -->
					<div
						class="click-layer"
						role="button"
						tabindex="-1"
						onclick={handleVideoClick}
						ondblclick={handleVideoDblClick}
					></div>

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

					<!-- subtitle overlay -->
					{#if currentSub}
						<div class="subtitle-display">{@html currentSub.replace(/\n/g, '<br>')}</div>
					{/if}

					<!-- next episode overlay -->
					{#if nextEp}
						<div class="next-ep-overlay">
							<button type="button" class="next-ep-btn" onclick={() => playEpisode(nextEp)}>
								<span class="next-ep-label">{pm ? p('Next Episode') : 'Next Episode'}</span>
								<span class="next-ep-title">S{nextEp.season}E{nextEp.episode}{episodeNames[nextEp.episode] ? ` — ${episodeNames[nextEp.episode]}` : ''}</span>
							</button>
						</div>
					{/if}

					<!-- custom controls overlay -->
					<div class="controls" class:visible={showControls}>
						<!-- progress bar -->
						<div class="progress-wrap" onmousedown={onProgressDown}>
							<div class="progress-bar" bind:this={progressBarEl}>
								<div class="prog-buffered" style:width="{bufferedPct}%"></div>
								<div class="prog-played" style:width="{displayPct}%"></div>
								<div class="prog-handle" style:left="{displayPct}%" class:dragging={seeking}></div>
							</div>
						</div>

						<!-- button row -->
						<div class="ctrl-row">
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

							<span class="time-display">{fmt(seekPreview >= 0 ? seekPreview / 100 * duration : seekTarget >= 0 ? seekTarget / 100 * duration : currentTime)} / {fmt(duration)}</span>

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
											<button class="sub-delay-btn" onclick={() => subtitleDelay = Math.round((subtitleDelay - 0.5) * 10) / 10} title="Subs appear before audio — push them later">
												<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 13H5v-2h14v2z"/></svg>
											</button>
											<span class="delay-label">Before audio</span>
											<span class="sub-delay-value">{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s</span>
											<span class="delay-label">After audio</span>
											<button class="sub-delay-btn" onclick={() => subtitleDelay = Math.round((subtitleDelay + 0.5) * 10) / 10} title="Subs appear after audio — push them earlier">
												<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
											</button>
											<button class="sub-delay-reset" onclick={() => subtitleDelay = 0}>Reset</button>
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
								onclick={() => { showCaptions = !showCaptions; showSettings = false; showDelay = false; showAudioPicker = false; }}
								title="Subtitles"
							>
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
							</button>

							<button
								class="ctrl-btn"
								onclick={() => { showSettings = !showSettings; showCaptions = false; showDelay = false; showAudioPicker = false; }}
								title="Settings"
							>
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>
							</button>

							<button class="ctrl-btn" onclick={togglePiP} title="Picture in picture">
								<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>
							</button>

							<button class="ctrl-btn" onclick={toggleFS} title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}>
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
							<p class="popup-label">Subtitles</p>
							<button
								class="popup-item"
								class:active={!subtitlesOn}
								onclick={() => { subtitlesOn = false; showCaptions = false; }}
							>
								{#if !subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
								Off
							</button>
							{#if subtitleCues.length > 0}
								<button
									class="popup-item"
									class:active={subtitlesOn}
									onclick={() => { subtitlesOn = true; showCaptions = false; }}
								>
									{#if subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
									Loaded subtitle
								</button>
							{/if}
							{#if febboxSubs.length > 0 || loadingSubs}
								<hr class="popup-divider" />
								{#if loadingSubs}
									<span class="popup-item" style="opacity:0.5;cursor:default">Finding subtitles...</span>
								{:else}
									{#each Object.entries(subsByLanguage) as [lang, subs] (lang)}
										<p class="sub-lang-label">{lang}</p>
										{#each subs as sub (sub.id)}
											<button
												class="popup-item"
												class:active={activeSubFid === sub.id && subtitlesOn}
												onclick={() => loadSub(sub)}
											>
												{#if activeSubFid === sub.id && subtitlesOn}<span class="popup-check">&#10003;</span>{/if}
												<span class="sub-name-row">
													<span class="sub-name-text">{sub.fileName || sub.language}</span>
													{#if sub.source}<span class="sub-source-badge">{sub.source}</span>{/if}
												</span>
											</button>
										{/each}
									{/each}
								{/if}
							{/if}
							<hr class="popup-divider" />
							<button class="popup-item" onclick={uploadSubtitle}>
								<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="flex:none;opacity:0.6"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
								Upload subtitle file
							</button>
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
				value={query}
				oninput={onSearch}
				aria-label={pm ? "find a giblet to watch" : "Search for media"}
			/>
		</div>

		{#if searching}
			<p class="muted searching">{pm ? pRandom() : 'Searching...'}</p>
		{:else if results.length > 0}
			<ul class="grid">
				{#each results as result (result.id + result.type)}
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

	/* --------------------------------------------------------- top bar */
	.player-bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255, 255, 255, 0.08); z-index: 20; transition: opacity 0.3s ease, transform 0.3s ease; }
	.player-bar.bar-hidden { opacity: 0; pointer-events: none; transform: translateY(-100%); }
	.bar-btn { flex: none; font-size: 0.82rem; font-weight: 600; padding: 5px 12px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.06); color: #e0e0e0; cursor: pointer; text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
	.bar-btn:hover { border-color: rgba(255, 255, 255, 0.3); color: #fff; }
	.player-title { font-size: 1rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; }
	.player-error { margin: 0; padding: 6px 16px; font-size: 0.82rem; color: var(--accent); background: rgba(140, 47, 57, 0.2); border-bottom: 1px solid rgba(255, 255, 255, 0.06); flex: none; }
	.quality-picker { display: flex; gap: 3px; flex: none; }
	.q-btn { font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.6); cursor: pointer; text-transform: uppercase; }
	.q-btn:hover:not(.active) { border-color: rgba(255, 255, 255, 0.3); color: #fff; }
	.q-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
	.q-btn:disabled { opacity: 0.5; cursor: wait; }

	.file-btn { font-size: 0.76rem; max-width: 350px; overflow: hidden; text-overflow: ellipsis; }
	.file-btn.expanded { max-width: none; overflow: visible; }
	.file-name-text { font-weight: 400; font-size: 0.74rem; opacity: 0.85; }
	.episodes-btn { color: var(--accent); border-color: var(--accent); font-size: 0.78rem; }
	.login-btn { margin-left: auto; color: var(--accent); border-color: var(--accent); font-size: 0.78rem; }
	.logged-in { margin-left: auto; color: var(--good); border-color: var(--good); font-size: 0.78rem; cursor: default; }
	.wrong-btn { color: #e88; border-color: rgba(255, 100, 100, 0.3); font-size: 0.78rem; }
	.wrong-btn:hover { color: #f99; border-color: rgba(255, 100, 100, 0.5); }
	.add-btn { background: var(--good); color: #fff; border-color: var(--good); cursor: pointer; }
	.add-btn:hover { filter: brightness(1.12); color: #fff; }
	.add-btn:disabled { opacity: 0.6; cursor: wait; }
	.in-library-btn { color: var(--good); border-color: var(--good); text-decoration: none; }
	.in-library-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--good); }

	/* --------------------------------------------------------- player body */
	.player-body { display: flex; flex: 1; min-height: 0; padding-top: 45px; }

	/* --------------------------------------------------------- sidebar */
	.sidebar { width: 240px; flex: none; display: flex; flex-direction: column; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); border-right: 1px solid rgba(255, 255, 255, 0.06); overflow: hidden; }
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
	.ep-meta { display: flex; gap: 4px; margin-left: auto; font-size: 0.68rem; color: rgba(255, 255, 255, 0.4); }
	.ep-quality { text-transform: uppercase; font-weight: 600; padding: 1px 4px; border-radius: 3px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); }

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
	.video-area.hide-cursor { cursor: none; }

	.video-area video { width: 100%; height: 100%; object-fit: contain; display: block; outline: none; }
	.video-area video.buffering { opacity: 0.3; }

	.hidden-webview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden; }

	.player-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; font-size: 0.9rem; color: #888; z-index: 1; }

	.login-prompt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #aaa; font-size: 0.95rem; text-align: center; padding: 40px 20px; width: 100%; }
	.login-action { font-size: 0.95rem; font-weight: 600; padding: 10px 28px; border-radius: var(--radius-sm); border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
	.login-action:hover { filter: brightness(1.12); }

	/* --------------------------------------------------------- click layer */
	.click-layer { position: absolute; inset: 0; z-index: 1; cursor: pointer; }

	/* --------------------------------------------------------- subtitle overlay */
	.subtitle-display { position: absolute; bottom: 80px; left: 10%; right: 10%; text-align: center; color: #fff; font-size: 1.4rem; line-height: 1.5; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.7); pointer-events: none; z-index: 5; background: rgba(0, 0, 0, 0.5); padding: 6px 16px; border-radius: 4px; width: fit-content; margin: 0 auto; }

	/* --------------------------------------------------------- controls overlay */
	.controls { position: absolute; bottom: 0; left: 0; right: 0; padding: 40px 16px 14px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); opacity: 0; transition: opacity 0.3s ease; pointer-events: none; z-index: 10; }
	.controls.visible { opacity: 1; pointer-events: auto; }

	/* --------------------------------------------------------- progress bar */
	.progress-wrap { padding: 8px 0; cursor: pointer; }
	.progress-bar { position: relative; height: 3px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; transition: height 0.1s; }
	.progress-wrap:hover .progress-bar { height: 5px; }
	.prog-buffered { position: absolute; top: 0; left: 0; bottom: 0; background: rgba(255, 255, 255, 0.25); border-radius: inherit; pointer-events: none; }
	.prog-played { position: absolute; top: 0; left: 0; bottom: 0; background: var(--accent, #d97a83); border-radius: inherit; pointer-events: none; }
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
	.popup { position: absolute; bottom: 60px; right: 16px; background: rgba(18, 18, 18, 0.96); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 0; min-width: 190px; max-width: min(420px, 50vw); max-height: 400px; overflow-y: auto; backdrop-filter: blur(12px); z-index: 20; }
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
	.delay-popup { position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(20, 20, 20, 0.95); border-radius: 8px; white-space: nowrap; }
	.sub-delay-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.1); border: none; border-radius: 50%; color: white; cursor: pointer; }
	.sub-delay-btn:hover { background: rgba(255, 255, 255, 0.2); }
	.sub-delay-value { font-size: 0.82rem; font-variant-numeric: tabular-nums; min-width: 48px; text-align: center; color: rgba(255, 255, 255, 0.85); }
	.sub-delay-reset { background: none; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: rgba(255, 255, 255, 0.6); font-size: 0.72rem; padding: 2px 8px; cursor: pointer; }
	.sub-delay-reset:hover { color: white; border-color: rgba(255, 255, 255, 0.4); }
	.delay-label { font-size: 0.62rem; color: rgba(255, 255, 255, 0.35); white-space: nowrap; user-select: none; }

	/* --------------------------------------------------------- buffering spinner */
	.buffering-overlay { position: absolute; inset: 0; display: grid; place-items: center; z-index: 4; pointer-events: none; }
	.quality-toast { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: rgba(255, 255, 255, 0.85); font-size: 0.82rem; z-index: 9; pointer-events: none; backdrop-filter: blur(6px); }

	.next-ep-overlay { position: absolute; bottom: 100px; right: 24px; z-index: 8; animation: fadeSlideIn 0.4s ease; }
	.next-ep-btn { display: flex; flex-direction: column; gap: 4px; padding: 14px 22px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: #fff; cursor: pointer; backdrop-filter: blur(8px); transition: background 0.2s, border-color 0.2s; }
	.next-ep-btn:hover { background: rgba(30, 30, 30, 0.95); border-color: var(--accent); }
	.next-ep-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255, 255, 255, 0.6); }
	.next-ep-title { font-size: 0.95rem; font-weight: 600; }
	@keyframes fadeSlideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }

	.sync-btn { color: var(--accent); border-color: var(--accent); font-size: 0.72rem; }
	.sync-btn:hover { background: rgba(255, 255, 255, 0.06); }
	.buffering-spinner { width: 48px; height: 48px; border: 4px solid rgba(255, 255, 255, 0.15); border-top-color: rgba(255, 255, 255, 0.8); border-radius: 50%; animation: spin 0.8s linear infinite; }

	/* --------------------------------------------------------- responsive */
	@media (max-width: 700px) {
		.sidebar { width: 180px; }
	}

	@media (max-width: 560px) {
		.player-bar { flex-wrap: wrap; gap: 8px; }
		.player-title { order: -1; width: 100%; font-size: 0.9rem; }
		.quality-picker { order: 1; }
		.add-btn { margin-left: 0; flex: 1; text-align: center; }
		.player-body { flex-direction: column; }
		.sidebar { width: 100%; max-height: 200px; border-right: none; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
	}
</style>
