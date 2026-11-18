/**
 * API & Network Layer
 * All external communication and MOCK simulations are strictly isolated here.
 * Phase 3: Audio cache integration via store.getCachedAudio / setCachedAudio.
 */

import { CONFIG } from './config_ee5ea529.js';
import * as store from './state_d8f7fb5f.js';

// In-memory cache for temporary Object URLs (never saved to localStorage)
const objectUrlCache = new Map();

/**
 * Generate a simple valid in-memory PCM WAV audio blob for MOCK mode.
 * Creates an audible synthetic tone with pleasant fade in/out so controls can play sound.
 */
function createMockWavBlob(durationSec = 2.5, frequency = 440) {
  const sampleRate = 22050;
  const numChannels = 1;
  const numSamples = Math.floor(sampleRate * durationSec);
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write RIFF header
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);            // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate gentle speech-like harmonic sine wave with envelope
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Envelope: fade in 0.1s, fade out 0.1s
    let env = 1.0;
    if (t < 0.1) env = t / 0.1;
    else if (t > durationSec - 0.1) env = Math.max(0, (durationSec - t) / 0.1);

    // Harmonic blend
    const sample = env * 0.4 * (
      Math.sin(2 * Math.PI * frequency * t) +
      0.3 * Math.sin(2 * Math.PI * (frequency * 1.5) * t)
    );

    const intSample = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Utility to simulate network latency with AbortSignal support.
 */
function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('درخواست لغو شد', 'AbortError'));
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

/**
 * Fetch available technical voices from the backend or MOCK.
 */
export async function getVoices(signal = null) {
  if (CONFIG.MOCK) {
    await waitWithSignal(250, signal);
    return [
      { id: "fa-male-narrator-1", engineVoice: "fa-male-narrator-1", name: "صدای مرد (راوی کتاب)" },
      { id: "fa-female-calm-1", engineVoice: "fa-female-calm-1", name: "صدای زن (پادکست و گفتگو)" },
      { id: "fa-male-news-1", engineVoice: "fa-male-news-1", name: "صدای مرد (خبری و رسا)" },
      { id: "fa-female-story-1", engineVoice: "fa-female-story-1", name: "صدای زن (قصه و کودک)" }
    ];
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/voices`, { signal });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `خطا در دریافت صداها (کد ${response.status})`);
  }
  return await response.json();
}

// Identical requests (same cache key) that are in flight at the same time share ONE synthesis
// (e.g. a repeated dialogue line inside a concurrent batch).
const inflight = new Map();

/**
 * Synthesize a single text segment.
 * POST /api/tts/segment
 *
 * Cache key = actually-sent preparedText + engineVoice + normalized rate.
 * A cache hit reuses the stored audio reference; the CALLER still creates a new clip
 * with its own id. On a 404 of the cached file the entry is invalidated, the request is
 * re-synthesized and the result carries `cacheInvalidated: true` (existing clips are untouched).
 *
 * @returns {Promise<{audioId: string, url: string, durationSec: number, fromCache: boolean, cacheInvalidated: boolean}>}
 */
export async function synthesizeSegment({ text, voice, rate = 1.0 }, signal = null) {
  if (!text || !text.trim()) {
    throw new Error('متن پاراگراف نمی‌تواند خالی باشد.');
  }

  const sentRate = store.normalizeRate(rate);
  const cacheKey = store.buildCacheKey(text, voice, sentRate);

  // Join an identical request that is already running
  while (inflight.has(cacheKey)) {
    try {
      const shared = await inflight.get(cacheKey);
      if (signal?.aborted) throw new DOMException('درخواست لغو شد', 'AbortError');
      return { ...shared, fromCache: true, cacheInvalidated: false };
    } catch (err) {
      if (signal?.aborted) throw new DOMException('درخواست لغو شد', 'AbortError');
      // The owner request failed or was aborted → try again (we may become the owner)
    }
  }

  const job = runSynthesis({ text, voice, sentRate, cacheKey }, signal)
    .finally(() => inflight.delete(cacheKey)); // cleanup runs before any waiter continues
  inflight.set(cacheKey, job);
  return job;
}

async function runSynthesis({ text, voice, sentRate, cacheKey }, signal) {
  let cacheInvalidated = false;
  const cached = store.getCachedAudio(cacheKey);

  if (cached) {
    if (CONFIG.MOCK) {
      // MOCK: trust the cache; recreate the in-memory blob if the page was reloaded
      if (!objectUrlCache.has(cached.audioId)) {
        const blob = createMockWavBlob(cached.durationSec, 350 + Math.random() * 150);
        objectUrlCache.set(cached.audioId, URL.createObjectURL(blob));
      }
      return { audioId: cached.audioId, url: cached.url, durationSec: cached.durationSec, fromCache: true, cacheInvalidated: false };
    }

    // Verify the cached file is still alive; only a 404 invalidates the entry
    let stale = false;
    try {
      const headRes = await fetch(`${CONFIG.BASE_URL}/api/audio/${encodeURIComponent(cached.audioId)}`, {
        method: 'HEAD', signal
      });
      stale = headRes.status === 404;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Network error while checking → use the cache optimistically
    }

    if (!stale) {
      return { audioId: cached.audioId, url: cached.url, durationSec: cached.durationSec, fromCache: true, cacheInvalidated: false };
    }
    store.invalidateCacheEntry(cacheKey);
    cacheInvalidated = true;
  }

  // --- Fresh synthesis ---
  if (CONFIG.MOCK) {
    // Simulate speech generation time based on text length (min 600ms, max 1800ms)
    await waitWithSignal(Math.min(1800, Math.max(600, text.length * 15)), signal);

    const audioId = `mock_audio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const durationSec = Math.max(1.8, Math.round((text.length / 14) * 10) / 10);

    const mockBlob = createMockWavBlob(durationSec, 350 + Math.random() * 150);
    objectUrlCache.set(audioId, URL.createObjectURL(mockBlob));

    const result = { audioId, url: `/api/audio/${audioId}`, durationSec };
    store.setCachedAudio(cacheKey, result);
    return { ...result, fromCache: false, cacheInvalidated };
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/tts/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate: sentRate }), // exactly what the cache key was built from
    signal
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `خطا در تبدیل پاراگراف (کد ${response.status})`);
  }

  const result = await response.json();
  store.setCachedAudio(cacheKey, result);
  return { ...result, fromCache: false, cacheInvalidated };
}

/**
 * Merge multiple audio clips into a single final audio file.
 * POST /api/tts/merge
 * Sends `gapAfterMs` array aligned with `audioIds` (last element pause is 0).
 */
export async function mergeClips({ audioIds, gapAfterMs = [] }, signal = null) {
  if (!audioIds || audioIds.length < 2) {
    throw new Error('برای ساخت ویس کامل حداقل ۲ کلیپ انتخاب‌شده لازم است.');
  }

  // Ensure last gap is 0
  const normalizedGaps = audioIds.map((_, idx) =>
    idx === audioIds.length - 1 ? 0 : (gapAfterMs[idx] ?? CONFIG.DEFAULT_PAUSE_AFTER_MS)
  );

  if (CONFIG.MOCK) {
    const pausesSumMs = normalizedGaps.reduce((a, b) => a + (b || 0), 0);
    const knownClips = store.getState().clips;
    const clipsSumSec = audioIds.reduce((sum, id) => {
      const clip = knownClips.find(c => c.audioId === id);
      return sum + (clip && clip.durationSec > 0 ? clip.durationSec : 3.5);
    }, 0);
    const totalDuration = Math.round((clipsSumSec + pausesSumMs / 1000) * 100) / 100;
    await waitWithSignal(800 + audioIds.length * 150, signal);

    const mergeId = `mock_final_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const mockBlob = createMockWavBlob(totalDuration, 420);
    const objectUrl = URL.createObjectURL(mockBlob);
    objectUrlCache.set(mergeId, objectUrl);

    return {
      id: mergeId,
      url: `/api/audio/${mergeId}`,
      durationSec: totalDuration
    };
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/tts/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioIds, gapAfterMs: normalizedGaps }),
    signal
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `خطا در ادغام کلیپ‌ها (کد ${response.status})`);
  }

  return await response.json();
}

/**
 * Fetch an audio blob for playback or download.
 * Converts to temporary object URL and caches it in memory.
 * On 404, signals the caller so the cache can be invalidated.
 */
export async function getAudioObjectUrl(audioId, signal = null) {
  if (!audioId) throw new Error('شناسه صوت نامعتبر است.');

  if (objectUrlCache.has(audioId)) {
    return objectUrlCache.get(audioId);
  }

  if (CONFIG.MOCK) {
    // If mock was reloaded or not found, recreate fallback blob
    const fallbackBlob = createMockWavBlob(3.0, 440);
    const objUrl = URL.createObjectURL(fallbackBlob);
    objectUrlCache.set(audioId, objUrl);
    return objUrl;
  }

  const response = await fetch(`${CONFIG.BASE_URL}/api/audio/${encodeURIComponent(audioId)}`, { signal });
  if (!response.ok) {
    if (response.status === 404) {
      // Attach the audioId so callers can invalidate the matching cache entry
      const invalidated = store.invalidateCacheByAudioId(audioId);
      const err = new Error(
        `فایل صوتی با شناسه «${audioId}» روی سرور یافت نشد (خطای 404).` +
        (invalidated > 0 ? ' ورودی کش مربوطه نامعتبر شد؛ کلیپ‌ها حذف نشدند و با «ساخت دوباره» می‌توان آن را بازسازی کرد.' : '')
      );
      err.audioId = audioId;
      err.isNotFound = true;
      err.cacheInvalidated = invalidated > 0;
      throw err;
    }
    throw new Error(`خطا در دریافت فایل صوتی (کد ${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  objectUrlCache.set(audioId, objectUrl);
  return objectUrl;
}

/**
 * Clean up object URLs when needed to prevent memory leaks.
 */
export function revokeAudioObjectUrl(audioId) {
  if (objectUrlCache.has(audioId)) {
    URL.revokeObjectURL(objectUrlCache.get(audioId));
    objectUrlCache.delete(audioId);
  }
}

