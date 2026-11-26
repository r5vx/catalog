import assert from 'node:assert/strict';
import { captionLanguage, readCues } from '../../electron/youtubeCaptions.cjs';
import { youtubeCaptionId, youtubeCaptionOptions } from '../../src/lib/youtubeCaptionOptions.ts';

const id = 'u2r9Lo9-7rY', other = '4iSCOtYs_6Q';
const path = `/api/youtube/hls/${id}/main.m3u8`;
assert.equal(youtubeCaptionId(path), id);
assert.equal(youtubeCaptionId('https://example.org' + path), '');
assert.equal(youtubeCaptionId('/api/relay?url=' + path), '');
const address = `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr&fmt=json3`;
assert.equal(captionLanguage(address, id), 'en');
for (const url of [address.replace(id,other), address.replace('youtube.com','example.org'),address.replace('kind=asr','kind=manual'), address + '&tlang=fr', address.replace('json3','vtt')]) assert.equal(captionLanguage(url,id), null);
for (const body of ['', 'invalid', '{}', '{"events":[{},null]}']) assert.deepEqual(readCues(body), []);
const cues = readCues(JSON.stringify({events:[
	{tStartMs:3000,dDurationMs:7000,segs:[{utf8:'first '},{utf8:'line'}]},
	{tStartMs:4000,dDurationMs:5000,segs:[{utf8:'\n'}]},
	{tStartMs:5200,dDurationMs:2200,segs:[{utf8:'<img> & more'}]},
	{tStartMs:-10,dDurationMs:2,segs:[{utf8:'skip'}]}]}));
assert.deepEqual(cues,[{start:3,end:5.2,text:'first line'},{start:5.2,end:7.4,text:'<img> & more'}]);
const reply = {id,tracks:[{lang:'en',cues}]};
const [sub] = youtubeCaptionOptions(id,reply);
assert.equal(sub.id,`youtube-asr:${id}:en`);
assert.equal(sub.fileName,'English (auto-generated)');
assert.equal(sub.cues.at(-1).text,'&lt;img&gt; &amp; more');
assert.deepEqual(youtubeCaptionOptions(other,reply),[]);
assert.deepEqual(youtubeCaptionOptions('',reply),[]);
assert.deepEqual(youtubeCaptionOptions(id,{id,tracks:[{lang:'en',cues:[null,{start:0,end:0,text:'no'}]}]}),[]);
console.log('YouTube captions: exact upload and ASR language, empty/malformed replies, timing, escaped text and source isolation passed.');
