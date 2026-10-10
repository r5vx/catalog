<script lang="ts">
	import MoreButton from '$lib/MoreButton.svelte';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import Hls from 'hls.js';
	import BackBar from '$lib/BackBar.svelte';
	import { p, pRandom } from '$lib/poison';
	import { pickFile, PREFERRED_QUALITY } from '$lib/watch';
	import { isTv, tvPlayer } from '$lib/tv';

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
		/** Where it comes from when it isn't Showbox ("Aniwave"). */
		source?: string;
		/** What another source's file plays from. */
		shareKey?: string;
		/** "Japanese" or "English", when the source says. */
		audio?: string;
		/** Subtitles are part of the picture. */
		burnedIn?: boolean;
	}

	/** Where a file plays from: its own source, or the episode's Showbox share. */
	const shareOf = (f: FileOption | null | undefined) => f?.shareKey || shareKey;

	/* Japanese audio or the English dub, for files from another source: the last one picked. */
	const ANIME_AUDIO = 'catalog:animeAudio';

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
		return f.size ? `${f.quality} · ${f.size}` : f.quality;
	}

	/** Showbox's best file; another source's only when Showbox has none for this episode. */
	const pickFor = (files: FileOption[]) => pickFile(files, preferredQuality, animeAudio());

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
	let videoFit = $state<'contain' | 'cover'>('cover');

	function chooseFit(fit: 'contain' | 'cover') {
		videoFit = fit;
		try { localStorage.setItem(VIDEO_FIT, fit); } catch {}
	}



	let libraryEntryId = $state<number | null>(null);
	let libraryEntryStatus = $state('');
	let libLastSeason = $state(0);
	let libLastEpisode = $state(0);
	let addingToLibrary = $state(false);
	let watchedEpisodeMap = $state<Map<string, number>>(new Map());
	let autoplayNext = $state(false);
	let autoplayFired = false;
	let skipResume = false;
	let switchingEpisode = false;
	let refreshingStream = false;
	/** Bumped to reload the player even when a fresh link comes back identical. */
	let streamNonce = $state(0);
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

	interface SkipSegment { type: 'intro' | 'recap' | 'credits'; start: number; end: number; }
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

	const currentFiles = $derived(
		showType === 'tv' && activeEpisode ? activeEpisode.files : movieFiles
	);

	/* --------------------------------------------------------------- player control state */

	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let bufferedEnd = $state(0);
	let gainNode: GainNode | undefined = $state();
	let audioCtx: AudioContext | undefined;
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
	interface Cue { start: number; end: number; text: string; top: boolean; }
	let subtitleCues = $state<Cue[]>([]);
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
	const activeSubs = $derived(subtitlesOn ? subsAt(currentTime - subtitleDelay) : { top: '', bottom: '' });

	const inEndCredits = $derived(
		skipSegments.some((s) => s.type === 'credits' && s.end >= duration - 20 && currentTime >= s.start)
	);
	const nearEnd = $derived(
		showType === 'tv' && duration > 0 && ((duration - currentTime) < 90 || inEndCredits) && !loadingEpisode
	);
	const nextEp = $derived(nearEnd ? nextEpisode() : null);
	const upcomingEp = $derived(showType === 'tv' ? nextEpisode() : null);

	const SKIP_LABELS: Record<SkipSegment['type'], string> = {
		intro: 'Skip Intro',
		recap: 'Skip Recap',
		credits: 'Skip Credits'
	};
	const activeSkip = $derived.by(() => {
		const seg = skipSegments.find((s) => currentTime >= s.start && currentTime < s.end - 1);
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
		if (!videoEl) return;
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
			recheckSubsForAudio();
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

		pipCtx.drawImage(videoEl, 0, 0, vw, vh);

		if (subtitlesOn) {
			const subs = subsAt((videoEl.currentTime || 0) - subtitleDelay);
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

	function cleanupPiP() {
		if (pipAnimFrame) { cancelAnimationFrame(pipAnimFrame); pipAnimFrame = null; }
		if (pipVideo) {
			pipVideo.removeEventListener('leavepictureinpicture', cleanupPiP);
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
		} catch (err) {
			console.error('PiP failed:', err);
			cleanupPiP();
			try { await videoEl.requestPictureInPicture(); inPiP = true; } catch {}
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
	}

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
	let tvFullscreenTried = false;

	/** The controls' first button, for when the remote's up or down brings them up. */
	function focusControls() {
		const button = playerPageEl?.querySelector<HTMLElement>('.controls button');
		button?.focus({ preventScroll: true });
	}

	onMount(() => {
		if (!tvMode) return;
		tvPlayer.playPause = () => {
			togglePlay();
			showControlsBriefly();
		};
		tvPlayer.seek = (seconds) => {
			skip(seconds);
			showControlsBriefly();
		};
	});
	onDestroy(() => {
		tvPlayer.playPause = undefined;
		tvPlayer.seek = undefined;
	});

	// When the controls fade, let go of the highlighted button so the arrows skip again.
	$effect(() => {
		if (!tvMode || showControls) return;
		const current = document.activeElement as HTMLElement | null;
		if (current && playerPageEl?.querySelector('.controls')?.contains(current)) current.blur();
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
		const onControl = current && current !== document.body && current.tagName !== 'VIDEO';
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
			togglePlay();
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
			.replace(/\\h/g, ' ')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.replace(/<[^>]*>/g, '').trim())
			.join('\n');
		return text ? { text: safeSubHtml(text), top } : null;
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
			const cue = cleanCue(parts.slice(9).join(','));
			if (cue) cues.push({ start: s, end: e, ...cue });
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
				if (pct >= 0.95 && showType === 'tv') {
					const next = nextEpisode();
					// Finished already: on to the next one, leaving this one's finished place as it is
					// (it has only just started playing, a few seconds in).
					if (next) { playEpisode(next, true); return; }
				}
				if (pct < 0.95 || showType === 'tv') {
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
			// The subtitles that were on, back on. Not plain subtitles over the English dub: they were
			// on for Japanese audio (captions, which follow the dub, still come back).
			const forDub = /\bCC\b|SDH/i.test(data?.subFileName ?? '');
			if (data && data.subUrl && (!hearingDub() || forDub)) {
				loadSub({ id: '0', url: data.subUrl, lang: 'eng', language: 'English', fileName: data.subFileName || '' });
				if (data.subDelay) subtitleDelay = data.subDelay;
			}
		} catch {}
	}

	/** Gets a brand-new link for the current file and picks up where it left off. Capped so it can't loop forever. */
	async function refreshStream() {
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
		stalledOut = false;
		problem = '';
		streamRefreshes = 0;
		refreshStream();
	}

	function markBytes() {
		lastBytesAt = performance.now();
	}

	function bufferedAhead(): number {
		if (!videoEl) return 0;
		const t = videoEl.currentTime;
		for (let i = 0; i < videoEl.buffered.length; i++) {
			if (videoEl.buffered.start(i) <= t + 0.5 && videoEl.buffered.end(i) > t) return videoEl.buffered.end(i) - t;
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

	/** Server-side link for the next episode, fetched ahead so it starts at once. */
	function prefetchNextEpisode() {
		if (showType !== 'tv' || !shareKey || !videoEl || duration <= 0) return;
		const next = nextEpisode();
		const file = next ? pickFor(next.files) : null;
		if (!next || !file) return;
		const remaining = duration - currentTime;
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

	function onTimeUpdate() {
		if (videoEl && !seeking && !isVideoSeeking && !switchingEpisode) currentTime = videoEl.currentTime;
		if (currentTime >= 60) autosyncEpisode();
		if (duration > 0 && currentTime >= duration - Math.min(120, duration * 0.1)) autosyncFinished();
		flushQualityPrefetch();
		prefetchNextEpisode();
		autoSkipCheck();
	}

	function overallEpisodeNumber(ep: Episode): number {
		let n = ep.episode;
		for (const s of seasons) {
			if (s < 1 || s >= ep.season) continue;
			n += Math.max(0, ...episodes.filter((e) => e.season === s).map((e) => e.episode));
		}
		return n;
	}

	async function loadSkipTimes(ep: Episode, length: number) {
		const baseTitle = videoTitle.replace(/ S\d+E\d+$/, '');
		const key = `${baseTitle}:${ep.season}:${ep.episode}`;
		if (key === skipLookupKey) return;
		skipLookupKey = key;
		skipSegments = [];
		try {
			const params = new URLSearchParams({
				title: baseTitle,
				episode: String(overallEpisodeNumber(ep)),
				duration: String(Math.round(length))
			});
			const resp = await fetch(`/api/watch/skip-times?${params}`);
			if (!resp.ok) return;
			const segments = await resp.json() as SkipSegment[];
			if (key === skipLookupKey) skipSegments = segments;
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

	/* --------------------------------------------------------------- episode list menu */

	let epMenu = $state<{ x: number; y: number; ep: Episode } | null>(null);

	function openEpMenu(e: MouseEvent, ep: Episode) {
		e.preventDefault();
		epMenu = { x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 200), ep };
	}

	/** What a greyed-out episode says: when it airs, or that no source has it. */
	function notAvailableText(ep: Episode): string {
		const today = new Date().toISOString().slice(0, 10);
		if (ep.airDate && ep.airDate > today) {
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
		try { localStorage.setItem('catalog-autoplay', autoplayNext ? '1' : '0'); } catch {}
	}

	/**
	 * Auto-skip: intros and end credits are skipped without pressing anything. Credits that run to
	 * the end go straight to the next episode (or past them, when there's a scene after). Each is
	 * skipped once per episode, so going back into an intro on purpose lets it play. Only
	 * shows with known intro times (anime) have anything to skip.
	 */
	let autoSkip = $state(false);
	const autoSkipped = new Set<string>();

	function toggleAutoSkip() {
		autoSkip = !autoSkip;
		try { localStorage.setItem('catalog-autoskip', autoSkip ? '1' : '0'); } catch {}
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
		if (!autosync || !ep || ep.season < 1 || showType !== 'tv' || libraryEntryStatus === 'completed') return;
		const key = `${videoTitle}:${ep.season}-${ep.episode}`;
		if (key === autosyncedEnd) return;
		const later = episodes.some((e) => e.season > ep.season || (e.season === ep.season && e.episode > ep.episode));
		if (later) return;
		autosyncedEnd = key;
		await autosyncEpisode();
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

	/**
	 * A Showbox file's English audio track is only known once the video has loaded, after the
	 * subtitles were looked up: on a switch to or from the dub they're looked up again, and ones
	 * that went on by themselves for Japanese audio come off.
	 */
	function recheckSubsForAudio() {
		if (!videoTitle || hearingDub() === subsForDub) return;
		if (subsAuto && hearingDub()) {
			subtitlesOn = false;
			subsAuto = false;
		}
		fetchSubtitles();
	}

	/** The English dub or not: another source says, otherwise the audio track playing does. */
	function hearingDub(): boolean {
		// Before a Showbox video has loaded its audio tracks, the one picked last time (it's put back on).
		const track = hlsAudioTracks.find((t) => t.id === hlsActiveAudio)?.name ?? (activeFile?.source ? '' : preferredAudioName);
		const audio = activeFile?.audio ?? track ?? '';
		return /^(english|eng)\b/i.test(audio);
	}

	async function fetchSubtitles(autoMatch?: { fileName: string; language: string; delay: number }) {
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
		febboxSubs = list;
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
		} else if (!autoMatch && !subtitlesOn) {
			// Anime in Japanese starts with subtitles on: the chosen one, or the next English
			// ones if it won't download.
			const pick = febboxSubs.find((s) => s.default);
			if (pick) {
				const tries = [pick, ...febboxSubs.filter((s) => s !== pick && !s.check && s.language === 'English')].slice(0, 4);
				for (const sub of tries) {
					if (key !== subsKey || subtitlesOn) break;
					if (await loadSub(sub)) {
						subsAuto = true;
						break;
					}
				}
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

	/** Downloads and shows a subtitle. False if it couldn't be had. */
	async function loadSub(sub: SubOption): Promise<boolean> {
		showCaptions = false;
		subsAuto = false;
		try {
			// The show's name lets the file be kept on this PC while you're watching it.
			const params = new URLSearchParams({ url: sub.url, show: videoTitle.replace(/ S\d+E\d+$/, '') });
			// Season packs are a zip of every episode; this says which one to take.
			if (showType === 'tv' && activeEpisode) {
				params.set('season', String(activeEpisode.season));
				params.set('episode', String(activeEpisode.episode));
			}
			const resp = await fetch(`/api/watch/subtitle-content?${params}`);
			if (!resp.ok) return false;
			const data = await resp.json();
			if (data.content) {
				subtitleCues = parseSrt(data.content);
				subtitlesOn = true;
				activeSubFid = sub.id;
				activeSubUrl = sub.url;
				activeSubFileName = sub.fileName || sub.language;
				return true;
			}
		} catch {}
		return false;
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
		videoEl.load();

		if (streamUrl.includes('.m3u8') && Hls.isSupported()) {
			const hls = new Hls({
				// Catalog draws its own subtitles: none of the browser's, from captions some videos
				// carry inside them or a subtitle track their playlist lists.
				enableCEA708Captions: false,
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
				fragLoadingMaxRetry: 4,
				fragLoadingRetryDelay: 1000,
				abrEwmaDefaultEstimate: 50_000_000,
				xhrSetup: (xhr: XMLHttpRequest) => {
					xhr.addEventListener('progress', markBytes);
					try { xhr.setRequestHeader('Referer', 'https://www.febbox.com/'); } catch {}
				}
			});
			hls.subtitleDisplay = false;
			hls.loadSource(streamUrl);
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
				if (hls.levels.length > 1) {
					let best = hls.levels.length - 1;
					for (let i = hls.levels.length - 1; i >= 0; i--) {
						const vc = hls.levels[i].codecSet || hls.levels[i].videoCodec || '';
						if (vc.includes('avc1') || vc.includes('avc3')) { best = i; break; }
					}
					hls.currentLevel = best;
					hlsActiveLevel = best;
				} else {
					hlsActiveLevel = 0;
				}
				switchingEpisode = false;
				autoplayFired = false;
				if (!stayPaused) videoEl?.play().catch(() => {});
				hlsAudioTracks = hls.audioTracks.map((t, i) => ({
					id: i,
					name: t.name || t.lang || `Track ${i + 1}`
				}));
				hlsActiveAudio = hls.audioTrack;
				applyPreferredAudio();
				recheckSubsForAudio();
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
				recheckSubsForAudio();
			});
			hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
				hlsActiveLevel = data.level;
			});
			hls.on(Hls.Events.ERROR, (_e, data) => {
				const errDetail = `${data.type}/${data.details}` +
					((data as any).response?.code ? ` http=${(data as any).response.code}` : '') +
					((data as any).reason ? ` reason=${(data as any).reason}` : '') +
					(data.url ? ` url=${data.url.substring(0, 120)}` : '');
				if (!data.fatal) {
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
					hls.recoverMediaError();
					return;
				}
				if (!activeFile?.fid || !shareKey) {
					problem = `Video failed to load (${data.details}).`;
					return;
				}
				refreshStream();
			});
			hlsInstance = hls;
		} else {
			videoEl.src = streamUrl;
			if (!stayPaused) videoEl.play().catch(() => {});
			hlsAudioTracks = [];
			videoEl.addEventListener('loadedmetadata', () => {
				switchingEpisode = false;
				autoplayFired = false;
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
			const cue = new VTTCue(c.start + subtitleDelay, c.end + subtitleDelay, plainSubText(c.text));
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
		try { autoplayNext = localStorage.getItem('catalog-autoplay') === '1'; } catch {}
		try { autosync = localStorage.getItem('catalog-autosync') !== '0'; } catch {}
		try { autoSkip = localStorage.getItem('catalog-autoskip') === '1'; } catch {}
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
			// A series asks for no stream here; it fetches only the episode it ends up playing.
			const params = new URLSearchParams({ title, nostream: '1' });
			if (type) params.set('type', type);
			if (year) params.set('year', year);

			const resp = await fetch(`/api/watch/resolve?${params}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();

			if (data.error) {
				if (data.error === 'not_found') {
					problem = 'This title is unavailable.';
				} else if (data.error === 'no_link') problem = 'This title is unavailable.';
				else if (data.error === 'no_file') problem = 'This title has no video file.';
				else problem = 'Something went wrong.';
				loading = false;
				return;
			}

			videoTitle = data.title;
			showType = data.type;
			sidebarOpen = !episodesHiddenFor().has(data.title);
			shareKey = data.shareKey;
			mainShareKey = data.shareKey;
			libraryEntryId = data.libraryEntry?.id ?? null;
			libraryEntryStatus = data.libraryEntry?.status ?? '';
			libLastSeason = data.libraryEntry?.lastSeason ?? 0;
			libLastEpisode = data.libraryEntry?.lastEpisode ?? 0;
			watchPosterUrl = data.posterUrl ?? '';
			loadingStatus = pm ? pRandom() : (data.episodes ? 'Loading episodes...' : 'Getting stream...');

			if (data.files) movieFiles = data.files;

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
				let url = '';
				try {
					const sResp = await fetch(`/api/watch/stream?share_key=${shareOf(file)}&fid=${file.fid}`);
					if (sResp.ok) {
						const sData = await sResp.json();
						url = sData.url ?? '';
						if (sData.debug) debugInfo = sData.debug;
					}
				} catch {}
				if (url) {
					streamUrl = url;
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
				let url = '';
				try {
					const sResp = await fetch(`/api/watch/stream?share_key=${shareOf(film)}&fid=${film.fid}`);
					if (sResp.ok) url = (await sResp.json()).url ?? '';
				} catch {}
				if (url) streamUrl = url;
				else problem = `${film.source} couldn't play this right now.`;
				return;
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
			problem = 'Could not load that title.';
			resolveFailed = true;
		} finally {
			loading = false;
			loadingStatus = '';
			fetchWatchedEpisodes();
			if (shareKey) queueQualityPrefetch(currentFiles, activeFileFid);
		}
	}

	function showQualityToast(msg: string) {
		if (qualityToastTimer) clearTimeout(qualityToastTimer);
		qualityToast = msg;
		qualityToastTimer = setTimeout(() => { qualityToast = ''; qualityToastTimer = null; }, 5000);
	}

	async function changeToFile(file: FileOption) {
		if (!file || file.fid === activeFileFid) return;
		preferredQuality = file.quality;
		streamRefreshes = 0;
		if (stalledOut) { stalledOut = false; problem = ''; }
		if (qualityToast) { qualityToast = ''; if (qualityToastTimer) { clearTimeout(qualityToastTimer); qualityToastTimer = null; } }

		// Picking another source's copy remembers its audio for the next episodes.
		if (file.audio) {
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
		prevStreamUrl = streamUrl;
		prevFileFid = activeFileFid;
		prevQuality = activeQuality;
		changingQuality = true;
		const savedTime = videoEl?.currentTime ?? 0;
		try {
			const resp = await fetch(`/api/watch/stream?share_key=${shareOf(file)}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			if (data.url) {
				seekAfterLoad = savedTime;
				streamUrl = data.url;
				streamNonce++;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				if (data.debug) debugInfo = data.debug;
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
				problem = file.source ? `${file.source} couldn't play this one right now.` : 'Could not get that quality.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			prevStreamUrl = '';
			problem = 'Failed to switch quality.';
		} finally {
			changingQuality = false;
		}
	}

	async function playEpisode(ep: Episode, passingFinished = false) {
		if (loadingEpisode || ep === activeEpisode || !playable(ep)) return;
		if (!passingFinished) saveProgress();
		skipResume = true;
		switchingEpisode = true;
		if (inPiP) cleanupPiP();
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
			const resp = await fetch(`/api/watch/stream?share_key=${shareOf(file)}&fid=${file.fid}`);
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			if (data.url) {
				streamUrl = data.url;
				streamNonce++;
				videoTitle = `${baseTitle} S${ep.season}E${ep.episode}`;
				activeQuality = file.quality;
				activeFileFid = file.fid;
				fetchSubtitles(prevSub);
			} else {
				problem = file.source ? `${file.source} couldn't play this episode right now.` : 'Could not get a link for that episode.';
				if (data.debug) debugInfo = data.debug;
			}
		} catch {
			problem = 'Failed to load episode.';
		} finally {
			loadingEpisode = false;
			fetchWatchedEpisodes();
			if (shareKey) queueQualityPrefetch(ep.files, file.fid);
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

{#if streamUrl || useIframe || needsLogin}
	<!-- ============================================================= PLAYER VIEW -->
	<div
		class="player-page"
		class:has-sidebar={castOpen || (showType === 'tv' && seasons.length > 0 && sidebarOpen)}
		class:hide-cursor={isFullscreen && cursorIdle && !showControls && playing}
		bind:this={playerPageEl}
		data-tv-player={streamUrl || useIframe ? '' : undefined}
		onmousemove={wakeCursor}
	>
		<div
			class="player-bar"
			class:bar-hidden={isFullscreen && !showControls}
			onmouseenter={() => { showControls = true; if (controlsTimer) clearTimeout(controlsTimer); }}
			onmouseleave={scheduleHide}
		>
			<button type="button" class="bar-btn" onclick={goBack}>&larr; Back</button>
			<h1 class="player-title">{videoTitle}</h1>

			<!-- Shown even with one file, so it always says where the video comes from. -->
			{#if currentFiles.length > 0}
				<div class="file-pick-wrap">
					<button
						type="button"
						class="bar-btn file-pick-btn"
						disabled={changingQuality}
						onclick={() => { showFilePicker = !showFilePicker; }}
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
					onclick={toggleEpisodes}
				>{sidebarOpen ? (pm ? 'Hide' : 'Hide episodes') : (pm ? p('Episodes') : 'Episodes')}</button>
			{/if}

			{#if showType === 'tv'}
				<button type="button" class="bar-btn autoplay-btn" class:active={autoplayNext} onclick={toggleAutoplay}>
					{autoplayNext ? '⏭ Autoplay: On' : '⏭ Autoplay: Off'}
				</button>
				<button
					type="button"
					class="bar-btn autoplay-btn"
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

			{#if !loggedIn}
				<button type="button" class="bar-btn login-btn" onclick={loginToFebbox}>Log in</button>
			{/if}

			{#if libraryEntryId}
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
									disabled={loadingEpisode || !playable(ep)}
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

			<div
				class="video-area"
				onmousemove={showControlsBriefly}
				ontouchstart={showControlsBriefly}
				onmouseleave={() => {
					if (playing && !showSettings && !showCaptions && !showAudioPicker) showControls = false;
				}}
			>
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
						ontimeupdate={onTimeUpdate}
						ondurationchange={() => {
							if (videoEl && !switchingEpisode) duration = videoEl.duration;
						}}
						onplay={() => {
							playing = true;
							userPaused = false;
							scheduleHide();
						}}
						onpause={() => {
							// Paused by hand (media keys, picture-in-picture), not by a reload clearing the old video.
							if (videoEl && videoEl.readyState >= 2 && !switchingEpisode && !refreshingStream) userPaused = true;
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
							markBytes();
							if (videoEl && videoEl.buffered.length > 0)
								bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
						}}
						onwaiting={() => {
							buffering = true;
							if (!stalledOut) watchForStall();
						}}
						oncanplay={() => { buffering = false; }}
						onplaying={() => {
							buffering = false;
							clearStallWatch();
							// A file switched to has started: it works, so a later hiccup isn't a reason to switch back.
							if (prevStreamUrl && !changingQuality) prevStreamUrl = '';
						}}
						onseeking={() => { buffering = true; isVideoSeeking = true; }}
						onseeked={() => {
							buffering = false;
							isVideoSeeking = false;
							// Paused, nothing else updates the bar after a jump (it waits for playback).
							if (videoEl && !seeking && !switchingEpisode) currentTime = videoEl.currentTime;
						}}
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
								navigator.sendBeacon('/api/watch/progress', new Blob([payload], { type: 'application/json' }));
								// Only once the last frame has played — firing early cut off endings.
								if (autoplayNext && !autoplayFired && !loadingEpisode) {
									autoplayFired = true;
									playEpisode(next);
								}
							}
						}}
					>
						Your browser doesn't support video playback.
					</video>

					{#if inPiP}
						<div class="pip-placeholder">Playing in picture-in-picture</div>
					{/if}

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
					{#if !inPiP}
						<!-- cue text is escaped by safeSubHtml(), so only i/b/u tags can reach the page -->
						{#if activeSubs.top}
							<div class="subtitle-display top">{@html activeSubs.top.replace(/\n/g, '<br>')}</div>
						{/if}
						{#if activeSubs.bottom}
							<div class="subtitle-display">{@html activeSubs.bottom.replace(/\n/g, '<br>')}</div>
						{/if}
					{/if}

					<!-- skip intro / next episode -->
					{#if activeSkip || nextEp}
						<div class="next-ep-overlay">
							{#if activeSkip}
								{@const seg = activeSkip}
								<button type="button" class="skip-btn" onclick={() => skipSegment(seg)}>{SKIP_LABELS[seg.type]}</button>
							{/if}
							{#if nextEp}
								<button type="button" class="next-ep-btn" onclick={() => playEpisode(nextEp)}>
									<span class="next-ep-label">
										{#if autoplayNext && duration > 0 && (duration - currentTime) <= 0.5}
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

					<!-- custom controls overlay -->
					<div class="controls" class:visible={showControls}>
						<!-- progress bar -->
						<div class="progress-wrap" onmousedown={onProgressDown}>
							<div class="progress-bar" bind:this={progressBarEl}>
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
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay - 5) * 10) / 10} title="Push subs 5 seconds later">−5s</button>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay - 0.5) * 10) / 10} title="Subs appear before audio — push them later">−0.5s</button>
											<span class="delay-label">Before audio</span>
											<span class="sub-delay-value">{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)}s</span>
											<span class="delay-label">After audio</span>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay + 0.5) * 10) / 10} title="Subs appear after audio — push them earlier">+0.5s</button>
											<button class="sub-delay-jump" onclick={() => subtitleDelay = Math.round((subtitleDelay + 5) * 10) / 10} title="Push subs 5 seconds earlier">+5s</button>
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
							{#if activeFile}
								<hr class="popup-divider" />
								<p class="popup-label">File</p>
								<p class="popup-item popup-info file-name-info">{#each parseFileTokens(activeFile.name) as tok}{#if tok.tip}<span class="file-token" data-tip={tok.tip}>{tok.text}</span>{:else}{tok.text}{/if}{/each} ({activeFile.size ? `${activeFile.size} · ` : ''}{activeFile.source ?? 'Showbox'})</p>
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
									{activeSubFileName || 'Loaded subtitle'}
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
												onclick={() => (sub.check ? passNexusCheck() : loadSub(sub))}
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
	.sidebar { margin-top: 45px; width: 240px; flex: none; display: flex; flex-direction: column; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); border-right: 1px solid rgba(255, 255, 255, 0.06); overflow: hidden; }
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

	/* --------------------------------------------------------- PiP placeholder */
	.pip-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--ink-faint); font-size: 1.1rem; pointer-events: none; z-index: 2; background: #000; }

	/* --------------------------------------------------------- controls overlay */
	.controls { position: absolute; bottom: 0; left: 0; right: 0; padding: 40px 16px 14px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); opacity: 0; transition: opacity 0.3s ease; pointer-events: none; z-index: 10; }
	.controls.visible { opacity: 1; pointer-events: auto; }

	/* --------------------------------------------------------- progress bar */
	.progress-wrap { padding: 8px 0; cursor: pointer; }
	.progress-bar { position: relative; height: 3px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; transition: height 0.1s; }
	.progress-wrap:hover .progress-bar { height: 5px; }
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
	.delay-popup { position: absolute; bottom: calc(100% + 10px); right: -60px; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(20, 20, 20, 0.95); border-radius: 8px; white-space: nowrap; }
	.sub-delay-jump { padding: 4px 8px; font-size: 0.72rem; font-weight: 600; background: rgba(255, 255, 255, 0.1); border: none; border-radius: 12px; color: white; cursor: pointer; }
	.sub-delay-jump:hover { background: rgba(255, 255, 255, 0.2); }
	.sub-delay-value { font-size: 0.82rem; font-variant-numeric: tabular-nums; min-width: 48px; text-align: center; color: rgba(255, 255, 255, 0.85); }
	.sub-delay-reset { background: none; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: rgba(255, 255, 255, 0.6); font-size: 0.72rem; padding: 2px 8px; cursor: pointer; }
	.sub-delay-reset:hover { color: white; border-color: rgba(255, 255, 255, 0.4); }
	.delay-label { font-size: 0.62rem; color: rgba(255, 255, 255, 0.35); white-space: nowrap; user-select: none; }

	/* --------------------------------------------------------- buffering spinner */
	.buffering-overlay { position: absolute; inset: 0; display: grid; place-items: center; z-index: 4; pointer-events: none; }
	.quality-toast { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: rgba(255, 255, 255, 0.85); font-size: 0.82rem; z-index: 9; pointer-events: none; backdrop-filter: blur(6px); }

	.next-ep-overlay { position: absolute; bottom: 100px; right: 24px; z-index: 8; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; animation: fadeSlideIn 0.4s ease; }
	.skip-btn { padding: 11px 22px; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; backdrop-filter: blur(8px); transition: background 0.2s, border-color 0.2s; }
	.skip-btn:hover { background: rgba(30, 30, 30, 0.95); border-color: var(--accent); }
	.next-ep-btn { display: flex; flex-direction: column; gap: 4px; padding: 14px 22px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(0, 0, 0, 0.75); color: #fff; cursor: pointer; backdrop-filter: blur(8px); transition: background 0.2s, border-color 0.2s; }
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
</style>
