// Offline: isolated database and provider responses, no running Catalog or provider needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import vidfastEvidence from '../../electron/vidfastEvidence.cjs';
const dir = mkdtempSync(join(tmpdir(), 'catalog-release-test-'));
process.env.CATALOG_DB = join(dir, 'test.db');
const lib = new URL('../../src/lib/', import.meta.url);
const source = path => new URL(path + '.ts', lib).href;
const stubs = new Map(Object.entries({
	'server/electron-fetch': 'export const electronMovyFind = async url => globalThis.find(url), electronFetch=()=>null, electronGetVideoUrl=()=>null;',
	'server/youtube': 'export const inDesktopApp=()=>true, isVideoId=()=>true, keptSeconds=()=>globalThis.officialSeconds??0, readIndex=()=>globalThis.officialIndex??null, startCapture=()=>null;',
	'server/metadata/tmdb': 'export const tmdbGet=async(path,params)=>globalThis.publisherTmdb ? globalThis.publisherTmdb(path,params) : ({results:globalThis.hits}), fetchAlternativeTitles=async()=>[];',
	'server/metadata/anilist':'export const fetchRomajiTitle=async()=>null;',
	'server/combinedEpisodes': 'export const tmdbShow=(title,year)=>globalThis.series(title,year), unasked=()=>[], unaskedSetup=()=>"fixture", combineEpisodes=async (_,title,id,year)=>globalThis.list(title,year);',
	'server/showbox': `export { bestMatch } from '${source('server/showbox')}?real'; export const searchShowbox=async()=>globalThis.showbox??[], getFebboxLink=()=>null, extractShareKey=()=>null, listEpisodes=()=>null, listMovieFiles=()=>[], getStreamUrl=()=>null, resolveSlugId=()=>0; export class FebboxRefused extends Error{}`,
	'server/febboxList':'export const febboxListing=()=>null; export class FebboxRefused extends Error{}',
	'server/febboxAccounts':'export const febboxAccountsName=()=>"", accountsToUse=()=>[], noteHeldBack=()=>{};',
	'server/settings':'export const readSettings=()=>({}), onFebboxAccountChange=()=>{};',
	'server/audioLanguage':'export const audioLanguage=()=>null, audioLanguageName=()=>"";',
	'server/animeFilm':'export const isAnimeFilm=async()=>false;',
	'server/copySharpness':'export const measureFilmAhead=()=>{};',
	'server/downloadAheadAsk':'export const downloadLikelyAhead=()=>{};',
	'server/sources/aniwave':'export const aniwaveStream=()=>null, parseAniwaveShareKey=()=>null;',
	'server/sources/nyaa':'export const nyaaCopy=()=>[], nyaaOn=()=>false;',
	'watch':'export const pickFile=files=>files[0], PREFERRED_QUALITY="1080p";',
	'server/sources': 'export const aniwaveFiles=async()=>new Map(), aniwaveFilm=async()=>null, kaaFiles=aniwaveFiles;',
	...Object.fromEntries(['vidrift','movy','xumo','plex','pluto'].map(name=>['server/sources/'+name,`export const on${name[0].toUpperCase()+name.slice(1)}=async()=>false, ${name}Stream=()=>null, ${name}Film=()=>null, with${name[0].toUpperCase()+name.slice(1)}=list=>list;${name==='movy'?'export const movyDubCopy=()=>null, parseMovyShareKey=()=>null;':''}`])),
	'server/sources/hianime': 'export const hianimeHas=async()=>false;',
	'server/metadata/skiptimes': 'export const malEpisodeOf=async()=>null;',
	'server/metadata/cinemas': 'export const filmOnlyInCinemas=async()=>null;'
}).map(([k,v])=>[source(k),v]));
registerHooks({resolve(id,ctx,next){
	if(id.endsWith('.json')) return {shortCircuit:true,url:new URL(id,ctx.parentURL).href};
	if(id.startsWith('$lib/')) return {shortCircuit:true,url:source(id.slice(5))};
	if (ctx.parentURL?.split('?')[0].endsWith('.ts') && id.startsWith('.') && !id.endsWith('.ts')) return {shortCircuit:true,url:new URL(id+'.ts',ctx.parentURL).href};
	return next(id,ctx);
},load(url,ctx,next){
	if(url.endsWith('/official-works.json')) return {shortCircuit:true,format:'module',source:'export default '+readFileSync(new URL(url),'utf8')};
	if(!new URL(url).pathname.endsWith('.ts')) return next(url,ctx);
	return {shortCircuit:true,format:'module',source:stubs.get(url) ?? ts.transpileModule(readFileSync(new URL(url),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
}});
const get = path=>import(source(path));
const {releaseParts,seriesHit,isRemake,filmHit,progressMatches} = await get('release');
const title='Lucky Luke';
globalThis.hits = [{name:title,id:259405,first_air_date:'2026-03-23'},{name:title,id:65392,first_air_date:'1984-10-15'}];
assert.equal(seriesHit(hits,title,'1984').id,65392);
assert.equal(seriesHit(hits,title,'1992'),null);
assert.ok(isRemake(hits,title));
assert.deepEqual(releaseParts('Lucky Luke (1984)'),{title,year:'1984'});
assert.equal(filmHit([{title,release_date:'2026-02-01'}],title,'1984'),null);
assert.equal(progressMatches(title,[title.toLowerCase()],1984,true),false);
assert.equal(progressMatches(title+' (1984)',[title.toLowerCase()],2026,true),false);
const page='https://vidfast.vc/tv/65392/1/1', playlist={url:'https://media.invalid/master.m3u8',status:200,mimeType:'application/vnd.apple.mpegurl'};
const video={url:'https://media.invalid/a.ts',status:206,mimeType:'video/mp2t'};
const observe=vidfastEvidence(page);
assert.equal(observe(page,'a',{...playlist,mimeType:'text/html'}),null);
assert.equal(observe(page,'a',video),null);
assert.equal(observe(page,'a',playlist),null);
assert.equal(observe(page,'b',video),null);
assert.equal(observe(page.replace('65392','259405'),'a',video),null);
assert.equal(observe(page,'a',video),playlist.url);
const {db} = await get('server/db/index');
const q = await get('server/db/queries');
const {withProfile} = await get('server/profile');
try {
	const category=db.prepare('SELECT id FROM categories LIMIT 1').get()?.id ?? db.prepare("INSERT INTO categories(name,slug) VALUES ('TV','fixture-tv')").run().lastInsertRowid;
	db.prepare('INSERT INTO entries(category_id,title,year,status,poster_url,source,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(category,title,2026,'watching','live','tmdb','tv:259405');
	q.saveWatchProgress(title,'tv',1,1,33,600,'',0,'','live');
	q.saveWatchProgress(title+' (2026)','tv',1,1,55,600,'',0,'','live');
	for (const hit of hits) q.saveOrderCache('tmdb-show3|lucky luke|'+hit.first_air_date.slice(0,4),{id:hit.id,name:title},Date.now());
	const unassigned=q.continueWatchingList().find(x=>x.title===title); assert.equal(unassigned.needsRelease,true); assert.equal(unassigned.posterUrl,null); assert.equal(unassigned.entryId,null); assert.equal(unassigned.href,'/browse?q=Lucky%20Luke');
	assert.equal(q.findEntryByTitle(title,'2026','movie'),null);
	assert.equal(q.getWatchProgress(title,'tv',1,1).currentTime,33);
	assert.equal(withProfile(1,()=>q.getWatchProgress(title,'tv',1,1)),null);
	q.saveWatchProgress(title+' (1984)','tv',1,1,33,600,'',0,'','cartoon');
	assert.equal(q.findEntryByTitle(title,'1984'),null);
	const saved=q.continueWatchingList();
	assert.equal(saved.length,3);
	const old=saved.find(x=>x.title.endsWith('(1984)'));
	assert.equal(old.entryId,null); assert.equal(old.posterUrl,'cartoon'); assert.equal(old.currentTime,33);
	assert.equal(saved.find(x=>x.title.endsWith('(2026)')).currentTime,55);
	const {CHANNELS,channelFiles}=await get('server/sources/channels');
	for(const [k,v] of [[`channel-playlists|${CHANNELS[0].handle}`,[{id:'PL-fixture',title:'Lucky Luke (1984) [HD 1080p]'}]],['channel-videos|PL-fixture',[{id:'ng3xiUuJlDA',title:'[HD] Lucky Luke (1984) - Ep. 08: Outlaws [1080p]'}]],['channel-tmdb-names|65392',[{season:1,episode:1,name:'Outlaw'}]]]) q.saveOrderCache(k,v,Date.now());
	globalThis.series=async(t,y)=> {const hit=seriesHit(hits,t,y);return hit?{id:hit.id,name:t,anime:false,seasons:[{number:1,count:26,airDate:hit.first_air_date}]}:null;};
	const matched=await channelFiles(await globalThis.series(title,'1984'),3000); assert.equal(matched.get('1-1')[0].shareKey,'channel:ng3xiUuJlDA'); assert.equal(matched.has('1-8'),false);
	q.saveOrderCache('yt-listing-v1|ng3xiUuJlDA','listed',Date.now());
	let captured=false;
	globalThis.find=url=>{if(url.includes('/65392/'))return captured?{url:playlist.url}:{error:'timeout'};return {error:'none'};};
	const {bestMatch}=await get('server/showbox');
	globalThis.showbox=[{id:3,title,type:'movie',info:'1984'},{id:4,title,type:'tv',info:'2026'},{id:5,title,type:'tv',info:'SS 1 EPS 6'}];
	assert.equal(bestMatch(showbox,title,'tv','1984',true),null);
	assert.equal(bestMatch(showbox,title,'tv','1984',false).id,5);
	globalThis.list=async(t,y)=>{const hit=await globalThis.series(t,y);return {seasons:[1],qualities:[],episodes:[{season:1,episode:1,files:[{source:'Fixture',fid:1,shareKey:`fixture:${hit.id}`}]}]};};
	const {GET}=await get('../routes/api/watch/resolve/+server');
	const resolve=async(label,year)=> (await GET({url:new URL('http://fixture.invalid/resolve?'+new URLSearchParams({title:label,type:'tv',year,nostream:'1'}))})).json();
	// The 2026 Showbox candidate must not leak into the cartoon. Then exercise both cache entries.
	assert.equal((await resolve(title,'1984')).episodes.episodes[0].files[0].shareKey,'fixture:65392');
	globalThis.showbox=[];
	assert.equal((await resolve(title,'2026')).episodes.episodes[0].files[0].shareKey,'fixture:259405');
	assert.equal((await resolve(title+' (1984)','')).title,title+' (1984)');
	assert.equal((await resolve(title+' (1984)','')).episodes.episodes[0].files[0].shareKey,'fixture:65392');
	const {availabilityNow}=await get('server/availability');
	const sources=async year=>{availabilityNow(title,'tv',year);await new Promise(setImmediate);return Object.fromEntries(availabilityNow(title,'tv',year).sources.map(s=>[s.name,s.state]));};
	assert.equal((await sources('1984')).YouTube,'listed');
	assert.notEqual((await sources('2026')).YouTube,'listed');
	assert.equal((await sources('1984')).Vidfast,'no');
	const {tvTitleLink}=await get('server/tvLinks'); globalThis.series=async(t,y)=>{assert.equal(t,title);assert.equal(y,'1984');return {id:65392};};
	assert.deepEqual(await tvTitleLink(old.title,'tv'),{source:'tmdb',id:'tv:65392'});
	const {vidfastStream,vidfastShareKey,confirmedVidfast}=await get('server/sources/vidfast');
	const what={type:'tv',id:65392,season:1,episode:1}; captured=true;
	assert.equal(await vidfastStream(vidfastShareKey(what),true),playlist.url);
	assert.equal(confirmedVidfast(what).length,1);
	// A playlist confirmed for the pilot is not confirmation for its next episode.
	assert.equal(confirmedVidfast({...what,episode:2}).length,0);
	for(const other of [{...what,episode:2},{...what,id:259405}])assert.equal(confirmedVidfast(other).length,0);
	captured=false; await vidfastStream(vidfastShareKey(what),true); assert.equal(confirmedVidfast(what).length,0);
	// Removing a library release must not hide the identically named cartoon.
	q.hideCompletedFromContinueWatching(q.findEntryByTitle(title,'2026','tv').id);
	assert.deepEqual(q.continueWatchingList().map(x=>x.title).sort(),[title,title+' (1984)']);
	db.prepare("UPDATE watch_progress SET poster_url='' WHERE title=?").run(old.title);
	globalThis.series=async(t,y)=>{assert.equal(t,title);assert.equal(y,'1984');return {id:65392,poster:'tmdb-cartoon'};};
	const {continueWatchingWithPosters}=await get('server/continueWatching');
	assert.equal((await continueWatchingWithPosters()).find(x=>x.title===old.title).posterUrl,'tmdb-cartoon');
	const { publisherMatches, officialMovies, officialFile, works, nativeConfirmed, nativeRevision, placeEpisode } = await get('server/sources/official');
	assert.equal(new Set(works.map(w=>officialFile(w).fid)).size,works.length);
	const fixture = {id:326359,title:'Frozen Fever',release_date:'2015-03-13'};
	for (const hits of [[],[{...fixture,title:'A Different Film'}],[fixture,{...fixture,id:999}]]) {
		globalThis.publisherTmdb=()=>({results:hits}); assert.deepEqual(await publisherMatches('Frozen Fever',2015,'movie'),[]);
	}
	globalThis.publisherTmdb=(p)=>p==='/search/movie'?{results:[fixture]}:p==='/search/tv'?{results:[{id:8,name:'Alphablocks',first_air_date:'2010-01-01'}]}:p==='/tv/8'?{seasons:[{season_number:1}]}:p==='/tv/8/season/1'?{episodes:[{episode_number:2,name:'A-Z'}]}:null;
	assert.deepEqual(await publisherMatches('Frozen Fever',2015,'movie','movie:99'),[]);
	const alphabet=(await publisherMatches('Alphablocks',2010,'tv','tv:8')).find(w=>w.videoId==='BScgKbbxObk');
	assert.equal(alphabet?.episode,2); // deliberately different uploader numbering
	assert.ok(!nativeConfirmed(alphabet));
	const partialShow={id:8,name:'Alphablocks',seasons:[{number:1,count:2,airDate:'2010-01-01'}]};
	const beforePlaying=await channelFiles(partialShow,100);
	assert.equal(beforePlaying.get('1-2')?.[0].shareKey,'channel:'+alphabet.videoId);
	assert.equal(beforePlaying.has('1-1'),false);
	globalThis.series=async()=>partialShow;
	availabilityNow('Alphablocks','tv','2010');await new Promise(setImmediate);
	const badges=availabilityNow('Alphablocks','tv','2010').sources.filter(s=>s.name.startsWith('YouTube'));
	assert.deepEqual(badges,[{name:'YouTube',state:'listed',tmdb:'tv:8'}]);
	const { GET: status } = await import('../../src/routes/api/watch/available/+server.ts');
	const statusOn = async (ua, tmdb = 'tv:8') => (await status({url:new URL('http://fixture.invalid/?now=1&title=Alphablocks&type=tv&year=2010&tmdb='+tmdb),request:new Request('http://fixture.invalid',{headers:{'user-agent':ua}})})).json();
	assert.equal((await statusOn('Electron/40')).available,true);
	assert.equal((await statusOn('iPhone')).available,true);
	assert.notEqual((await statusOn('CatalogTV/1')).available,true);
	assert.ok(!(await statusOn('Electron/40','tv:9')).sources.some(s=>s.name==='YouTube'));
	const {compile}=await import('svelte/compiler');
	const {render}=await import('svelte/server');
	const js=compile(readFileSync(new URL('SourceChecks.svelte',lib),'utf8'),{filename:'SourceChecks.svelte',generate:'server'}).js.code.replace(/from ['"]svelte\/internal\/server['"]/g,`from '${import.meta.resolve('svelte/internal/server')}'`);
	const {default:Chips}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
	const {body}=render(Chips,{props:{sources:[...badges,{name:'Showbox',state:'yes'}],series:true}});
	assert.equal((body.match(/<li /g)||[]).length,2);
	assert.match(body,/YouTube</);assert.doesNotMatch(body,/<details|<summary|<a\s|Check and play|matched episodes/i);

	q.saveOrderCache('yt-listing-v1|'+alphabet.videoId,'unavailable',Date.now());
	assert.equal((await channelFiles(partialShow,100)).has('1-2'),false);
	q.saveOrderCache('yt-listing-v1|'+alphabet.videoId,'listed',Date.now());
	assert.equal(placeEpisode(alphabet,[1,2].map(episode=>({season:1,episode,name:'A-Z'}))),undefined);
	assert.equal(placeEpisode({...alphabet,episodeTitle:'Another name'},[{season:1,episode:2,name:'A-Z'}]),undefined);
	assert.deepEqual(await publisherMatches('Alphablocks',2010,'tv','tv:9'),[]);
	const {publisherReplayPage,publisherReplay,isPublisherReplay}=await get('server/sources/publisherReplays');
	const params = new URLSearchParams(); const first=publisherReplayPage(params);params.set('offset',first.next);const second=publisherReplayPage(params);
	assert.equal(first.items.length,12);assert.equal(second.items.length,12);assert.ok(!first.items.some(a=>second.items.some(b=>a.id===b.id)));
	const replay=publisherReplay('G3zxz-ewBxc');assert.ok(replay);assert.ok(!publisherReplay(alphabet.videoId));
	assert.ok(!isPublisherReplay({...replay,uploadTitle:'Full match highlights'}));assert.ok(!isPublisherReplay({...replay,title:'Date unresolved'}));
	const search=new URLSearchParams({sport:'soccer',q:'Netherlands Japan'});assert.ok(publisherReplayPage(search).items.some(w=>w.id===replay.videoId && w.poster.includes(replay.videoId)));
	search.set('sport','tennis');assert.equal(publisherReplayPage(search).items.length,0);
	const playback=await get('../routes/api/youtube/play/+server');
	const req=(ua,scope='tv:8',id=alphabet.videoId,e='2')=>({url:new URL(`http://localhost/api/youtube/play?scope=${scope}&v=${id}&s=1&e=${e}`),request:new Request('http://localhost/',{headers:{'user-agent':ua,origin:'http://localhost'}})});
	await assert.rejects(()=>playback.GET(req('CatalogTV/1.0')),e=>e.status===409);
	await assert.rejects(()=>playback.GET(req('Electron/40','replay')),e=>e.status===404);
	await assert.rejects(()=>playback.GET(req('Electron/40','tv:8',alphabet.videoId,'1')),e=>e.status===404);
	await assert.rejects(()=>playback.POST(req('Mozilla/5.0 Electron/40')),e=>e.status===409);
	globalThis.officialIndex={audio:{},video:{}};globalThis.officialSeconds=12;
	await assert.rejects(()=>playback.POST(req('iPhone')),e=>e.status===403);
	const revision=nativeRevision();assert.equal((await playback.POST(req('Electron/40'))).status,204); assert.ok(nativeConfirmed(alphabet));
	assert.equal(nativeRevision(),revision+1); await playback.POST(req('Electron/40'));assert.equal(nativeRevision(),revision+1);
	assert.ok((await publisherMatches('Frozen Fever',2015,'movie')).some(w=>w.videoId==='Lqv0nxlbFcQ'));
	for(const [y,t] of [[2016,'movie'],[2015,'tv'],['','movie']]) assert.deepEqual(await publisherMatches('Frozen Fever',y,t),[]);
	const { videoListing } = await get('server/sources/videoListing');
	const realFetch=globalThis.fetch; let response=200,calls=0; const id='Lqv0nxlbFcQ';
	try {
		globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'www.youtube.com');calls++;return Response.json({type:'video',title:'Frozen Fever',author_name:'Disney Kids'},{status:response})};
		assert.deepEqual(await Promise.all([videoListing(id),videoListing(id)]),['listed','listed']);assert.equal(calls,1);
		assert.equal((await officialMovies('Frozen Fever','2015',fixture.id))[0].shareKey,'channel:'+id);
		// With no usable Showbox share (even if search found one), a confirmed channel file must reach normal Watch.
		globalThis.series=async t=>t==='Alphablocks'?{id:8,name:t,seasons:[{number:1,count:2,airDate:'2010-01-01'}]}:null;
		const {channelStream}=await get('server/sources/channels');
		const show=await globalThis.series('Alphablocks');
		globalThis.list=async()=>({seasons:[1],qualities:[],episodes:[{season:1,episode:2,files:(await channelFiles(show,100)).get('1-2')??[]}]});
		const coord={...alphabet,episodeTitle:null,season:1,episode:2,uploadTitle:'Alphablocks S01E02 | Full Episode'};
		const episode={season:1,episode:2,name:'A-Z'};
		assert.equal(placeEpisode(coord,[episode]),episode);
		assert.equal(placeEpisode({...coord,uploadTitle:'Alphablocks S01E02 | Different episode title'},[episode]),undefined);
		globalThis.showbox=[{id:900,title:'Frozen Fever',type:'movie',info:'2015'}];
		const normalWatch=async(title,type,year)=> (await GET({url:new URL('http://fixture.invalid/resolve?'+new URLSearchParams({title,type,year,nostream:'1'}))})).json();
		const film=await normalWatch('Frozen Fever','movie','2015');assert.equal(film.hasToken,false);assert.equal(film.files.length,1);
		globalThis.showbox=[];
		const tv=await normalWatch('Alphablocks','tv','2010');assert.equal(tv.hasToken,false);assert.equal(tv.episodes.episodes[0].episode,2);
		const tvFiles=tv.episodes.episodes[0].files;assert.equal(tvFiles.length,1);
		for(const [file,video] of [[film.files[0],id],[tvFiles[0],alphabet.videoId]]) {
			assert.equal(file.shareKey,'channel:'+video);
			assert.equal((await channelStream(file.shareKey)).url,`/api/youtube/hls/${video}/main.m3u8`);
		}
		// A full start on both tracks is required, even when an empty capture says it is done.
		for (const [index,seconds] of [[{audio:{},video:{},done:true},0],[{audio:null,video:{}},8],[{audio:{},video:{}},3]]) {
			globalThis.officialSeconds=seconds;globalThis.officialIndex=index;
			const tooEarly=channelStream('channel:'+id);
			await new Promise(r=>setTimeout(r,30));globalThis.officialIndex={error:'fixture stopped'};
			assert.equal((await tooEarly).url,'');
		}
		globalThis.officialSeconds=4;globalThis.officialIndex={audio:{},video:{},done:false};
		assert.equal((await channelStream('channel:'+id)).url,`/api/youtube/hls/${id}/main.m3u8`);
		const open=req('iPhone','replay',replay.videoId);open.url.searchParams.set('open','1');
		await assert.rejects(()=>playback.GET(open),e=>e.status===302 && e.location.endsWith(replay.videoId));
		response=404; assert.equal((await playback.GET(open)).status,410);assert.ok(!publisherReplayPage(new URLSearchParams({q:'Netherlands Japan'})).items.some(w=>w.id===replay.videoId));
		response=404;assert.equal(await videoListing(id,true),'unavailable');assert.deepEqual(await officialMovies('Frozen Fever','2015',fixture.id),[]);
		q.saveOrderCache('yt-listing-v1|'+id,'unavailable',Date.now()-2*3600_000);response=429;assert.equal(await videoListing(id),'unknown');
		q.saveOrderCache('yt-listing-v1|'+id,'unknown',Date.now()-2*60_000);response=200;assert.equal(await videoListing(id),'listed');
	} finally {globalThis.fetch=realFetch}
	// The show listing is not the pilot's file list. Check real matching and selection with only upstream data stubbed.
	const hot = {id:72649,name:'Hot Ones',seasons:[{number:1,count:9,airDate:'2015-03-12'}]};
	const pilot = works.find(w=>w.videoId==='aGhqumcE6_w');
	globalThis.publisherTmdb=p=>p==='/search/tv'?{results:[{id:hot.id,name:hot.name,first_air_date:'2015-03-12'}]}:p==='/tv/72649'?{seasons:[{season_number:1},{season_number:2}]}:p.endsWith('/2')?{episodes:[{id:1333394,episode_number:2,name:'Tinashe'}]}:{episodes:[{id:3010736,episode_number:1,name:'Tony Yayo'},{id:1333386,episode_number:2,name:'Anthony Rizzo'},{id:1333387,episode_number:3,name:'Machine Gun Kelly'}]};
	const hotFiles=await channelFiles(hot,100), yt=hotFiles.get('1-1')[0];
	assert.equal(yt.shareKey,'channel:'+pilot.videoId);
	assert.deepEqual(hotFiles.get('1-2').map(f=>f.shareKey),['channel:4iSCOtYs_6Q']);assert.deepEqual(hotFiles.get('1-3').map(f=>f.shareKey),['channel:H7pSH4YL-T4']);
	assert.deepEqual(hotFiles.get('2-2').map(f=>f.shareKey),['channel:u2r9Lo9-7rY']);
	const holiday=works.find(w=>w.videoId==='uMF8GhkH_SE');
	assert.equal(placeEpisode(holiday,[{id:3376980,name:holiday.episodeTitle,season:0,episode:11}]),undefined);
	const ranger=works.find(w=>w.title==='Power Rangers' && w.episodeTitle==='Blue Saber Saga');
	const branding=[{season:21,episode:1,name:'Super Megaforce',seasonName:'Super Megaforce'},{season:21,episode:3,name:'Blue Saber Saga',seasonName:'Super Megaforce'}];
	assert.equal(placeEpisode(ranger,branding),branding[1]);
	const bundle=works.find(w=>w.videoId==='Fej4TJzR4uw');
	assert.equal(placeEpisode(bundle,['The Caped Avenger','Shy Fly Guy','Green Thumbs Down'].map((name,i)=>({name,season:1,episode:34+i}))),undefined);
	assert.deepEqual(await publisherMatches(hot.name,2015,'tv','tv:1'),[]);
	const {resolveCopies,automaticEpisodeBudget,DISCOVERY_WAIT,episodeFailure}=await get('sourceFallback');
	const {pickFile}=await import(source('watch')+'?real');
	const copy=source=>({source,quality:'HD',size:'',shareKey:source});
	const movy=copy('Movy'), plex=copy('Plex'), vidfast=copy('Vidfast');
	assert.deepEqual(automaticEpisodeBudget([movy,yt],()=>false),{grace:1000});
	assert.deepEqual(automaticEpisodeBudget([movy,copy('7Movies')],()=>false),{grace:1000,limit:DISCOVERY_WAIT});
	assert.deepEqual(automaticEpisodeBudget([movy,yt],()=>true),{});
	assert.deepEqual(automaticEpisodeBudget([movy,plex,yt],()=>false),{});
	assert.equal(pickFile([yt,movy,plex],'1080p'),movy);assert.equal(pickFile([yt],'1080p'),yt);
	const run=(first,rest,ask,opts={})=>resolveCopies(first,rest,{ask,key:f=>f.shareKey,current:()=>true,grace:20,limit:100,burnedWait:1,...opts});
	let attempts=[];const answer=(success)=>async f=>{attempts.push(f);return {url:f===success?'stream':''}};
	assert.equal((await run(movy,[yt,plex],answer(plex))).file,plex);assert.ok(!attempts.includes(yt));
	attempts=[];assert.equal((await run(movy,[yt],answer(yt))).file,yt);assert.deepEqual(attempts,[movy,yt]);
	attempts=[];assert.equal((await run(yt,[plex],answer(yt),{onlyPicked:true})).file,yt);assert.deepEqual(attempts,[yt]);
	attempts=[];const failed=await run(movy,[yt,plex],answer(null));assert.equal(failed.url,'');assert.deepEqual(failed.tried,['Movy','Plex',yt.source]);
	attempts=[];assert.equal((await run(movy,[yt],answer(vidfast),{late:new Promise(r=>setTimeout(()=>r(vidfast),5))})).file,vidfast);assert.deepEqual(attempts,[movy,vidfast]);
	attempts=[];assert.equal((await run(yt,[],answer(vidfast),{late:Promise.resolve(vidfast)})).file,vidfast);assert.deepEqual(attempts,[vidfast]);
	attempts=[];assert.equal((await run(yt,[],answer(yt))).file,yt);assert.deepEqual(attempts,[yt]);
	attempts=[];const explicitMiss=await run(yt,[plex],answer(plex),{onlyPicked:true});
	assert.equal(explicitMiss.url,'');assert.deepEqual(attempts,[yt]);
	const hang=()=>new Promise(()=>{}), slow=copy('AllAnime');
	attempts=[];const afterTimeout=await run(movy,[slow,yt],f=>{attempts.push(f);return f===yt?Promise.resolve({url:'official'}):hang()});
	assert.equal(afterTimeout.file,yt);assert.deepEqual(attempts,[movy,slow,yt]);
	// An empty result from the second lookup must not suppress an outstanding primary.
	const timedOut=await run(movy,[],hang,{limit:25,late:hang()});assert.equal(timedOut.timedOut,true);
	assert.match(episodeFailure({season:2,episode:2},timedOut.tried,true,false),/in time for S2E2\. Tried: Movy\./);
	assert.match(episodeFailure({season:2,episode:2},[],false,true),/S2E2\..*Open this episode in YouTube/);
	const fastMiss=await run(movy,[],answer(null));assert.equal(fastMiss.timedOut,false);
	const pendingPrimary=await run(movy,[yt],f=>f===movy?new Promise(r=>setTimeout(()=>r({url:'primary'}),30)):Promise.resolve({url:''}));
	assert.equal(pendingPrimary.url,'primary');
	// A slow discovery cannot delay opening the only listed fallback. If it finds a real
	// copy while that fallback is starting, the ordinary source can still take over.
	for (const first of [yt,movy]) {
		let discover,started;
		const late=new Promise(resolve=>{discover=resolve}),warming=new Promise(resolve=>{started=resolve});
		const resolution=run(first,first===yt?[]:[yt],async f=>{
			if(f===yt){started();return hang()}
			return {url:f===vidfast?'primary':''};
		},{late,grace:5000,limit:12000});
		let timeout;
		try {await Promise.race([warming,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('unconfirmed discovery blocked fallback startup')),2000)})]);}
		finally {clearTimeout(timeout);discover(vidfast)}
		assert.equal((await resolution).file,vidfast);
	}
	const {noteSourceAnswer,sourceHasNot}=await get('server/sourceAnswers');
	const s1={type:'tv',id:hot.id,season:1,episode:1};noteSourceAnswer('Movy',s1,false);
	assert.ok(sourceHasNot('Movy',s1));assert.ok(!sourceHasNot('Movy',{...s1,episode:2}));assert.ok(!sourceHasNot('Movy',{...s1,season:0}));
	noteSourceAnswer('Movy',s1,true);assert.ok(!sourceHasNot('Movy',s1));
	const scopeChips=render(Chips,{props:{series:true,sources:[{name:'Plex',state:'yes',pilotListed:false},{name:'Xumo Play',state:'yes',pilotListed:true}]}}).body;
	assert.match(scopeChips,/other episodes/);assert.match(scopeChips,/S1E1 listed/);
	const {mixWeekly}=await get('mixWeekly');const groups=[['film1','film2'],['show1','film2'],[],['anime1','anime2']].map(g=>g.map(href=>({href})));
	assert.deepEqual(mixWeekly(groups,5).map(x=>x.href),['film1','show1','anime1','film2','anime2']);
} finally {db.close();rmSync(dir,{recursive:true,force:true});}
console.log('Release identity, legacy progress isolation, posters and TV links, curated source chips, Vidfast evidence, weekly rotation and official video availability passed.');
process.exit(0); // availability checks keep their short-lived UI snapshot on a timer
