/**
 * Application Configuration
 * All global limits, endpoints, and mock toggles are defined here.
 */

export const CONFIG = {
  // Schema version for project Export/Import
  SCHEMA_VERSION: "3.0",

  // Toggle for full offline flow without backend
  MOCK: true,

  // Base API URL for backend integration
  BASE_URL: "http://localhost:8000",

  // Audio synthesis settings
  MAX_CHAR_COUNT: 5000,
  BATCH_CONCURRENCY: 2,
  DEFAULT_GAP_MS: 300,
  DEFAULT_PAUSE_AFTER_MS: 300,
  DEFAULT_RATE: 1.0,

  // Audio cache: max number of reference entries kept in localStorage (oldest are dropped first)
  CACHE_MAX_ENTRIES: 300,

  // Local storage persistence key
  STORAGE_KEY: "persian_tts_state_v3",

  // Initial pronunciation dictionary
  INITIAL_DICTIONARY: [
    { id: "dict-1", phrase: "TTS", replacement: "تی‌تی‌اس" },
    { id: "dict-2", phrase: "ص.", replacement: "صفحهٔ" }
  ],

  // Default initial mock voices
  INITIAL_VOICES: [
    {
      id: "voice-1",
      name: "سهراب (کتاب صوتی)",
      engineVoice: "fa-male-narrator-1",
      tags: ["راوی", "ادبی", "مرد"],
      enabled: true
    },
    {
      id: "voice-2",
      name: "دلارا (پادکست و مستند)",
      engineVoice: "fa-female-calm-1",
      tags: ["پادکست", "آرام", "زن"],
      enabled: true
    },
    {
      id: "voice-3",
      name: "آرش (گزارش و خبر)",
      engineVoice: "fa-male-news-1",
      tags: ["خبری", "رسمی"],
      enabled: true
    }
  ]
};

