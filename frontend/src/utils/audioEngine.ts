import { CONFIG } from '../config/config';
import type { AudioCacheEntry, Clip, ClipSnapshot, EngineVoiceOption } from '../types/tts';

const SAMPLE_RATE = 22050;
const objectUrlCache = new Map<string, string>();
const pcmBufferCache = new Map<string, Int16Array>();

function createBlobUrl(blob: Blob): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  return `blob:mock/${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function encodeWavFromPcm(samples: Int16Array, sampleRate = SAMPLE_RATE): Blob {
  const numChannels = 1;
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function getBaseFrequencyForVoice(engineVoice: string): number {
  const match = CONFIG.ENGINE_VOICES.find((v) => v.engineVoice === engineVoice);
  if (match?.baseFrequency) return match.baseFrequency;
  let hash = 0;
  for (let i = 0; i < engineVoice.length; i++) {
    hash = (hash * 31 + engineVoice.charCodeAt(i)) % 200;
  }
  return 200 + hash;
}

export function extractWaveformPeaks(samples: Int16Array, barCount = 72): number[] {
  if (!samples || samples.length === 0) {
    return Array.from({ length: barCount }, () => 0.35);
  }
  const blockSize = Math.max(1, Math.floor(samples.length / barCount));
  const rawLevels: number[] = [];
  let maxLevel = 1;

  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let peak = 0;
    let sumSq = 0;
    let count = 0;
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let j = start; j < end; j += step) {
      const abs = Math.abs(samples[j]);
      if (abs > peak) peak = abs;
      sumSq += abs * abs;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const blended = peak * 0.65 + rms * 0.55;
    if (blended > maxLevel) maxLevel = blended;
    rawLevels.push(blended);
  }

  return rawLevels.map((p) => {
    const norm = p / maxLevel;
    return norm < 0.04 ? 0.08 : Math.max(0.12, Math.min(1, Math.round(norm * 100) / 100));
  });
}

export function resamplePeaks(peaks: number[], targetCount: number): number[] {
  if (!peaks || peaks.length === 0) return Array.from({ length: targetCount }, () => 0.35);
  if (peaks.length === targetCount) return peaks;
  const out: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const pos = (i / Math.max(1, targetCount - 1)) * (peaks.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(peaks.length - 1, lo + 1);
    const t = pos - lo;
    const val = peaks[lo] * (1 - t) + peaks[hi] * t;
    out.push(Math.round(val * 100) / 100);
  }
  return out;
}

export function getWaveformPeaksForAudio(
  audioId: string,
  targetCount = 72,
  fallbackPeaks?: number[]
): number[] {
  const pcm = pcmBufferCache.get(audioId);
  if (pcm && pcm.length > 0) {
    return extractWaveformPeaks(pcm, targetCount);
  }
  if (fallbackPeaks && fallbackPeaks.length > 0) {
    return resamplePeaks(fallbackPeaks, targetCount);
  }
  return generateDeterministicPeaks(audioId, targetCount);
}

export function generateDeterministicPeaks(seed: string, barCount = 72): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    h = Math.imul(h ^ (i + 17), 16777619);
    const phrase = 0.55 + 0.45 * Math.sin((i / barCount) * Math.PI * 5 + ((h & 7) * 0.4));
    const jitter = ((h >>> 0) % 60) / 100 + 0.25;
    peaks.push(Math.max(0.14, Math.min(1, Math.round(phrase * jitter * 100) / 100)));
  }
  return peaks;
}

/**
 * Generates expressive, speech-cadence harmonic PCM audio for offline preview & playback.
 */
function generateSpeechCadencePcm(durationSec: number, baseFreq: number, text: string): Int16Array {
  const numSamples = Math.max(Math.floor(SAMPLE_RATE * 0.4), Math.floor(SAMPLE_RATE * durationSec));
  const samples = new Int16Array(numSamples);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = Math.max(2, words.length);
  const syllableRateHz = Math.min(6.5, Math.max(2.4, wordCount / Math.max(0.8, durationSec)));

  let seed = 2166136261;
  for (let c = 0; c < text.length; c++) {
    seed = Math.imul(seed ^ text.charCodeAt(c), 16777619);
  }

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    let env = 1.0;
    if (t < 0.05) env = t / 0.05;
    else if (t > durationSec - 0.06) env = Math.max(0, (durationSec - t) / 0.06);

    // Organic word-phrase energy & natural micro-breath dips
    const phrasePhase = Math.sin(2 * Math.PI * (0.65 + (seed % 5) * 0.12) * t + (seed & 7));
    const wordDip = phrasePhase < -0.58 ? 0.16 : 0.45 + 0.55 * Math.abs(phrasePhase);

    const syllableMod =
      0.18 +
      0.82 *
        Math.max(
          0,
          Math.sin(2 * Math.PI * syllableRateHz * t) * 0.65 +
            0.35 * Math.cos(2 * Math.PI * (syllableRateHz * 0.57) * t + (seed & 3))
        );
    const pitchDrift = 1 + 0.08 * Math.sin(2 * Math.PI * 1.45 * t) + 0.03 * Math.cos(2 * Math.PI * 3.1 * t);
    const freq = baseFreq * pitchDrift;

    const wave =
      0.55 * Math.sin(2 * Math.PI * freq * t) +
      0.28 * Math.sin(2 * Math.PI * (freq * 1.5) * t) +
      0.12 * Math.sin(2 * Math.PI * (freq * 2.0) * t);

    const sample = env * wordDip * syllableMod * 0.38 * wave;
    samples[i] = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
  }

  return samples;
}

function waitWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('درخواست لغو شد', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('درخواست لغو شد', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function normalizeRate(rate: number): number {
  const n = Number(rate);
  if (!Number.isFinite(n)) return CONFIG.DEFAULT_RATE;
  return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
}

function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function buildCacheKey(preparedText: string, engineVoice: string, rate: number): string {
  const text = String(preparedText ?? '');
  return `v1|${engineVoice}|${normalizeRate(rate)}|${text.length}|${hashString(text)}`;
}

export async function getEngineVoices(signal?: AbortSignal | null): Promise<EngineVoiceOption[]> {
  if (CONFIG.MOCK) {
    await waitWithSignal(120, signal);
    return CONFIG.ENGINE_VOICES;
  }
  const response = await fetch(`${CONFIG.BASE_URL}/api/voices`, { signal });
  if (!response.ok) {
    throw new Error(`خطا در دریافت صداها (کد ${response.status})`);
  }
  return response.json();
}

export interface SynthesizeParams {
  text: string;
  voice: string;
  rate: number;
}

export interface SynthesizeResult {
  audioId: string;
  url: string;
  durationSec: number;
  waveformPeaks: number[];
  fromCache: boolean;
  cacheInvalidated: boolean;
}

const inflight = new Map<string, Promise<SynthesizeResult>>();

export async function synthesizeSegment(
  params: SynthesizeParams,
  cacheHooks: {
    getCachedAudio: (key: string) => AudioCacheEntry | null;
    setCachedAudio: (key: string, entry: AudioCacheEntry) => void;
    invalidateCacheEntry: (key: string) => void;
  },
  signal?: AbortSignal | null
): Promise<SynthesizeResult> {
  const { text, voice, rate } = params;
  if (!text || !text.trim()) {
    throw new Error('متن پاراگراف نمی‌تواند خالی باشد.');
  }

  const sentRate = normalizeRate(rate);
  const cacheKey = buildCacheKey(text, voice, sentRate);

  while (inflight.has(cacheKey)) {
    try {
      const shared = await inflight.get(cacheKey)!;
      if (signal?.aborted) throw new DOMException('درخواست لغو شد', 'AbortError');
      return { ...shared, fromCache: true, cacheInvalidated: false };
    } catch {
      if (signal?.aborted) throw new DOMException('درخواست لغو شد', 'AbortError');
    }
  }

  const job = (async (): Promise<SynthesizeResult> => {
    const cached = cacheHooks.getCachedAudio(cacheKey);
    if (cached && CONFIG.MOCK) {
      let peaks = cached.waveformPeaks;
      if (!objectUrlCache.has(cached.audioId)) {
        const freq = getBaseFrequencyForVoice(voice);
        const pcm = generateSpeechCadencePcm(cached.durationSec, freq, text);
        pcmBufferCache.set(cached.audioId, pcm);
        objectUrlCache.set(cached.audioId, createBlobUrl(encodeWavFromPcm(pcm)));
        if (!peaks) peaks = extractWaveformPeaks(pcm, 72);
      }
      return {
        audioId: cached.audioId,
        url: cached.url,
        durationSec: cached.durationSec,
        waveformPeaks: peaks || generateDeterministicPeaks(text, 72),
        fromCache: true,
        cacheInvalidated: false,
      };
    }

    if (CONFIG.MOCK) {
      await waitWithSignal(Math.min(950, Math.max(380, text.length * 8)), signal);
      const audioId = `mock_audio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const baseDuration = Math.max(1.4, text.length / 18);
      const durationSec = Math.max(0.8, Math.round((baseDuration / sentRate) * 10) / 10);
      const freq = getBaseFrequencyForVoice(voice);
      const pcm = generateSpeechCadencePcm(durationSec, freq, text);
      const waveformPeaks = extractWaveformPeaks(pcm, 72);
      pcmBufferCache.set(audioId, pcm);
      objectUrlCache.set(audioId, createBlobUrl(encodeWavFromPcm(pcm)));

      const entry: AudioCacheEntry = {
        audioId,
        url: `/api/audio/${audioId}`,
        durationSec,
        waveformPeaks,
      };
      cacheHooks.setCachedAudio(cacheKey, entry);
      return { ...entry, waveformPeaks, fromCache: false, cacheInvalidated: false };
    }

    const response = await fetch(`${CONFIG.BASE_URL}/api/tts/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate: sentRate }),
      signal,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `خطا در تبدیل پاراگراف (کد ${response.status})`);
    }

    const result: AudioCacheEntry = await response.json();
    const waveformPeaks = result.waveformPeaks || generateDeterministicPeaks(text, 24);
    cacheHooks.setCachedAudio(cacheKey, { ...result, waveformPeaks });
    return { ...result, waveformPeaks, fromCache: false, cacheInvalidated: false };
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, job);
  return job;
}

export function getEffectiveClipBounds(clip: Clip): { start: number; end: number; effectiveDuration: number } {
  const total = Math.max(0.2, clip.durationSec || 2.5);
  const start = Math.max(0, Math.min(total - 0.1, clip.trimStartSec ?? 0));
  const end = Math.max(start + 0.1, Math.min(total, clip.trimEndSec ?? total));
  return {
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
    effectiveDuration: Math.round((end - start) * 100) / 100,
  };
}

export async function mergeClips(
  selectedClips: Clip[],
  gapAfterMs: number[],
  signal?: AbortSignal | null
): Promise<{ id: string; url: string; durationSec: number }> {
  if (!selectedClips || selectedClips.length < 1) {
    throw new Error('برای ساخت ویس کامل حداقل ۱ کلیپ لازم است.');
  }

  const normalizedGaps = selectedClips.map((_, idx) =>
    idx === selectedClips.length - 1 ? 0 : (gapAfterMs[idx] ?? CONFIG.DEFAULT_PAUSE_AFTER_MS)
  );

  if (CONFIG.MOCK) {
    await waitWithSignal(450 + selectedClips.length * 100, signal);

    const chunks: Int16Array[] = [];
    let totalSamples = 0;
    let totalTrimmedDuration = 0;

    selectedClips.forEach((clip, idx) => {
      let pcm = pcmBufferCache.get(clip.audioId);
      if (!pcm) {
        const dur = clip.durationSec > 0 ? clip.durationSec : 2.5;
        pcm = generateSpeechCadencePcm(dur, getBaseFrequencyForVoice(clip.engineVoice), clip.text);
        pcmBufferCache.set(clip.audioId, pcm);
      }

      const bounds = getEffectiveClipBounds(clip);
      const startSample = Math.min(pcm.length, Math.floor(bounds.start * SAMPLE_RATE));
      const endSample = Math.min(pcm.length, Math.floor(bounds.end * SAMPLE_RATE));
      const sliced = pcm.slice(startSample, Math.max(startSample + 100, endSample));

      chunks.push(sliced);
      totalSamples += sliced.length;
      totalTrimmedDuration += bounds.effectiveDuration;

      const gapMs = normalizedGaps[idx] || 0;
      if (gapMs > 0) {
        const gapSamples = Math.round((gapMs / 1000) * SAMPLE_RATE);
        chunks.push(new Int16Array(gapSamples));
        totalSamples += gapSamples;
      }
    });

    const mergedPcm = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      mergedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const pausesSumMs = normalizedGaps.reduce((a, b) => a + (b || 0), 0);
    const totalDuration = Math.round((totalTrimmedDuration + pausesSumMs / 1000) * 10) / 10;

    const mergeId = `mock_final_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pcmBufferCache.set(mergeId, mergedPcm);
    objectUrlCache.set(mergeId, createBlobUrl(encodeWavFromPcm(mergedPcm)));

    return {
      id: mergeId,
      url: `/api/audio/${mergeId}`,
      durationSec: totalDuration,
    };
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/tts/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioIds: selectedClips.map((c) => c.audioId),
      gapAfterMs: normalizedGaps,
    }),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `خطا در ادغام کلیپ‌ها (کد ${response.status})`);
  }

  return response.json();
}

export async function getAudioObjectUrl(
  audioId: string,
  fallbackDurationSec = 2.5,
  fallbackVoice = 'fa-male-narrator-1',
  fallbackText = 'پیش نمایش صدا'
): Promise<string> {
  if (!audioId) throw new Error('شناسه صوت نامعتبر است.');

  if (objectUrlCache.has(audioId)) {
    return objectUrlCache.get(audioId)!;
  }

  if (CONFIG.MOCK) {
    const pcm = generateSpeechCadencePcm(
      fallbackDurationSec || 2.5,
      getBaseFrequencyForVoice(fallbackVoice),
      fallbackText
    );
    pcmBufferCache.set(audioId, pcm);
    const url = createBlobUrl(encodeWavFromPcm(pcm));
    objectUrlCache.set(audioId, url);
    return url;
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/audio/${encodeURIComponent(audioId)}`);
  if (!response.ok) {
    throw new Error(`خطا در دریافت فایل صوتی (کد ${response.status})`);
  }
  const blob = await response.blob();
  const url = createBlobUrl(blob);
  objectUrlCache.set(audioId, url);
  return url;
}

export async function previewVoiceAudio(engineVoice: string, sampleText: string): Promise<string> {
  const previewId = `preview_${engineVoice}`;
  if (objectUrlCache.has(previewId)) {
    return objectUrlCache.get(previewId)!;
  }
  if (CONFIG.MOCK) {
    await waitWithSignal(180);
    const durationSec = Math.max(1.2, Math.round((sampleText.length / 18) * 10) / 10);
    const pcm = generateSpeechCadencePcm(durationSec, getBaseFrequencyForVoice(engineVoice), sampleText);
    pcmBufferCache.set(previewId, pcm);
    const url = createBlobUrl(encodeWavFromPcm(pcm));
    objectUrlCache.set(previewId, url);
    return url;
  }
  const res = await synthesizeSegment(
    { text: sampleText, voice: engineVoice, rate: 1.0 },
    { getCachedAudio: () => null, setCachedAudio: () => {}, invalidateCacheEntry: () => {} }
  );
  return getAudioObjectUrl(res.audioId, res.durationSec, engineVoice, sampleText);
}

function slicePeaksRange(peaks: number[] | undefined, startRatio: number, endRatio: number): number[] {
  const src = peaks && peaks.length > 0 ? peaks : [0.45, 0.7, 0.55, 0.85, 0.6, 0.4, 0.75, 0.5];
  const s = Math.max(0, Math.min(src.length - 1, Math.floor(startRatio * src.length)));
  const e = Math.max(s + 1, Math.min(src.length, Math.ceil(endRatio * src.length)));
  return src.slice(s, e);
}

export function sliceClipSnapshotsForCut(
  snapshots: ClipSnapshot[],
  mode: 'cut-middle' | 'keep-range',
  cutStartSec: number,
  cutEndSec: number,
  newTotalDurationSec: number
): ClipSnapshot[] {
  if (!snapshots || snapshots.length === 0) return [];

  type WorkingPiece = {
    snap: ClipSnapshot;
    durationSec: number;
    peaks: number[];
    gapAfterSec: number;
  };

  const pieces: WorkingPiece[] = [];
  let cursor = 0;

  const overlapLen = (a1: number, a2: number, b1: number, b2: number) =>
    Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const segDur = Math.max(0.05, snap.durationSec || 0);
    const segStart = cursor;
    const segEnd = segStart + segDur;
    const gapSec = i < snapshots.length - 1 ? Math.max(0, (snap.pauseAfterMs || 0) / 1000) : 0;
    const gapStart = segEnd;
    const gapEnd = gapStart + gapSec;
    cursor = gapEnd;

    if (mode === 'cut-middle') {
      // Surviving left portion of speech [segStart, min(segEnd, cutStartSec)]
      const leftEnd = Math.min(segEnd, cutStartSec);
      const leftDur = Math.max(0, leftEnd - segStart);

      // Surviving right portion of speech [max(segStart, cutEndSec), segEnd]
      const rightStart = Math.max(segStart, cutEndSec);
      const rightDur = Math.max(0, segEnd - rightStart);

      // Surviving gap portion
      const gapCutOverlap = overlapLen(gapStart, gapEnd, cutStartSec, cutEndSec);
      const survivingGapSec = Math.max(0, gapSec - gapCutOverlap);

      if (leftDur > 0.02 && rightDur > 0.02) {
        // Middle of this single segment was cut out: combine surviving left+right peaks while keeping one snapshot color
        const leftPeaks = slicePeaksRange(snap.waveformPeaks, 0, leftDur / segDur);
        const rightPeaks = slicePeaksRange(snap.waveformPeaks, (rightStart - segStart) / segDur, 1);
        pieces.push({
          snap,
          durationSec: Math.round((leftDur + rightDur) * 100) / 100,
          peaks: [...leftPeaks, ...rightPeaks],
          gapAfterSec: survivingGapSec,
        });
      } else if (leftDur > 0.02) {
        pieces.push({
          snap,
          durationSec: Math.round(leftDur * 100) / 100,
          peaks: slicePeaksRange(snap.waveformPeaks, 0, leftDur / segDur),
          gapAfterSec: survivingGapSec,
        });
      } else if (rightDur > 0.02) {
        pieces.push({
          snap,
          durationSec: Math.round(rightDur * 100) / 100,
          peaks: slicePeaksRange(snap.waveformPeaks, (rightStart - segStart) / segDur, 1),
          gapAfterSec: survivingGapSec,
        });
      } else if (survivingGapSec > 0.02 && pieces.length > 0) {
        pieces[pieces.length - 1].gapAfterSec += survivingGapSec;
      }
    } else {
      // keep-range: keep intersection with [cutStartSec, cutEndSec]
      const keepStart = Math.max(segStart, cutStartSec);
      const keepEnd = Math.min(segEnd, cutEndSec);
      const keepDur = Math.max(0, keepEnd - keepStart);
      const survivingGapSec = overlapLen(gapStart, gapEnd, cutStartSec, cutEndSec);

      if (keepDur > 0.02) {
        pieces.push({
          snap,
          durationSec: Math.round(keepDur * 100) / 100,
          peaks: slicePeaksRange(
            snap.waveformPeaks,
            (keepStart - segStart) / segDur,
            (keepEnd - segStart) / segDur
          ),
          gapAfterSec: survivingGapSec,
        });
      } else if (survivingGapSec > 0.02 && pieces.length > 0) {
        pieces[pieces.length - 1].gapAfterSec += survivingGapSec;
      }
    }
  }

  if (pieces.length === 0) {
    return snapshots.slice(0, 1).map((s) => ({
      ...s,
      durationSec: Math.max(0.2, newTotalDurationSec),
      pauseAfterMs: 0,
    }));
  }

  // Reconcile any tiny rounding drift against exact PCM duration
  const sumDur = pieces.reduce((acc, p, idx) => acc + p.durationSec + (idx < pieces.length - 1 ? p.gapAfterSec : 0), 0);
  const diff = Math.round((newTotalDurationSec - sumDur) * 100) / 100;
  if (Math.abs(diff) > 0.01 && pieces.length > 0) {
    const last = pieces[pieces.length - 1];
    last.durationSec = Math.max(0.05, Math.round((last.durationSec + diff) * 100) / 100);
  }

  return pieces.map((p, idx) => ({
    ...p.snap,
    durationSec: p.durationSec,
    pauseAfterMs: idx === pieces.length - 1 ? 0 : Math.round(p.gapAfterSec * 1000),
    waveformPeaks: p.peaks,
  }));
}

export function applyCutToAudio(
  audioId: string,
  mode: 'cut-middle' | 'keep-range',
  startSec: number,
  endSec: number,
  fallbackDurationSec = 2.5
): { id: string; url: string; durationSec: number; waveformPeaks: number[] } {
  let pcm = pcmBufferCache.get(audioId);
  if (!pcm) {
    const dur = Math.max(0.4, fallbackDurationSec || 2.5);
    pcm = generateSpeechCadencePcm(dur, getBaseFrequencyForVoice('fa-male-narrator-1'), 'خروجی نهایی ویرایش شده');
    pcmBufferCache.set(audioId, pcm);
  }

  const totalSec = pcm.length / SAMPLE_RATE;
  const sSec = Math.max(0, Math.min(totalSec - 0.1, startSec));
  const eSec = Math.max(sSec + 0.1, Math.min(totalSec, endSec));
  const startSample = Math.min(pcm.length, Math.floor(sSec * SAMPLE_RATE));
  const endSample = Math.min(pcm.length, Math.floor(eSec * SAMPLE_RATE));

  const fadeSamples = Math.min(Math.floor(SAMPLE_RATE * 0.008), 180);
  let nextPcm: Int16Array;

  if (mode === 'cut-middle') {
    const leftLen = startSample;
    const rightLen = pcm.length - endSample;
    const remainingLen = leftLen + rightLen;
    if (remainingLen < Math.floor(SAMPLE_RATE * 0.2)) {
      throw new Error('حداقل ۰.۲ ثانیه از صدا باید باقی بماند؛ کل فایل را نمی‌توان حذف کرد.');
    }
    nextPcm = new Int16Array(remainingLen);
    if (leftLen > 0) {
      nextPcm.set(pcm.subarray(0, startSample), 0);
      const lf = Math.min(fadeSamples, leftLen);
      for (let i = 0; i < lf; i++) {
        const gain = (lf - i) / lf;
        nextPcm[leftLen - lf + i] = Math.round(nextPcm[leftLen - lf + i] * gain);
      }
    }
    if (rightLen > 0) {
      nextPcm.set(pcm.subarray(endSample), leftLen);
      const rf = Math.min(fadeSamples, rightLen);
      for (let i = 0; i < rf; i++) {
        const gain = i / rf;
        nextPcm[leftLen + i] = Math.round(nextPcm[leftLen + i] * gain);
      }
    }
  } else {
    const sliceLen = endSample - startSample;
    if (sliceLen < Math.floor(SAMPLE_RATE * 0.2)) {
      throw new Error('بازهٔ انتخابی برای برش باید حداقل ۰.۲ ثانیه باشد.');
    }
    nextPcm = pcm.slice(startSample, endSample);
    const ef = Math.min(fadeSamples, Math.floor(nextPcm.length / 4));
    for (let i = 0; i < ef; i++) {
      const gain = i / ef;
      nextPcm[i] = Math.round(nextPcm[i] * gain);
      nextPcm[nextPcm.length - 1 - i] = Math.round(nextPcm[nextPcm.length - 1 - i] * gain);
    }
  }

  const nextId = `mock_final_edit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const durationSec = Math.round((nextPcm.length / SAMPLE_RATE) * 100) / 100;
  const waveformPeaks = extractWaveformPeaks(nextPcm, 40);
  pcmBufferCache.set(nextId, nextPcm);
  const url = createBlobUrl(encodeWavFromPcm(nextPcm));
  objectUrlCache.set(nextId, url);

  return {
    id: nextId,
    url: `/api/audio/${nextId}`,
    durationSec,
    waveformPeaks,
  };
}

export function applyAudioMasterEffect(
  audioId: string,
  effect: 'normalize' | 'fade',
  fallbackDurationSec = 2.5
): { id: string; url: string; durationSec: number } {
  let pcm = pcmBufferCache.get(audioId);
  if (!pcm) {
    const dur = Math.max(0.4, fallbackDurationSec || 2.5);
    pcm = generateSpeechCadencePcm(dur, getBaseFrequencyForVoice('fa-male-narrator-1'), 'خروجی نهایی ویرایش شده');
    pcmBufferCache.set(audioId, pcm);
  }

  const nextPcm = new Int16Array(pcm.length);
  if (effect === 'normalize') {
    let peak = 1;
    for (let i = 0; i < pcm.length; i++) {
      const a = Math.abs(pcm[i]);
      if (a > peak) peak = a;
    }
    const targetPeak = Math.round(0x7fff * 0.9);
    const gain = Math.min(3.5, targetPeak / peak);
    for (let i = 0; i < pcm.length; i++) {
      nextPcm[i] = Math.round(Math.max(-0x7fff, Math.min(0x7fff, pcm[i] * gain)));
    }
  } else {
    nextPcm.set(pcm);
    const fadeInSamples = Math.min(Math.floor(nextPcm.length * 0.25), Math.floor(SAMPLE_RATE * 0.35));
    const fadeOutSamples = Math.min(Math.floor(nextPcm.length * 0.3), Math.floor(SAMPLE_RATE * 0.45));
    for (let i = 0; i < fadeInSamples; i++) {
      const g = Math.sin(((i / Math.max(1, fadeInSamples)) * Math.PI) / 2);
      nextPcm[i] = Math.round(nextPcm[i] * g);
    }
    for (let i = 0; i < fadeOutSamples; i++) {
      const g = Math.sin(((i / Math.max(1, fadeOutSamples)) * Math.PI) / 2);
      const idx = nextPcm.length - 1 - i;
      nextPcm[idx] = Math.round(nextPcm[idx] * g);
    }
  }

  const nextId = `mock_final_fx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const durationSec = Math.round((nextPcm.length / SAMPLE_RATE) * 100) / 100;
  pcmBufferCache.set(nextId, nextPcm);
  const url = createBlobUrl(encodeWavFromPcm(nextPcm));
  objectUrlCache.set(nextId, url);

  return {
    id: nextId,
    url: `/api/audio/${nextId}`,
    durationSec,
  };
}

export function revokeAudioObjectUrl(audioId: string): void {
  if (objectUrlCache.has(audioId)) {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrlCache.get(audioId)!);
    }
    objectUrlCache.delete(audioId);
  }
  pcmBufferCache.delete(audioId);
}
