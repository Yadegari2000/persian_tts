import type { DictionaryEntry, EngineVoiceOption, SpeakerColor, Voice } from '../types/tts';

export const SPEAKER_PALETTE: Record<
  SpeakerColor,
  {
    dot: string;
    badgeBg: string;
    badgeText: string;
    border: string;
    barActive: string;
    barInactive: string;
    playBtn: string;
  }
> = {
  sky: {
    dot: 'bg-sky-400',
    badgeBg: 'bg-sky-500/15 border-sky-400/30',
    badgeText: 'text-sky-300',
    border: 'border-sky-500/40',
    barActive: 'bg-sky-400',
    barInactive: 'bg-sky-950/80',
    playBtn: 'bg-sky-500 hover:bg-sky-400 text-slate-950',
  },
  purple: {
    dot: 'bg-fuchsia-400',
    badgeBg: 'bg-fuchsia-500/15 border-fuchsia-400/30',
    badgeText: 'text-fuchsia-300',
    border: 'border-fuchsia-500/40',
    barActive: 'bg-gradient-to-t from-pink-500 to-fuchsia-400',
    barInactive: 'bg-[#3b2d54]',
    playBtn: 'bg-gradient-to-br from-pink-500 to-fuchsia-500 hover:brightness-110 text-white',
  },
  emerald: {
    dot: 'bg-emerald-400',
    badgeBg: 'bg-emerald-500/15 border-emerald-400/30',
    badgeText: 'text-emerald-300',
    border: 'border-emerald-500/40',
    barActive: 'bg-emerald-400',
    barInactive: 'bg-emerald-950/70',
    playBtn: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950',
  },
  amber: {
    dot: 'bg-amber-400',
    badgeBg: 'bg-amber-500/15 border-amber-400/30',
    badgeText: 'text-amber-300',
    border: 'border-amber-500/40',
    barActive: 'bg-amber-400',
    barInactive: 'bg-amber-950/70',
    playBtn: 'bg-amber-500 hover:bg-amber-400 text-slate-950',
  },
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

export const CONFIG = {
  SCHEMA_VERSION: '4.0',
  MOCK: true,
  BASE_URL: 'http://localhost:8000',
  MAX_CHAR_COUNT: 5000,
  BATCH_CONCURRENCY: 2,
  DEFAULT_GAP_MS: 300,
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
