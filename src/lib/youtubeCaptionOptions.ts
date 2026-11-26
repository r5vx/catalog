export function youtubeCaptionId(stream: string) {
	return /^\/api\/youtube\/hls\/([\w-]{11})\/main\.m3u8(?:\?.*)?$/.exec(stream)?.[1] ?? '';
}

type RawCue = {start:number; end:number; text:string};
type CaptionReply = {id:string; tracks:{lang:string; cues:RawCue[]}[]};
const escapes: Record<string, string> = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};

export function youtubeCaptionOptions(id: string, data: CaptionReply) {
	if (!id || data?.id !== id || !Array.isArray(data.tracks)) return [];
	return data.tracks.flatMap(track => {
		if (!track || !/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(track.lang) || !Array.isArray(track.cues)) return [];
		const cues = track.cues.filter(c => c && Number.isFinite(c.start) && c.start >= 0 && Number.isFinite(c.end) && c.end > c.start && typeof c.text === 'string' && c.text.trim())
			.map(c => ({start:c.start, end:c.end, text:c.text.replace(/[&<>"']/g, ch => escapes[ch]), top:false}));
		if (!cues.length) return [];
		let language = track.lang;
		try { language = new Intl.DisplayNames(['en'], {type:'language'}).of(track.lang) || language; } catch {}
		const key = `youtube-asr:${id}:${track.lang}`;
		return [{id:key, url:key, lang:track.lang, language, fileName:`${language} (auto-generated)`, source:'YouTube', cues}];
	});
}
