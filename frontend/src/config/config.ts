import type { DictionaryEntry, EngineVoiceOption, SpeakerColor, Voice } from '../types/tts';

export interface VoiceVisualTheme {
  cssVar: string;
  chipBg: string;
  chipBorder: string;
  index: number;
  varName: VoiceCssVar;
}

/**
 * 7 Equal-Luminance, Colorblind-Safe Gestalt Speaker Identity CSS variables.
 * voice 1: #F0A830 (Amber)
 * voice 2: #5CB8F0 (Sky Blue)
 * voice 3: #3FC79A (Mint-Emerald)
 * voice 4: #EDE05A (Warm Lemon)
 * voice 5: #6C8CFF (Indigo)
 * voice 6: #F0714A (Coral)
 * voice 7: #D98BBF (Orchid)
 */
export const VOICE_CSS_VARS = [
  '--voice-1',
  '--voice-2',
  '--voice-3',
  '--voice-4',
  '--voice-5',
  '--voice-6',
  '--voice-7',
] as const;

export type VoiceCssVar = (typeof VOICE_CSS_VARS)[number];

const LEGACY_COLOR_VAR: Record<SpeakerColor, VoiceCssVar> = {
  amber: '--voice-1',
  sky: '--voice-2',
  emerald: '--voice-3',
  purple: '--voice-7',
};

function makeVoiceVisualTheme(varName: VoiceCssVar, index: number): VoiceVisualTheme {
  return {
    cssVar: `var(${varName})`,
    chipBg: `color-mix(in srgb, var(${varName}) 16%, transparent)`,
    chipBorder: `color-mix(in srgb, var(${varName}) 40%, transparent)`,
    index,
    varName,
  };
}

/**
 * Pure helper mapping speaker index or identifier stably onto one of the 7 Gestalt speaker colors (--voice-1..--voice-7).
 * Speaker 1 (index 0) gets --voice-1, Speaker 2 gets --voice-2, etc., wrapping via index mod 7.
 * Pure and non-mutating.
 */
export function resolveSpeakerColor(voiceIndexOrId: number | string, voices?: Voice[]): VoiceCssVar {
  if (typeof voiceIndexOrId === 'number' && voiceIndexOrId >= 0) {
    return VOICE_CSS_VARS[voiceIndexOrId % VOICE_CSS_VARS.length];
  }
  if (typeof voiceIndexOrId === 'string') {
    if (voices && voices.length > 0) {
      const idx = voices.findIndex((v) => v.id === voiceIndexOrId || v.name === voiceIndexOrId);
      if (idx >= 0) {
        return VOICE_CSS_VARS[idx % VOICE_CSS_VARS.length];
      }
    }
    // Stable hash fallback for unknown voice IDs
    let hash = 0;
    for (let i = 0; i < voiceIndexOrId.length; i++) {
      hash = (hash * 31 + voiceIndexOrId.charCodeAt(i)) >>> 0;
    }
    return VOICE_CSS_VARS[hash % VOICE_CSS_VARS.length];
  }
  return '--voice-1';
}

/**
 * Pure helper mapping a voice index, identifier, or legacy color stably onto one of the 7
 * speaker colors (--voice-1..--voice-7), wrapping 8th+ voices via index mod 7.
 * Never mutates persisted state.
 */
export function resolveVoiceVisualTheme(
  voices: Voice[],
  opts: {
    voiceId?: string;
    voiceName?: string;
    engineVoice?: string;
    fallbackColor?: SpeakerColor;
    fallbackIndex?: number;
  }
): VoiceVisualTheme {
  let idx = -1;
  if (opts.voiceId) {
    idx = voices.findIndex((v) => v.id === opts.voiceId);
  }
  if (idx === -1 && opts.voiceName) {
    if (opts.engineVoice) {
      idx = voices.findIndex(
        (v) => v.name === opts.voiceName && v.engineVoice === opts.engineVoice
      );
    }
    if (idx === -1) {
      idx = voices.findIndex((v) => v.name === opts.voiceName);
    }
  }

  if (idx >= 0) {
    const wrappedIdx = idx % VOICE_CSS_VARS.length;
    const varName = VOICE_CSS_VARS[wrappedIdx];
    return makeVoiceVisualTheme(varName, wrappedIdx);
  }

  if (typeof opts.fallbackIndex === 'number' && opts.fallbackIndex >= 0) {
    const wrappedIdx = opts.fallbackIndex % VOICE_CSS_VARS.length;
    const varName = VOICE_CSS_VARS[wrappedIdx];
    return makeVoiceVisualTheme(varName, wrappedIdx);
  }

  if (opts.fallbackColor && LEGACY_COLOR_VAR[opts.fallbackColor]) {
    const varName = LEGACY_COLOR_VAR[opts.fallbackColor];
    const wrappedIdx = VOICE_CSS_VARS.indexOf(varName);
    return makeVoiceVisualTheme(varName, wrappedIdx >= 0 ? wrappedIdx : 0);
  }

  return makeVoiceVisualTheme('--voice-1', 0);
}

export const SPEAKER_PALETTE: Record<SpeakerColor, { cssVar: string }> = {
  amber: { cssVar: 'var(--voice-1)' },
  sky: { cssVar: 'var(--voice-2)' },
  emerald: { cssVar: 'var(--voice-3)' },
  purple: { cssVar: 'var(--voice-7)' },
};

export function getSpeakerColorForVoice(voiceIdOrIndex: string | number): SpeakerColor {
  const palette: SpeakerColor[] = ['sky', 'purple', 'emerald', 'amber'];
  if (typeof voiceIdOrIndex === 'number') {
    return palette[voiceIdOrIndex % palette.length];
  }
  let hash = 0;
  for (let i = 0; i < voiceIdOrIndex.length; i++) {
    hash = (hash * 31 + voiceIdOrIndex.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

const viteEnv =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, unknown> }).env) || {};
const rawUseMock = viteEnv.VITE_USE_MOCK;
const isMockEnabled =
  rawUseMock !== undefined ? String(rawUseMock).trim().toLowerCase() !== 'false' : true;
const apiBaseUrl =
  typeof viteEnv.VITE_API_BASE_URL === 'string' && viteEnv.VITE_API_BASE_URL.trim()
    ? viteEnv.VITE_API_BASE_URL.trim().replace(/\/+$/, '')
    : 'http://localhost:8000';

export const CONFIG = {
  SCHEMA_VERSION: '4.0',
  MOCK: isMockEnabled,
  BASE_URL: apiBaseUrl,
  MAX_CHAR_COUNT: 5000,
  BATCH_CONCURRENCY: 2,
  DEFAULT_PAUSE_AFTER_MS: 300,
  DEFAULT_RATE: 1.0,
  CACHE_MAX_ENTRIES: 300,
  STORAGE_KEY: 'persian_tts_state_v4',

  ENGINE_VOICES: [
    { id: 'fa-male-narrator-1', engineVoice: 'fa-male-narrator-1', name: 'صدای مرد (راوی کتاب)', baseFrequency: 210 },
    { id: 'fa-female-calm-1', engineVoice: 'fa-female-calm-1', name: 'صدای زن (پادکست و گفتگو)', baseFrequency: 310 },
    { id: 'fa-male-news-1', engineVoice: 'fa-male-news-1', name: 'صدای مرد (خبری و رسا)', baseFrequency: 185 },
    { id: 'fa-female-story-1', engineVoice: 'fa-female-story-1', name: 'صدای زن (قصه و کودک)', baseFrequency: 345 },
  ] as EngineVoiceOption[],

  INITIAL_DICTIONARY: [
    { id: 'dict-1', phrase: 'TTS', replacement: 'تی‌تی‌اس' },
    { id: 'dict-2', phrase: 'ص.', replacement: 'صفحهٔ' },
  ] as DictionaryEntry[],

  INITIAL_VOICES: [
    {
      id: 'voice-1',
      name: 'سهراب (کتاب صوتی)',
      engineVoice: 'fa-male-narrator-1',
      tags: ['راوی', 'مرد'],
      enabled: true,
      color: 'sky',
    },
    {
      id: 'voice-2',
      name: 'دلارا (پادکست و مستند)',
      engineVoice: 'fa-female-calm-1',
      tags: ['پادکست', 'زن'],
      enabled: true,
      color: 'purple',
    },
    {
      id: 'voice-3',
      name: 'آرش (گزارش و خبر)',
      engineVoice: 'fa-male-news-1',
      tags: ['خبری', 'مرد'],
      enabled: true,
      color: 'emerald',
    },
  ] as Voice[],
};
