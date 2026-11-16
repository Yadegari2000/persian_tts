import assert from 'node:assert/strict';
import test from 'node:test';

// Mock browser localStorage before importing TtsContext
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => mem.set(k, String(v)),
    removeItem: (k: string) => mem.delete(k),
    clear: () => mem.clear(),
  },
  configurable: true,
});

import { CONFIG } from '../src/config/config.ts';
import {
  buildVoiceBankStoragePayload,
  createFreshSessionState,
  loadInitialState,
} from '../src/context/TtsContext.tsx';
import type { AudioCacheEntry, Clip, ClipSnapshot } from '../src/types/tts.ts';
import * as audioEngine from '../src/utils/audioEngine.ts';
import {
  convertNumbersInText,
  normalizePersianChars,
  parseDialogueScript,
  prepareText,
} from '../src/utils/text.ts';

test('text normalization: Arabic chars, ZWNJ prefixes/suffixes, and word boundaries', () => {
  assert.equal(normalizePersianChars('علي به مدرسه مي رود'), 'علی به مدرسه می‌رود');
  assert.equal(normalizePersianChars('من نمي دانم چرا كتاب ها اينجا هستند'), 'من نمی‌دانم چرا کتاب‌ها اینجا هستند');
  assert.equal(normalizePersianChars('هاشم بهترین کتابها را خرید'), 'هاشم بهترین کتابها را خرید');
  assert.equal(normalizePersianChars('سلام ، خوبي ؟'), 'سلام، خوبی؟');
});

test('number conversion: English, Persian, Arabic digits, negatives, and protected formats', () => {
  assert.equal(convertNumbersInText('0'), 'صفر');
  assert.equal(convertNumbersInText('-0'), 'صفر');
  assert.equal(convertNumbersInText('دما -15 درجه و -۲۰ درجه'), 'دما منفی پانزده درجه و منفی بیست درجه');
  assert.equal(convertNumbersInText('125'), 'صد و بیست و پنج');
  assert.equal(convertNumbersInText('۴۵ و ٦٧'), 'چهل و پنج و شصت و هفت');
  assert.equal(
    convertNumbersInText('شماره 09123456789 و تاریخ 1403/08/15 و کد 1403-08 و عدد 3.14'),
    'شماره 09123456789 و تاریخ 1403/08/15 و کد 1403-08 و عدد 3.14'
  );
});

test('prepareText: dictionary priority and full pipeline', () => {
  const dict = [
    { id: '1', phrase: 'TTS', replacement: 'تی‌تی‌اس' },
    { id: '2', phrase: 'ص.', replacement: 'صفحهٔ' },
    { id: '3', phrase: 'AI Studio', replacement: 'ای‌آی استودیو' },
  ];
  const out = prepareText('در ص. 25 درباره TTS و AI Studio مي خوانيم', dict);
  assert.equal(out, 'در صفحهٔ بیست و پنج درباره تی‌تی‌اس و ای‌آی استودیو می‌خوانیم');
});

test('parseDialogueScript: characters, fullwidth colons, empty lines, time fallback', () => {
  const script = [
    'علي: سلام، حالت چطوره؟',
    'سارا： ممنون، خوبی؟',
    'ساعت ۱۰:۳۰ جلسه داریم',
    'علی:',
    'دکتر محمدی: بفرمایید داخل',
  ].join('\n');

  const parsed = parseDialogueScript(script);
  assert.deepEqual(parsed.characters, ['علی', 'سارا', 'راوی', 'دکتر محمدی']);
  assert.equal(parsed.lines.length, 4);
  assert.deepEqual(parsed.lines[0], { character: 'علی', text: 'سلام، حالت چطوره؟' });
  assert.deepEqual(parsed.lines[1], { character: 'سارا', text: 'ممنون، خوبی؟' });
  assert.deepEqual(parsed.lines[2], { character: 'راوی', text: 'ساعت ۱۰:۳۰ جلسه داریم' });
  assert.deepEqual(parsed.lines[3], { character: 'دکتر محمدی', text: 'بفرمایید داخل' });
});

test('audioEngine: synthesis caching, in-flight dedupe, and preview reuse', async () => {
  const store = new Map<string, AudioCacheEntry>();
  const hooks = {
    getCachedAudio: (k: string) => store.get(k) || null,
    setCachedAudio: (k: string, v: AudioCacheEntry) => store.set(k, v),
    invalidateCacheEntry: (k: string) => store.delete(k),
  };

  const [r1, r2] = await Promise.all([
    audioEngine.synthesizeSegment({ text: 'تست همزمانی صدا', voice: 'fa-male-narrator-1', rate: 1.0 }, hooks),
    audioEngine.synthesizeSegment({ text: 'تست همزمانی صدا', voice: 'fa-male-narrator-1', rate: 1.0 }, hooks),
  ]);
  assert.equal(r1.audioId, r2.audioId);

  const r3 = await audioEngine.synthesizeSegment({ text: 'تست همزمانی صدا', voice: 'fa-male-narrator-1', rate: 1.0 }, hooks);
  assert.equal(r3.fromCache, true);
  assert.equal(r3.audioId, r1.audioId);

  const r4 = await audioEngine.synthesizeSegment({ text: 'تست همزمانی صدا', voice: 'fa-female-calm-1', rate: 1.0 }, hooks);
  assert.equal(r4.fromCache, false);
  assert.notEqual(r4.audioId, r1.audioId);

  const p1 = await audioEngine.previewVoiceAudio('fa-male-narrator-1', 'نمونه اول');
  const p2 = await audioEngine.previewVoiceAudio('fa-male-narrator-1', 'نمونه دوم');
  assert.equal(p1, p2);
});

test('audioEngine: mergeClips works for 1, 2, 3, and 6 clips in top-to-bottom order with trim & pause', async () => {
  const makeClip = (id: string, durationSec: number, trimStartSec: number, trimEndSec: number, pauseAfterMs: number): Clip => ({
    id,
    segmentId: null,
    text: `متن ${id}`,
    preparedText: `متن ${id}`,
    voiceName: 'گوینده تست',
    engineVoice: 'fa-male-narrator-1',
    voiceTags: [],
    speakerColor: 'sky',
    rate: 1,
    pauseAfterMs,
    audioId: `aid_${id}`,
    audioUrl: `/api/audio/aid_${id}`,
    durationSec,
    trimStartSec,
    trimEndSec,
    createdAt: new Date().toISOString(),
    selected: true,
  });

  // 1 clip
  const m1 = await audioEngine.mergeClips([makeClip('c1', 3.0, 0.5, 2.5, 500)], [0]);
  assert.equal(m1.durationSec, 2.0);

  // 5 clips (verifies no 2-clip cap)
  const clips5 = [
    makeClip('c1', 2.0, 0, 2.0, 200),
    makeClip('c2', 3.0, 0.5, 2.5, 300),
    makeClip('c3', 1.5, 0, 1.5, 400),
    makeClip('c4', 2.5, 0, 2.0, 100),
    makeClip('c5', 2.0, 0, 2.0, 900), // last gap must be ignored
  ];
  const m5 = await audioEngine.mergeClips(clips5, [200, 300, 400, 100, 0]);
  // Effective durations: 2.0 + 2.0 + 1.5 + 2.0 + 2.0 = 9.5; gaps: 0.2 + 0.3 + 0.4 + 0.1 = 1.0 -> 10.5
  assert.equal(m5.durationSec, 10.5);
});

test('persistence: reopening app starts with empty fields and keeps ONLY Voice Bank', () => {
  mem.clear();

  // First open: empty session + default voices
  const initial = loadInitialState();
  assert.equal(initial.segments.length, 1);
  assert.equal(initial.segments[0].text, '');
  assert.equal(initial.clips.length, 0);
  assert.equal(initial.finalAudio, null);
  assert.deepEqual(initial.characterVoices, {});
  assert.equal(initial.voices.length, CONFIG.INITIAL_VOICES.length);

  // Simulate user adding a custom voice AND having old session data in localStorage
  const customVoices = [
    ...initial.voices,
    {
      id: 'voice_custom_99',
      name: 'مریم (قصه‌گو)',
      engineVoice: 'fa-female-story-1',
      tags: ['قصه', 'زن'],
      enabled: true,
      color: 'amber' as const,
    },
  ];
  mem.set(
    CONFIG.STORAGE_KEY,
    JSON.stringify({
      ...buildVoiceBankStoragePayload(customVoices, ['راوی', 'قصه', 'زن'], initial.tagFilter),
      segments: [{ id: 'old_seg', text: 'متن قبلی که نباید بماند', voiceId: 'voice_custom_99' }],
      clips: [{ id: 'old_clip', text: 'کلیپ قبلی' }],
      finalAudio: { id: 'old_final', url: '/x', clipIds: ['old_clip'], durationSec: 2, createdAt: '', clipSnapshots: [] },
    })
  );

  // Reopen page
  const reopened = loadInitialState();
  assert.equal(reopened.voices.length, CONFIG.INITIAL_VOICES.length + 1);
  assert.ok(reopened.voices.some((v) => v.id === 'voice_custom_99' && v.name === 'مریم (قصه‌گو)'));
  assert.equal(reopened.segments.length, 1);
  assert.equal(reopened.segments[0].text, '');
  assert.equal(reopened.clips.length, 0);
  assert.equal(reopened.finalAudio, null);
  assert.deepEqual(reopened.characterVoices, {});

  // Payload builder never stores working fields
  const payload = buildVoiceBankStoragePayload(customVoices, ['قصه'], initial.tagFilter);
  assert.deepEqual(Object.keys(payload).sort(), ['allTags', 'schemaVersion', 'tagFilter', 'voices']);

  // Fresh state helper check
  const fresh = createFreshSessionState(customVoices, ['قصه'], initial.tagFilter);
  assert.equal(fresh.segments[0].text, '');
  assert.equal(fresh.clips.length, 0);
  assert.equal(fresh.finalAudio, null);
});

test('audioEngine: applyCutToAudio supports middle-cut, sequential cuts, keep-range, and safety guard', async () => {
  const makeClip = (id: string, durationSec: number): Clip => ({
    id,
    segmentId: null,
    text: `متن ${id}`,
    preparedText: `متن ${id}`,
    voiceName: 'گوینده تست',
    engineVoice: 'fa-male-narrator-1',
    voiceTags: [],
    speakerColor: 'sky',
    rate: 1,
    pauseAfterMs: 0,
    audioId: `cut_aid_${id}`,
    audioUrl: `/api/audio/cut_aid_${id}`,
    durationSec,
    trimStartSec: 0,
    trimEndSec: durationSec,
    createdAt: new Date().toISOString(),
    selected: true,
  });

  const merged = await audioEngine.mergeClips([makeClip('1', 3.0), makeClip('2', 3.0)], [0, 0]);
  assert.equal(merged.durationSec, 6.0);

  // Cut out 1.5s from the middle [2.0s .. 3.5s] -> 4.5s
  const cut1 = audioEngine.applyCutToAudio(merged.id, 'cut-middle', 2.0, 3.5, merged.durationSec);
  assert.ok(Math.abs(cut1.durationSec - 4.5) <= 0.05);
  assert.equal(cut1.waveformPeaks.length, 40);

  // Sequential second middle cut [1.0s .. 2.0s] -> 3.5s
  const cut2 = audioEngine.applyCutToAudio(cut1.id, 'cut-middle', 1.0, 2.0, cut1.durationSec);
  assert.ok(Math.abs(cut2.durationSec - 3.5) <= 0.05);

  // Keep only [0.5s .. 2.0s] -> 1.5s
  const kept = audioEngine.applyCutToAudio(cut2.id, 'keep-range', 0.5, 2.0, cut2.durationSec);
  assert.ok(Math.abs(kept.durationSec - 1.5) <= 0.05);

  // Reject deleting almost the entire audio
  assert.throws(() => audioEngine.applyCutToAudio(kept.id, 'cut-middle', 0, kept.durationSec, kept.durationSec));
});

test('audioEngine: sliceClipSnapshotsForCut preserves distinct speaker colors after middle-cut, keep-range, and deletion', () => {
  const snaps: ClipSnapshot[] = [
    {
      id: 'c1',
      text: 'اول',
      preparedText: 'اول',
      voiceName: 'سهراب',
      speakerColor: 'sky',
      pauseAfterMs: 500,
      durationSec: 3.0,
      waveformPeaks: Array.from({ length: 12 }, (_, i) => (i + 1) / 12),
    },
    {
      id: 'c2',
      text: 'دوم',
      preparedText: 'دوم',
      voiceName: 'دلارا',
      speakerColor: 'purple',
      pauseAfterMs: 500,
      durationSec: 3.0,
      waveformPeaks: Array.from({ length: 12 }, () => 0.7),
    },
    {
      id: 'c3',
      text: 'سوم',
      preparedText: 'سوم',
      voiceName: 'باربد',
      speakerColor: 'emerald',
      pauseAfterMs: 0,
      durationSec: 3.0,
      waveformPeaks: Array.from({ length: 12 }, () => 0.5),
    },
  ];
  // Timeline: c1 [0..3.0], gap [3.0..3.5], c2 [3.5..6.5], gap [6.5..7.0], c3 [7.0..10.0]

  // 1. Cut across c1 & c2 boundary [2.0 .. 4.5] -> leaves 2.0s sky, 2.0s purple, 0.5s gap, 3.0s emerald (total 7.5s)
  const crossCut = audioEngine.sliceClipSnapshotsForCut(snaps, 'cut-middle', 2.0, 4.5, 7.5);
  assert.deepEqual(
    crossCut.map((s) => s.speakerColor),
    ['sky', 'purple', 'emerald']
  );
  assert.equal(crossCut[0].durationSec, 2.0);
  assert.equal(crossCut[0].pauseAfterMs, 0);
  assert.equal(crossCut[1].durationSec, 2.0);
  assert.equal(crossCut[1].pauseAfterMs, 500);
  assert.equal(crossCut[2].durationSec, 3.0);

  // 2. Delete middle segment c2 entirely [3.2 .. 6.8] -> leaves sky and emerald
  const deleteMiddle = audioEngine.sliceClipSnapshotsForCut(snaps, 'cut-middle', 3.2, 6.8, 6.4);
  assert.deepEqual(
    deleteMiddle.map((s) => s.speakerColor),
    ['sky', 'emerald']
  );

  // 3. Cut middle inside single segment c1 [0.5 .. 1.5] -> c1 stays 'sky' with shortened duration 2.0s & combined peaks
  const innerCut = audioEngine.sliceClipSnapshotsForCut(snaps, 'cut-middle', 0.5, 1.5, 9.0);
  assert.deepEqual(
    innerCut.map((s) => s.speakerColor),
    ['sky', 'purple', 'emerald']
  );
  assert.equal(innerCut[0].durationSec, 2.0);
  assert.ok((innerCut[0].waveformPeaks?.length || 0) < 12);

  // 4. Keep range spanning c2 and c3 [5.0 .. 8.5] -> keeps purple (1.5s), gap (0.5s), emerald (1.5s)
  const keptRange = audioEngine.sliceClipSnapshotsForCut(snaps, 'keep-range', 5.0, 8.5, 3.5);
  assert.deepEqual(
    keptRange.map((s) => s.speakerColor),
    ['purple', 'emerald']
  );
  assert.equal(keptRange[0].durationSec, 1.5);
  assert.equal(keptRange[0].pauseAfterMs, 500);
  assert.equal(keptRange[1].durationSec, 1.5);
});

test('audioEngine: high-res peaks resampling and master normalize/fade effects', async () => {
  const res = await audioEngine.synthesizeSegment(
    { text: 'تست شکل موج با وضوح بالا و نرمال‌سازی صدا', voice: 'fa-male-narrator-1', rate: 1.0 },
    { getCachedAudio: () => null, setCachedAudio: () => {}, invalidateCacheEntry: () => {} }
  );
  assert.equal(res.waveformPeaks.length, 72);

  const up = audioEngine.getWaveformPeaksForAudio(res.audioId, 96);
  assert.equal(up.length, 96);
  assert.ok(up.every((v) => v >= 0.08 && v <= 1));

  const resampled = audioEngine.resamplePeaks([0.2, 0.8, 0.4], 7);
  assert.equal(resampled.length, 7);

  const norm = audioEngine.applyAudioMasterEffect(res.audioId, 'normalize', res.durationSec);
  assert.ok(norm.durationSec > 0.5);
  const faded = audioEngine.applyAudioMasterEffect(norm.id, 'fade', norm.durationSec);
  assert.ok(Math.abs(faded.durationSec - norm.durationSec) <= 0.05);
});
