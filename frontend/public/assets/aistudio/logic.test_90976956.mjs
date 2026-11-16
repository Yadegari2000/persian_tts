import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const { CONFIG } = await import('./config.js');
const store = await import('./state.js');
const api = await import('./api.js');
const { parseDialogueScript, generateSrtContent } = await import('./text.js');

let n = 0; const ok = (name) => console.log('✓', ++n, name);

// ---- parser
{
  const r = parseDialogueScript('علي: سلام\nسارا : خوبی؟\nساعت ۸:۳۰ شد\nعلی:\n\nراوی: پایان');
  assert.deepEqual(r.characters, ['علی', 'سارا', 'راوی']);
  assert.equal(r.lines.length, 4);
  assert.equal(r.lines[2].character, 'راوی');               // time-like line → narrator, whole line kept
  assert.equal(r.lines[2].text, 'ساعت ۸:۳۰ شد');
  assert.equal(r.lines[0].character, 'علی');                // Arabic yeh unified
  ok('parser: names, narrator fallback, empty-turn skipped');
}

// ---- SRT
{
  const srt = generateSrtContent([
    { text: 'سلام', durationSec: 2.5, pauseAfterMs: 300 },
    { text: '', durationSec: 1, pauseAfterMs: 0 },            // skipped (no text) but time still advances
    { text: 'خط اول\n\nخط دوم', durationSec: 0.9996, pauseAfterMs: 500 },
    { text: 'آخر', durationSec: 1.2, pauseAfterMs: 999 }     // last pause ignored
  ]);
  const blocks = srt.trim().split('\n\n');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0], '1\n00:00:00,000 --> 00:00:02,500\nسلام');
  // clip2 starts 2.5+0.3 = 2.8 ; empty clip 1s + 0 pause → 3.8 ; clip3 starts 3.8, ends 4.7996→4,800 (no ",1000")
  assert.equal(blocks[1], '2\n00:00:03,800 --> 00:00:04,800\nخط اول\nخط دوم');
  assert.ok(blocks[2].startsWith('3\n00:00:05,300 --> 00:00:06,500'));
  assert.equal(generateSrtContent([]), '');
  ok('SRT: numbering, ms rounding, pauses move only next cue, last pause ignored, no blank lines in cue');
}

// ---- store: dialogue
store.loadState();
const st = store.getState();
const [v1, v2, v3] = st.voices;
store.setCharacterVoice('علی', v1.id);
assert.equal(store.setCharacterVoice('سارا', 'voice-does-not-exist'), false);
store.applyDialogueLines([{ character: 'علی', text: 'سلام' }, { character: 'سارا', text: 'خوبی؟' }, { character: 'علی', text: 'مرسی' }]);
assert.equal(st.segments[0].voiceId, v1.id);
assert.equal(st.segments[1].voiceId, '');               // unmapped → unassigned, never guessed
assert.equal(st.segments[1].characterName, 'سارا');
assert.equal(store.getCharacterSummary().find(c => c.name === 'سارا').unresolved, 1);
ok('dialogue: unmapped character stays unassigned; invalid voice rejected');

// persistence round trip (characterName & '' survive reload)
store.loadState();
const st2 = store.getState();
assert.equal(st2.segments[1].voiceId, '');
assert.equal(st2.segments[1].characterName, 'سارا');
assert.equal(st2.characterVoices['علی'], v1.id);
ok('dialogue: persists through localStorage reload');

// map + export/import
store.setCharacterVoice('سارا', v2.id);
assert.equal(store.getState().segments[1].voiceId, v2.id);
const exported = store.exportProjectJSON();
store.removeCharacterVoice('سارا');
assert.equal(store.getState().segments[1].voiceId, '');
store.importProjectJSON(exported);
assert.equal(store.getState().characterVoices['سارا'], v2.id);
assert.equal(store.getState().segments[1].voiceId, v2.id);
ok('dialogue: mapping included in export/import');

// import with a dead voice in mapping + segment
{
  const obj = JSON.parse(exported);
  obj.data.characterVoices['علی'] = 'ghost-voice';
  obj.data.segments[0].voiceId = 'ghost-voice';
  store.importProjectJSON(JSON.stringify(obj));
  const s = store.getState();
  assert.equal(s.characterVoices['علی'], undefined);
  assert.equal(s.segments[0].voiceId, '');
  ok('import: mapping to missing voice dropped, paragraph unassigned (not re-voiced)');
}

// delete voice
store.importProjectJSON(exported);
const res = store.deleteVoice(v2.id);
assert.equal(res.unassignedCount, 1);
assert.equal(store.getState().segments[1].voiceId, '');
assert.equal(store.getState().characterVoices['سارا'], undefined);
ok('deleteVoice: dialogue paragraphs become unassigned, mapping removed');

// undo keeps things consistent
store.undo();
ok('undo does not throw');

// ---- cache
store.importProjectJSON(exported);
CONFIG.MOCK = true;
const voice = store.getState().voices[0].engineVoice;
const a = await api.synthesizeSegment({ text: 'سلام دنیا', voice, rate: 1 });
const b = await api.synthesizeSegment({ text: 'سلام دنیا', voice, rate: 1.0 });
assert.equal(a.fromCache, false); assert.equal(b.fromCache, true); assert.equal(a.audioId, b.audioId);
const c = await api.synthesizeSegment({ text: 'سلام دنیا', voice, rate: 1.1 });
const d = await api.synthesizeSegment({ text: 'سلام دنیا ', voice, rate: 1 });
const e = await api.synthesizeSegment({ text: 'سلام دنیا', voice: 'other-voice', rate: 1 });
assert.ok(!c.fromCache && !d.fromCache && !e.fromCache);
ok('cache: hit only for same preparedText+engineVoice+rate');

// every success → new clip with own id, same audio file
const seg = store.getState().segments[0];
const clipA = store.addClipFromSegment(seg, a, 'سلام دنیا');
const clipB = store.addClipFromSegment(seg, b, 'سلام دنیا');
assert.notEqual(clipA.id, clipB.id); assert.equal(clipA.audioId, clipB.audioId);
ok('cache: new clip id per conversion, shared audioId');

// in-flight dedupe
{
  const [x, y] = await Promise.all([
    api.synthesizeSegment({ text: 'متن یکتا برای همزمانی', voice, rate: 1 }),
    api.synthesizeSegment({ text: 'متن یکتا برای همزمانی', voice, rate: 1 })
  ]);
  assert.equal(x.audioId, y.audioId);
  ok('cache: concurrent identical requests share one synthesis');
}

// cache holds only references (no audio data, short keys)
{
  const raw = JSON.parse(mem.get(CONFIG.STORAGE_KEY));
  const keys = Object.keys(raw.audioCache);
  assert.ok(keys.every(k => k.length < 90 && k.startsWith('v1|')));
  assert.ok(Object.values(raw.audioCache).every(v => Object.keys(v).sort().join() === 'audioId,durationSec,url'));
  ok('cache: metadata-only, compact keys');
}

// shared audio & deletion
{
  const r1 = store.removeClip(clipA.id);
  assert.equal(r1.sharedWithClips, true); assert.equal(r1.audioStillReferenced, true);
  const r2 = store.removeClip(clipB.id);
  assert.equal(r2.sharedWithClips, false);
  assert.equal(r2.audioStillReferenced, true);                // still in cache → not released
  assert.equal(store.getState().finalAudio, null);
  ok('removeClip: shared / cached audio reported as still referenced');
}

// 404 on playback invalidates cache, clips stay
{
  CONFIG.MOCK = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const clip = store.addClipFromSegment(seg, a, 'سلام دنیا');
  const before = Object.keys(store.getState().audioCache).length;
  await assert.rejects(api.getAudioObjectUrl('not-in-blob-cache-' + a.audioId.slice(0, 0) + 'zzz'), /404/);
  // real file id of cached entry:
  const objUrlCache = null;
  await assert.rejects(api.getAudioObjectUrl(clip.audioId + '_gone'), (err) => err.isNotFound === true);
  store.setCachedAudio('v1|x|1|1|a', { audioId: 'gone-1', url: '/api/audio/gone-1', durationSec: 1 });
  await assert.rejects(api.getAudioObjectUrl('gone-1'), (err) => err.cacheInvalidated === true && /کش/.test(err.message));
  assert.equal(store.getCachedAudio('v1|x|1|1|a'), null);
  assert.ok(store.getState().clips.some(c => c.id === clip.id));   // clips untouched
  ok('404: cache entry invalidated, clips kept');

  // HEAD 404 on cache hit → re-synthesize flag
  store.setCachedAudio(store.buildCacheKey('متن کش شده', voice, 1), { audioId: 'dead-file', url: '/api/audio/dead-file', durationSec: 2 });
  let calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(opts.method || 'GET');
    if (opts.method === 'HEAD') return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ audioId: 'fresh-1', url: '/api/audio/fresh-1', durationSec: 2.2 }) };
  };
  const rr = await api.synthesizeSegment({ text: 'متن کش شده', voice, rate: 1 });
  assert.equal(rr.cacheInvalidated, true); assert.equal(rr.fromCache, false); assert.equal(rr.audioId, 'fresh-1');
  assert.deepEqual(calls, ['HEAD', 'POST']);
  assert.equal(store.getCachedAudio(store.buildCacheKey('متن کش شده', voice, 1)).audioId, 'fresh-1');
  ok('HEAD 404 on cached file → invalidated + re-synthesized');
  globalThis.fetch = realFetch;
  CONFIG.MOCK = true;
}

// ---- merge ↔ SRT consistency (MOCK)
{
  const s2 = store.getState();
  s2.clips = [];
  const segs = s2.segments;
  const c1 = store.addClipFromSegment(segs[0], { audioId: 'a1', url: '/a1', durationSec: 2.5 }, 'یک');
  const c2 = store.addClipFromSegment(segs[1], { audioId: 'a2', url: '/a2', durationSec: 3.1 }, 'دو');
  store.updateClipPause(c1.id, 400);
  store.updateClipPause(c2.id, 700); // last → must not count
  const selected = [...s2.clips].reverse(); // c1, c2 order
  const gaps = selected.map((c, i) => i === selected.length - 1 ? 0 : c.pauseAfterMs);
  const merged = await api.mergeClips({ audioIds: selected.map(c => c.audioId), gapAfterMs: gaps });
  store.setFinalAudio(merged, selected, gaps);
  const snaps = store.getState().finalAudio.clipSnapshots;
  assert.equal(snaps[1].pauseAfterMs, 0);
  assert.equal(merged.durationSec, 2.5 + 3.1 + 0.4);
  const srt = generateSrtContent(snaps);
  assert.ok(srt.includes('00:00:02,900 --> 00:00:06,000'));        // 2.5+0.4 → 2.9 ; +3.1 → 6.0 = merged length
  ok('final audio: merged duration == SRT end; snapshot stores effective gaps');
}

console.log('ALL OK');
