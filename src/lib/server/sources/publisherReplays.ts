import type { Sport } from '../../live';
import { works, type OfficialWork } from './official';
import { videoListing } from './videoListing';

const sports: Record<string, Sport> = {
	FIFA:'soccer', LaLiga:'soccer', 'Serie A':'soccer', 'AFC National Teams':'soccer', 'CON.C.A.C.A.F.':'soccer',
	NFL:'football', MLB:'baseball', 'MLB Vault':'baseball', 'World Baseball Classic':'baseball', 'Pacific League English':'baseball', NBA:'basketball', NHL:'hockey',
	Wimbledon:'tennis', 'Australian Open':'tennis', 'US Open Tennis Championships':'tennis',
	'The Masters':'golf', 'PGA TOUR':'golf', MotoGP:'motorsport', 'NASCAR Classics':'motorsport', 'FIA World Endurance Championship':'motorsport', '24 Heures du Mans':'motorsport', 'NTT INDYCAR SERIES':'motorsport',
	WWE:'fighting', 'WWE Vault':'fighting', Olympics:'other', 'World Athletics':'other', 'BLAST Premier VOD Archive':'other', 'ESL Archives':'other', 'LEC':'other', 'LCK Global':'other', 'LCK':'other', 'StarLadder CS2':'other', 'Rainbow Six Esports Match Vods':'other'
};
export function isPublisherReplay(w: OfficialWork) {
	if (w.type !== 'replay' || w.collectionOnly || !sports[w.channel] || !w.year || !/^\d{4}-\d{2}-\d{2}/.test(w.title)) return false;
	const t = w.uploadTitle;
	if (/\b(highlights?|condensed|clips?|teasers?|preview|trailer|recap|rehearsal|upcoming|livestream|part [1-9]|ceremony|press conference)\b/i.test(t)) return false;
	return /\b(?:full(?:[- ]length| archived| race| cs2| match)? (?:games?|matches|match|races?|replay|event|vod)|final round broadcast|replay course)\b/i.test(t) ||
		(/^(MLB|World Baseball Classic|ESL Archives|LEC|LCK Global|LCK|StarLadder CS2|Rainbow Six Esports Match Vods|CON\.C\.A\.C\.A\.F\.)$/.test(w.channel) && /\s(?:v\.?|vs\.?|@)\s/i.test(t));
}
const replays = works.filter(isPublisherReplay).sort((a,b) => Number(!!b.desktopVerified)-Number(!!a.desktopVerified) || b.title.slice(0,10).localeCompare(a.title.slice(0,10)) || a.videoId.localeCompare(b.videoId));
const ids = new Map(replays.map(w => [w.videoId, w]));
export const publisherReplay = (id: string) => ids.get(id);

/**
 * What a channel's videos are, shown on each card: "Other" mixed esports, the Olympics and
 * athletics under bare upload titles like "GX v VIT | 2025 LEC Summer | …", and the owner couldn't
 * tell what half of them were (2026-11-26). Sports channels show their own name.
 */
const KINDS: Record<string, string> = {
	'BLAST Premier VOD Archive': 'Counter-Strike 2',
	'ESL Archives': 'Counter-Strike 2',
	'StarLadder CS2': 'Counter-Strike 2',
	LEC: 'League of Legends',
	'LCK Global': 'League of Legends',
	LCK: 'League of Legends',
	'Rainbow Six Esports Match Vods': 'Rainbow Six Siege',
	Olympics: 'Olympics',
	'World Athletics': 'Athletics',
	'MLB Vault': 'MLB',
	'WWE Vault': 'WWE',
	'NASCAR Classics': 'NASCAR',
	'NTT INDYCAR SERIES': 'IndyCar',
	'FIA World Endurance Championship': 'World Endurance',
	'24 Heures du Mans': 'Le Mans',
	'US Open Tennis Championships': 'US Open',
	'Pacific League English': 'Japanese baseball',
	'AFC National Teams': 'AFC',
	'CON.C.A.C.A.F.': 'CONCACAF'
};
export const kindOf = (channel: string) => KINDS[channel] ?? channel;

/** Korean words in LCK titles, in English. */
const KOREAN: [RegExp, string][] = [
	[/그룹 스테이지/g, 'Group Stage'],
	[/녹아웃 스테이지/g, 'Knockout Stage'],
	[/스위스 스테이지/g, 'Swiss Stage'],
	[/퍼스트 스탠드 토너먼트/g, 'First Stand'],
	[/월드 챔피언십/g, 'World Championship'],
	[/미드 시즌 인비테이셔널/g, 'Mid-Season Invitational'],
	[/플레이오프/g, 'Playoffs'],
	[/결승전?/g, 'Final'],
	[/16강/g, 'Round of 16'],
	[/8강/g, 'Quarterfinal'],
	[/4강/g, 'Semifinal'],
	[/녹아웃/g, 'Knockout'],
	[/정규 리그/g, 'Regular Season']
];

/** Words that say nothing about which game it is ("Full CS2 Match VOD", "Full Replays"). */
const FILLER = /^(?:full(?: cs2)?(?: match| game| replays?| race| event)?(?: vod)?|vod|full length|highlights?)$/i;

/**
 * An upload title split into what's on the card: the match ("GIANTX vs. Team Vitality", or two
 * at once on LCK days: "BRO vs DRX · DNF vs NS") and the event ("2025 LEC Summer · Week 1 Day 3").
 * Without a match (Olympics, athletics) the first part is the title.
 */
export function cardTitle(upload: string): { title: string; event: string } {
	let text = upload;
	for (const [korean, english] of KOREAN) text = text.replace(korean, english);
	const parts = text
		.split(/\s+(?:\||\/\/|-|–|—)\s+/)
		.map((part) => part.replace(/\s+/g, ' ').trim())
		.filter((part) => part && !FILLER.test(part) && !/[ㄱ-힝]/.test(part));
	const isMatch = (part: string) => /\s(?:vs?\.?|@)\s/i.test(part);
	const matches = parts.filter(isMatch);
	const rest = parts.filter((part) => !isMatch(part));
	if (!matches.length) return { title: rest[0] ?? upload, event: rest.slice(1).join(' · ') };
	// A short and a long name for one match ("GX v VIT" and "GIANTX vs. Team Vitality Game 1"):
	// the long one. Several matches of the same length (two games in one video): all of them.
	const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
	const shortest = matches.reduce((a, b) => (b.length < a.length ? b : a));
	const title = longest.length > shortest.length * 1.6 ? longest : matches.join(' · ');
	return { title, event: rest.join(' · ') };
}
/**
 * A page of channel replays, each one checked with YouTube before it's shown (owner, 2026-11-26:
 * "why cant we just make sure they all work ourselves"), so the cards are only ones that play.
 * Twelve are asked at once; a removed or private video is skipped and kept skipped for a day.
 */
export async function publisherReplayPage(params: URLSearchParams) {
	const allowed = (params.get('sports') || '').split(',').filter(Boolean);
	const sport = params.get('sport') || 'all';
	const words = (params.get('q') || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
	const candidates = replays.filter(w => (!allowed.length || allowed.includes(sports[w.channel])) && words.every(term => `${w.channel} ${kindOf(w.channel)} ${w.title} ${sports[w.channel]}`.toLowerCase().includes(term)));
	const counts: Record<string,number> = {};
	for (const w of candidates) counts[sports[w.channel]] = (counts[sports[w.channel]] || 0) + 1;
	const filtered = candidates.filter(w => sport === 'all' || sports[w.channel] === sport);
	let offset = Math.min(filtered.length, Math.max(0, Math.trunc(Number(params.get('offset'))) || 0));
	const items: { id: string; title: string; event: string; kind: string; date: string; upload: string; channel: string; year: number | null | undefined; poster: string }[] = [];
	// (At most four rounds of asking per page, so a run of removed videos can't hold the page up.)
	for (let round = 0; round < 4 && offset < filtered.length && items.length < 12; round++) {
		const batch = filtered.slice(offset, offset + 12 - items.length);
		offset += batch.length;
		const listed = await Promise.all(batch.map((w) => videoListing(w.videoId)));
		batch.forEach((w, i) => {
			if (listed[i] === 'unavailable') return;
			const { title, event } = cardTitle(w.uploadTitle);
			items.push({ id:w.videoId, title, event, kind:kindOf(w.channel), date:w.title.slice(0, 10), upload:w.uploadTitle, channel:w.channel, year:w.year, poster:`https://i.ytimg.com/vi/${w.videoId}/hqdefault.jpg` });
		});
	}
	return { items, counts, next:offset < filtered.length ? offset : null };
}
