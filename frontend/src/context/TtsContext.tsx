import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, getSpeakerColorForVoice } from '../config/config';
import type {
  AudioCacheEntry,
  BatchState,
  CharacterSummary,
  Clip,
  ConfirmOptions,
  DictionaryEntry,
  FinalAudio,
  Segment,
  SegmentStatus,
  SpeakerColor,
  TagFilter,
  ToastItem,
  ToastType,
  Voice,
} from '../types/tts';
import * as audioEngine from '../utils/audioEngine';
import { prepareText } from '../utils/text';

interface PersistedState {
  schemaVersion?: string;
  voices: Voice[];
  allTags: string[];
  dictionary: DictionaryEntry[];
  segments: Segment[];
  clips: Clip[];
  finalAudio: FinalAudio | null;
  tagFilter: TagFilter;
  characterVoices: Record<string, string>;
  audioCache: Record<string, AudioCacheEntry>;
}

const MAX_HISTORY = 30;

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractAllTags(voices: Voice[]): string[] {
  const set = new Set<string>();
  for (const v of voices) {
    if (Array.isArray(v.tags)) {
      v.tags.forEach((t) => t && set.add(t.trim()));
    }
  }
  return Array.from(set);
}

function cloneSegments(segments: Segment[]): Segment[] {
  return segments.map((s) => ({
    id: s.id,
    text: s.text,
    voiceId: s.voiceId,
    characterName: s.characterName ?? null,
    rate: s.rate,
    pauseAfterMs: s.pauseAfterMs,
    status: s.status === 'loading' ? 'idle' : s.status,
    error: s.status === 'loading' ? null : s.error,
  }));
}

function normalizeSegment(s: Partial<Segment>, voices: Voice[]): Segment {
  const characterName =
    typeof s.characterName === 'string' && s.characterName.trim() ? s.characterName.trim() : null;
  const voiceExists = !!s.voiceId && voices.some((v) => v.id === s.voiceId);
  const voiceId = voiceExists ? s.voiceId! : characterName ? '' : (voices[0]?.id ?? 'default');

  return {
    id: s.id || generateId('seg'),
    text: typeof s.text === 'string' ? s.text : '',
    voiceId,
    characterName,
    rate: typeof s.rate === 'number' ? s.rate : CONFIG.DEFAULT_RATE,
    pauseAfterMs: typeof s.pauseAfterMs === 'number' ? s.pauseAfterMs : CONFIG.DEFAULT_PAUSE_AFTER_MS,
    status: s.status === 'loading' ? 'idle' : s.status || 'idle',
    error: s.status === 'loading' ? null : s.error || null,
  };
}

function reconcileSegmentsAndCharacters(
  segments: Segment[],
  characterVoices: Record<string, string>,
  voices: Voice[]
): { segments: Segment[]; characterVoices: Record<string, string> } {
  const validIds = new Set(voices.map((v) => v.id));
  const nextCharVoices: Record<string, string> = {};
  for (const [name, vid] of Object.entries(characterVoices)) {
    if (validIds.has(vid)) nextCharVoices[name] = vid;
  }

  const nextSegments = segments.map((seg) => {
    if (seg.voiceId && validIds.has(seg.voiceId)) return seg;
    if (seg.characterName) {
      const mapped = nextCharVoices[seg.characterName];
      return { ...seg, voiceId: mapped && validIds.has(mapped) ? mapped : '' };
    }
    return { ...seg, voiceId: voices[0]?.id ?? 'default' };
  });

  return { segments: nextSegments, characterVoices: nextCharVoices };
}

export function buildVoiceBankStoragePayload(
  voices: Voice[],
  allTags: string[],
  tagFilter: TagFilter
) {
  return {
    schemaVersion: CONFIG.SCHEMA_VERSION,
    voices,
    allTags,
    tagFilter,
  };
}

export function createFreshSessionState(
  voices: Voice[],
  allTags: string[],
  tagFilter: TagFilter
): PersistedState {
  return {
    voices,
    allTags,
    dictionary: [...CONFIG.INITIAL_DICTIONARY],
    segments: [
      {
        id: generateId('seg'),
        text: '',
        voiceId: voices[0]?.id || 'voice-1',
        characterName: null,
        rate: CONFIG.DEFAULT_RATE,
        pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
        status: 'idle',
        error: null,
      },
    ],
    clips: [],
    finalAudio: null,
    tagFilter,
    characterVoices: {},
    audioCache: {},
  };
}

export function loadInitialState(): PersistedState {
  let voices: Voice[] = CONFIG.INITIAL_VOICES.map((v, idx) => ({
    ...v,
    color: v.color || getSpeakerColorForVoice(idx),
  }));
  let allTags: string[] = extractAllTags(voices);
  let tagFilter: TagFilter = { selectedTags: [], mode: 'OR', untagged: false };

  try {
    const raw =
      localStorage.getItem(CONFIG.STORAGE_KEY) ||
      localStorage.getItem('persian_tts_state_v3') ||
      localStorage.getItem('persian_tts_state_v2');

    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.voices) && parsed.voices.length > 0) {
        voices = parsed.voices.map((v: Voice, idx: number) => ({
          ...v,
          color: v.color || getSpeakerColorForVoice(v.id || idx),
        }));
        allTags = Array.isArray(parsed.allTags)
          ? Array.from(new Set(parsed.allTags))
          : extractAllTags(voices);
      }

      if (parsed.tagFilter && typeof parsed.tagFilter === 'object') {
        tagFilter = {
          selectedTags: Array.isArray(parsed.tagFilter.selectedTags) ? parsed.tagFilter.selectedTags : [],
          mode: parsed.tagFilter.mode === 'AND' ? 'AND' : 'OR',
          untagged: Boolean(parsed.tagFilter.untagged),
        };
      }
    }
  } catch (err) {
    console.warn('Failed to load saved voice bank:', err);
  }

  return createFreshSessionState(voices, allTags, tagFilter);
}

interface TtsContextValue {
  voices: Voice[];
  allTags: string[];
  dictionary: DictionaryEntry[];
  segments: Segment[];
  clips: Clip[];
  finalAudio: FinalAudio | null;
  tagFilter: TagFilter;
  characterVoices: Record<string, string>;
  batch: BatchState;
  toasts: ToastItem[];
  canUndo: boolean;
  canRedo: boolean;
  canUndoFinalEdit: boolean;
  characterSummary: CharacterSummary[];
  confirmState: (ConfirmOptions & { resolve: (val: boolean) => void }) | null;
  isVoiceValid: (voiceId: string) => boolean;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  registerPlayingAudio: (el: HTMLAudioElement) => void;
  pushHistory: () => void;
  undo: () => boolean;
  redo: () => boolean;
  addVoice: (data: { name: string; engineVoice: string; tags: string[]; color?: SpeakerColor }) => Voice;
  updateVoice: (id: string, data: { name: string; engineVoice?: string; tags: string[] }) => void;
  deleteVoice: (id: string) => { remappedCount: number; unassignedCount: number };
  setTagFilter: (updates: Partial<TagFilter>) => void;
  addDictionaryEntry: (phrase: string, replacement: string) => void;
  deleteDictionaryEntry: (id: string) => void;
  addSegment: (afterId?: string | null) => Segment;
  duplicateSegment: (id: string) => void;
  removeSegment: (id: string) => void;
  moveSegment: (id: string, direction: 'up' | 'down') => void;
  updateSegment: (id: string, updates: Partial<Segment>, recordHistory?: boolean) => void;
  autoSplitText: (rawText: string) => void;
  convertSegmentById: (id: string, opts?: { signal?: AbortSignal | null; quiet?: boolean }) => Promise<boolean>;
  handleConvertAll: () => Promise<void>;
  handleCancelBatch: () => void;
  setCharacterVoice: (characterName: string, voiceId: string) => boolean;
  removeCharacterVoice: (characterName: string) => void;
  applyDialogueLines: (lines: Array<{ character: string; text: string }>) => void;
  toggleClipSelect: (id: string) => void;
  selectAllClips: (val: boolean) => void;
  invertClipSelection: () => void;
  updateClipPause: (id: string, pauseAfterMs: number) => void;
  updateClipTrim: (id: string, trimStartSec: number, trimEndSec: number) => void;
  changeClipVoice: (clipId: string, voiceId: string) => Promise<void>;
  moveClip: (id: string, direction: 'up' | 'down') => void;
  moveClipToIndex: (id: string, targetIndex: number) => void;
  removeClip: (id: string) => void;
  clearAllClips: () => void;
  resynthesizeClip: (clip: Clip) => Promise<void>;
  mergeSelectedClips: () => Promise<void>;
  editFinalAudio: (mode: 'cut-middle' | 'keep-range', startSec: number, endSec: number) => boolean;
  applyFinalAudioEffect: (effect: 'normalize' | 'fade') => boolean;
  undoFinalAudioEdit: () => boolean;
  clearFinalAudio: () => void;
  exportProjectJSON: () => string;
  importProjectJSON: (jsonString: string) => { version: string; segmentCount: number; clipCount: number };
}

const TtsContext = createContext<TtsContextValue | null>(null);

export function TtsProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<PersistedState>(() => loadInitialState());
  const dataRef = useRef<PersistedState>(data);
  dataRef.current = data;

  const [batch, setBatch] = useState<BatchState>({ active: false, total: 0, completed: 0, errors: 0 });
  const batchControllerRef = useRef<AbortController | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (val: boolean) => void }) | null>(null);

  const undoStackRef = useRef<Segment[][]>([]);
  const redoStackRef = useRef<Segment[][]>([]);
  const finalEditStackRef = useRef<FinalAudio[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const currentPlayingAudioRef = useRef<HTMLAudioElement | null>(null);

  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
      batchControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    try {
      const payload = buildVoiceBankStoragePayload(data.voices, data.allTags, data.tagFilter);
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to persist voice bank:', err);
    }
  }, [data.voices, data.allTags, data.tagFilter]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = generateId('toast');
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
    toastTimersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showConfirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        ...opts,
        resolve: (val: boolean) => {
          setConfirmState(null);
          resolve(val);
        },
      });
    });
  }, []);

  const registerPlayingAudio = useCallback((el: HTMLAudioElement) => {
    if (currentPlayingAudioRef.current && currentPlayingAudioRef.current !== el) {
      currentPlayingAudioRef.current.pause();
    }
    currentPlayingAudioRef.current = el;
  }, []);

  const isVoiceValid = useCallback((voiceId: string) => {
    return !!voiceId && dataRef.current.voices.some((v) => v.id === voiceId);
  }, []);

  const pushHistory = useCallback(() => {
    if (undoStackRef.current.length >= MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    undoStackRef.current.push(cloneSegments(dataRef.current.segments));
    redoStackRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return false;
    redoStackRef.current.push(cloneSegments(dataRef.current.segments));
    const prevSegs = undoStackRef.current.pop()!;
    setData((prev) => {
      const rec = reconcileSegmentsAndCharacters(cloneSegments(prevSegs), prev.characterVoices, prev.voices);
      return { ...prev, segments: rec.segments, characterVoices: rec.characterVoices };
    });
    setHistoryTick((t) => t + 1);
    return true;
  }, []);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return false;
    undoStackRef.current.push(cloneSegments(dataRef.current.segments));
    const nextSegs = redoStackRef.current.pop()!;
    setData((prev) => {
      const rec = reconcileSegmentsAndCharacters(cloneSegments(nextSegs), prev.characterVoices, prev.voices);
      return { ...prev, segments: rec.segments, characterVoices: rec.characterVoices };
    });
    setHistoryTick((t) => t + 1);
    return true;
  }, []);

  const addVoice = useCallback(
    (input: { name: string; engineVoice: string; tags: string[]; color?: SpeakerColor }): Voice => {
      const cleanTags = input.tags.map((t) => t.trim()).filter(Boolean);
      const newVoice: Voice = {
        id: generateId('voice'),
        name: input.name.trim() || 'صدای جدید',
        engineVoice: input.engineVoice || CONFIG.ENGINE_VOICES[0].engineVoice,
        tags: cleanTags,
        enabled: true,
        color: input.color || getSpeakerColorForVoice(dataRef.current.voices.length),
      };
      setData((prev) => ({
        ...prev,
        voices: [...prev.voices, newVoice],
        allTags: Array.from(new Set([...prev.allTags, ...cleanTags])),
      }));
      return newVoice;
    },
    []
  );

  const updateVoice = useCallback((id: string, updates: { name: string; engineVoice?: string; tags: string[] }) => {
    const cleanTags = updates.tags.map((t) => t.trim()).filter(Boolean);
    setData((prev) => {
      const voices = prev.voices.map((v) =>
        v.id === id
          ? {
              ...v,
              name: updates.name.trim() || v.name,
              engineVoice: updates.engineVoice || v.engineVoice,
              tags: cleanTags,
            }
          : v
      );
      return {
        ...prev,
        voices,
        allTags: extractAllTags(voices),
      };
    });
  }, []);

  const deleteVoice = useCallback((id: string) => {
    const prev = dataRef.current;
    const remainingVoices = prev.voices.filter((v) => v.id !== id);
    const fallbackVoiceId = remainingVoices[0]?.id || 'default';

    let remappedCount = 0;
    let unassignedCount = 0;

    const nextSegments = prev.segments.map((seg) => {
      if (seg.voiceId !== id) return seg;
      if (seg.characterName) {
        unassignedCount++;
        return { ...seg, voiceId: '' };
      }
      remappedCount++;
      return { ...seg, voiceId: fallbackVoiceId };
    });

    const nextCharVoices: Record<string, string> = {};
    for (const [name, vid] of Object.entries(prev.characterVoices)) {
      if (vid !== id) nextCharVoices[name] = vid;
    }

    setData((curr) => ({
      ...curr,
      voices: curr.voices.filter((v) => v.id !== id),
      allTags: extractAllTags(curr.voices.filter((v) => v.id !== id)),
      segments: nextSegments,
      characterVoices: nextCharVoices,
    }));

    return { remappedCount, unassignedCount };
  }, []);

  const setTagFilter = useCallback((updates: Partial<TagFilter>) => {
    setData((prev) => ({
      ...prev,
      tagFilter: { ...prev.tagFilter, ...updates },
    }));
  }, []);

  const addDictionaryEntry = useCallback((phrase: string, replacement: string) => {
    const cleanPhrase = phrase.trim();
    const cleanReplacement = replacement.trim();
    if (!cleanPhrase) return;
    setData((prev) => {
      const existingIdx = prev.dictionary.findIndex(
        (d) => d.phrase.trim().toLowerCase() === cleanPhrase.toLowerCase()
      );
      if (existingIdx !== -1) {
        const next = [...prev.dictionary];
        next[existingIdx] = { ...next[existingIdx], phrase: cleanPhrase, replacement: cleanReplacement };
        return { ...prev, dictionary: next };
      }
      return {
        ...prev,
        dictionary: [...prev.dictionary, { id: generateId('dict'), phrase: cleanPhrase, replacement: cleanReplacement }],
      };
    });
  }, []);

  const deleteDictionaryEntry = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      dictionary: prev.dictionary.filter((d) => d.id !== id),
    }));
  }, []);

  const addSegment = useCallback(
    (afterId: string | null = null): Segment => {
      pushHistory();
      const curr = dataRef.current;
      let insertIndex = curr.segments.length;
      let inheritedVoiceId = curr.voices[0]?.id || 'voice-1';
      let inheritedPause = CONFIG.DEFAULT_PAUSE_AFTER_MS;

      if (afterId) {
        const idx = curr.segments.findIndex((s) => s.id === afterId);
        if (idx !== -1) {
          insertIndex = idx + 1;
          inheritedVoiceId = curr.segments[idx].voiceId;
          inheritedPause = curr.segments[idx].pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS;
        }
      } else if (curr.segments.length > 0) {
        inheritedVoiceId = curr.segments[curr.segments.length - 1].voiceId;
        inheritedPause = curr.segments[curr.segments.length - 1].pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS;
      }

      if (!curr.voices.some((v) => v.id === inheritedVoiceId)) {
        inheritedVoiceId = curr.voices[0]?.id || 'voice-1';
      }

      const newSeg: Segment = {
        id: generateId('seg'),
        text: '',
        voiceId: inheritedVoiceId,
        characterName: null,
        rate: CONFIG.DEFAULT_RATE,
        pauseAfterMs: inheritedPause,
        status: 'idle',
        error: null,
      };

      setData((prev) => {
        const next = [...prev.segments];
        next.splice(insertIndex, 0, newSeg);
        return { ...prev, segments: next };
      });
      return newSeg;
    },
    [pushHistory]
  );

  const duplicateSegment = useCallback(
    (id: string) => {
      pushHistory();
      setData((prev) => {
        const idx = prev.segments.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const orig = prev.segments[idx];
        const copy: Segment = {
          ...orig,
          id: generateId('seg'),
          status: 'idle',
          error: null,
        };
        const next = [...prev.segments];
        next.splice(idx + 1, 0, copy);
        return { ...prev, segments: next };
      });
    },
    [pushHistory]
  );

  const removeSegment = useCallback(
    (id: string) => {
      pushHistory();
      setData((prev) => {
        if (prev.segments.length <= 1) {
          return {
            ...prev,
            segments: prev.segments.map((s) => ({ ...s, text: '', status: 'idle', error: null })),
          };
        }
        return {
          ...prev,
          segments: prev.segments.filter((s) => s.id !== id),
        };
      });
    },
    [pushHistory]
  );

  const moveSegment = useCallback(
    (id: string, direction: 'up' | 'down') => {
      pushHistory();
      setData((prev) => {
        const idx = prev.segments.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const target = direction === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= prev.segments.length) return prev;
        const next = [...prev.segments];
        const [moved] = next.splice(idx, 1);
        next.splice(target, 0, moved);
        return { ...prev, segments: next };
      });
    },
    [pushHistory]
  );

  const updateSegment = useCallback(
    (id: string, updates: Partial<Segment>, recordHistory = false) => {
      if (recordHistory) pushHistory();
      setData((prev) => ({
        ...prev,
        segments: prev.segments.map((s) => {
          if (s.id !== id) return s;
          const contentChanged =
            (updates.text !== undefined && updates.text !== s.text) ||
            (updates.voiceId !== undefined && updates.voiceId !== s.voiceId) ||
            (updates.rate !== undefined && updates.rate !== s.rate);
          return {
            ...s,
            ...updates,
            pauseAfterMs:
              typeof updates.pauseAfterMs === 'number'
                ? Math.max(0, Math.min(2000, updates.pauseAfterMs))
                : s.pauseAfterMs,
            status: updates.status ?? (contentChanged && (s.status === 'done' || s.status === 'error') ? 'idle' : s.status),
            error: updates.error !== undefined ? updates.error : contentChanged ? null : s.error,
          };
        }),
      }));
    },
    [pushHistory]
  );

  const autoSplitText = useCallback(
    (rawText: string) => {
      if (!rawText || !rawText.trim()) return;
      const paragraphs = rawText
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (paragraphs.length === 0) return;

      pushHistory();
      const defaultVoiceId = dataRef.current.voices[0]?.id || 'voice-1';
      setData((prev) => ({
        ...prev,
        segments: paragraphs.map((text) => ({
          id: generateId('seg'),
          text: text.slice(0, CONFIG.MAX_CHAR_COUNT),
          voiceId: defaultVoiceId,
          characterName: null,
          rate: CONFIG.DEFAULT_RATE,
          pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
          status: 'idle',
          error: null,
        })),
      }));
    },
    [pushHistory]
  );

  const cacheHooks = useMemo(
    () => ({
      getCachedAudio: (key: string) => dataRef.current.audioCache[key] || null,
      setCachedAudio: (key: string, entry: AudioCacheEntry) => {
        const curr = dataRef.current;
        const nextCache = { ...curr.audioCache };
        delete nextCache[key];
        nextCache[key] = entry;
        const keys = Object.keys(nextCache);
        const max = CONFIG.CACHE_MAX_ENTRIES || 300;
        const evictedAudioIds: string[] = [];
        for (let i = 0; i < keys.length - max; i++) {
          const evicted = nextCache[keys[i]];
          if (evicted?.audioId) evictedAudioIds.push(evicted.audioId);
          delete nextCache[keys[i]];
        }
        setData((prev) => {
          const updated = { ...prev.audioCache };
          delete updated[key];
          updated[key] = entry;
          const uKeys = Object.keys(updated);
          for (let i = 0; i < uKeys.length - max; i++) {
            delete updated[uKeys[i]];
          }
          return { ...prev, audioCache: updated };
        });
        if (evictedAudioIds.length > 0) {
          const activeClipIds = new Set(curr.clips.map((c) => c.audioId));
          const finalId = curr.finalAudio?.id;
          evictedAudioIds.forEach((aid) => {
            if (!activeClipIds.has(aid) && aid !== finalId) {
              audioEngine.revokeAudioObjectUrl(aid);
            }
          });
        }
      },
      invalidateCacheEntry: (key: string) => {
        setData((prev) => {
          if (!(key in prev.audioCache)) return prev;
          const next = { ...prev.audioCache };
          delete next[key];
          return { ...prev, audioCache: next };
        });
      },
    }),
    []
  );

  const setSegmentStatus = useCallback((id: string, status: SegmentStatus, error: string | null = null) => {
    setData((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === id ? { ...s, status, error } : s)),
    }));
  }, []);

  const convertSegmentById = useCallback(
    async (id: string, { signal = null, quiet = false }: { signal?: AbortSignal | null; quiet?: boolean } = {}) => {
      const curr = dataRef.current;
      const seg = curr.segments.find((s) => s.id === id);
      if (!seg || seg.status === 'loading') return false;

      if (!seg.text.trim()) {
        if (!quiet) showToast('متن این پاراگراف خالی است.', 'warning');
        return false;
      }
      if (seg.text.length > CONFIG.MAX_CHAR_COUNT) {
        if (!quiet) showToast(`متن بیشتر از ${CONFIG.MAX_CHAR_COUNT} نویسه است.`, 'warning');
        return false;
      }
      const voice = curr.voices.find((v) => v.id === seg.voiceId);
      if (!voice) {
        const msg = seg.characterName
          ? `برای شخصیت «${seg.characterName}» هنوز صدای معتبری انتخاب نشده است. ابتدا یک صدا انتخاب کنید.`
          : 'صدای این پاراگراف معتبر نیست. یک صدا انتخاب کنید.';
        if (!quiet) showToast(msg, 'warning');
        return false;
      }

      setSegmentStatus(id, 'loading');
      try {
        const preparedText = prepareText(seg.text, curr.dictionary);
        const result = await audioEngine.synthesizeSegment(
          { text: preparedText, voice: voice.engineVoice, rate: seg.rate },
          cacheHooks,
          signal
        );

        const dur = result.durationSec || 0;
        const newClip: Clip = {
          id: generateId('clip'),
          segmentId: seg.id,
          text: seg.text,
          preparedText: preparedText || seg.text,
          voiceName: voice.name,
          engineVoice: voice.engineVoice,
          voiceTags: [...(voice.tags || [])],
          speakerColor: voice.color || getSpeakerColorForVoice(voice.id),
          rate: seg.rate,
          pauseAfterMs: seg.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS,
          audioId: result.audioId,
          audioUrl: result.url,
          durationSec: dur,
          trimStartSec: 0,
          trimEndSec: dur,
          waveformPeaks: result.waveformPeaks,
          createdAt: new Date().toISOString(),
          selected: true,
        };

        if (!quiet) pushHistory();

        setData((prev) => ({
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === id
              ? quiet
                ? { ...s, status: 'done', error: null }
                : { ...s, text: '', status: 'idle', error: null }
              : s
          ),
          clips: [...prev.clips, newClip],
        }));

        if (!quiet) {
          showToast(
            `پاراگراف تبدیل شد${result.fromCache ? ' (از کش)' : ''}. (مدت زمان: ${newClip.durationSec} ثانیه)`,
            'success'
          );
        }
        return true;
      } catch (err: unknown) {
        const e = err as Error;
        if (e.name === 'AbortError') {
          setSegmentStatus(id, 'idle');
          throw e;
        }
        setSegmentStatus(id, 'error', e.message);
        if (!quiet) showToast(`خطا در تبدیل پاراگراف: ${e.message}`, 'error');
        return false;
      }
    },
    [cacheHooks, pushHistory, setSegmentStatus, showToast]
  );

  const handleConvertAll = useCallback(async () => {
    if (batchControllerRef.current) return;
    const curr = dataRef.current;
    const candidates = curr.segments.filter(
      (s) => (s.status === 'idle' || s.status === 'error') && s.text.trim().length > 0 && s.text.length <= CONFIG.MAX_CHAR_COUNT
    );
    const targets = candidates.filter((s) => curr.voices.some((v) => v.id === s.voiceId));
    const skippedNoVoice = candidates.length - targets.length;

    if (targets.length === 0) {
      if (skippedNoVoice > 0) {
        showToast(`${skippedNoVoice} پاراگراف صدای معتبر ندارد و تبدیل نمی‌شود. ابتدا برای آن‌ها صدا انتخاب کنید.`, 'warning');
      } else {
        showToast('هیچ پاراگراف آماده‌ای برای تبدیل وجود ندارد.', 'info');
      }
      return;
    }

    const controller = new AbortController();
    batchControllerRef.current = controller;
    setBatch({ active: true, total: targets.length, completed: 0, errors: 0 });

    const queue = [...targets];
    let completed = 0;
    let errors = 0;

    async function worker() {
      while (queue.length > 0) {
        if (controller.signal.aborted) break;
        const seg = queue.shift();
        if (!seg) break;
        try {
          const ok = await convertSegmentById(seg.id, { signal: controller.signal, quiet: true });
          if (ok) completed++;
          else errors++;
        } catch (err: unknown) {
          if ((err as Error).name === 'AbortError') break;
          errors++;
        }
        setBatch({ active: true, total: targets.length, completed, errors });
      }
    }

    const workers = Array.from({ length: Math.min(CONFIG.BATCH_CONCURRENCY, targets.length) }, () => worker());
    await Promise.all(workers);

    const wasCancelled = controller.signal.aborted;
    batchControllerRef.current = null;
    setBatch({ active: false, total: 0, completed: 0, errors: 0 });

    if (wasCancelled) {
      showToast('تبدیل دسته‌ای لغو شد.', 'warning');
    } else if (errors > 0 || skippedNoVoice > 0) {
      showToast(
        `تبدیل دسته‌ای با ${completed} موفق و ${errors} خطا به پایان رسید${skippedNoVoice ? ` (${skippedNoVoice} پاراگراف بدون صدا رد شد)` : ''}.`,
        'warning'
      );
    } else {
      showToast(`تمام ${completed} پاراگراف با موفقیت به ویس تبدیل شدند.`, 'success');
    }
  }, [convertSegmentById, showToast]);

  const handleCancelBatch = useCallback(() => {
    batchControllerRef.current?.abort();
  }, []);

  const setCharacterVoice = useCallback((characterName: string, voiceId: string): boolean => {
    const name = characterName.trim();
    if (!name || !dataRef.current.voices.some((v) => v.id === voiceId)) return false;

    setData((prev) => ({
      ...prev,
      characterVoices: { ...prev.characterVoices, [name]: voiceId },
      segments: prev.segments.map((s) =>
        s.characterName === name && s.voiceId !== voiceId
          ? { ...s, voiceId, status: s.status === 'done' || s.status === 'error' ? 'idle' : s.status, error: null }
          : s
      ),
    }));
    return true;
  }, []);

  const removeCharacterVoice = useCallback((characterName: string) => {
    setData((prev) => {
      if (!(characterName in prev.characterVoices)) return prev;
      const oldVoice = prev.characterVoices[characterName];
      const nextMap = { ...prev.characterVoices };
      delete nextMap[characterName];
      return {
        ...prev,
        characterVoices: nextMap,
        segments: prev.segments.map((s) =>
          s.characterName === characterName && s.voiceId === oldVoice
            ? { ...s, voiceId: '', status: s.status === 'done' || s.status === 'error' ? 'idle' : s.status, error: null }
            : s
        ),
      };
    });
  }, []);

  const applyDialogueLines = useCallback(
    (lines: Array<{ character: string; text: string }>) => {
      pushHistory();
      setData((prev) => {
        const validIds = new Set(prev.voices.map((v) => v.id));
        const segments: Segment[] = lines.map((line) => {
          const mapped = prev.characterVoices[line.character];
          return {
            id: generateId('seg'),
            text: line.text,
            voiceId: mapped && validIds.has(mapped) ? mapped : '',
            characterName: line.character,
            rate: CONFIG.DEFAULT_RATE,
            pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
            status: 'idle',
            error: null,
          };
        });
        return { ...prev, segments };
      });
    },
    [pushHistory]
  );

  const toggleClipSelect = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)),
    }));
  }, []);

  const selectAllClips = useCallback((val: boolean) => {
    setData((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => ({ ...c, selected: val })),
    }));
  }, []);

  const invertClipSelection = useCallback(() => {
    setData((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => ({ ...c, selected: !c.selected })),
    }));
  }, []);

  const updateClipPause = useCallback((id: string, pauseAfterMs: number) => {
    const clamped = Math.max(0, Math.min(2000, pauseAfterMs));
    setData((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === id ? { ...c, pauseAfterMs: clamped } : c)),
    }));
  }, []);

  const updateClipTrim = useCallback((id: string, trimStartSec: number, trimEndSec: number) => {
    setData((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => {
        if (c.id !== id) return c;
        const maxDur = Math.max(0.2, c.durationSec || 2.5);
        const start = Math.max(0, Math.min(maxDur - 0.1, Math.round(trimStartSec * 100) / 100));
        const end = Math.max(start + 0.1, Math.min(maxDur, Math.round(trimEndSec * 100) / 100));
        return { ...c, trimStartSec: start, trimEndSec: end };
      }),
    }));
  }, []);

  const changeClipVoice = useCallback(
    async (clipId: string, voiceId: string) => {
      const curr = dataRef.current;
      const clip = curr.clips.find((c) => c.id === clipId);
      const voice = curr.voices.find((v) => v.id === voiceId);
      if (!clip || !voice) return;

      const prevAudioId = clip.audioId;

      try {
        const textToSynth = clip.preparedText || clip.text;
        const res = await audioEngine.synthesizeSegment(
          { text: textToSynth, voice: voice.engineVoice, rate: clip.rate },
          cacheHooks
        );
        setData((prev) => {
          const nextClips = prev.clips.map((c) =>
            c.id === clipId
              ? {
                  ...c,
                  voiceName: voice.name,
                  engineVoice: voice.engineVoice,
                  voiceTags: [...(voice.tags || [])],
                  speakerColor: voice.color || getSpeakerColorForVoice(voice.id),
                  audioId: res.audioId,
                  audioUrl: res.url,
                  durationSec: res.durationSec,
                  trimStartSec: 0,
                  trimEndSec: res.durationSec,
                  waveformPeaks: res.waveformPeaks,
                }
              : c
          );
          return { ...prev, clips: nextClips };
        });
        if (prevAudioId && prevAudioId !== res.audioId) {
          const latest = dataRef.current;
          const stillUsedByClips = latest.clips.some((c) => c.id !== clipId && c.audioId === prevAudioId);
          const stillUsedByFinal = latest.finalAudio?.id === prevAudioId;
          const stillUsedByCache = Object.values(latest.audioCache).some((e) => e.audioId === prevAudioId);
          if (!stillUsedByClips && !stillUsedByFinal && !stillUsedByCache) {
            audioEngine.revokeAudioObjectUrl(prevAudioId);
          }
        }
        showToast(`گوینده کلیپ به «${voice.name}» تغییر یافت و صدا بازتولید شد.`, 'success');
      } catch (err: unknown) {
        showToast(`خطا در تغییر گوینده کلیپ: ${(err as Error).message}`, 'error');
      }
    },
    [cacheHooks, showToast]
  );

  const moveClip = useCallback((id: string, direction: 'up' | 'down') => {
    setData((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.clips.length) return prev;
      const next = [...prev.clips];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return { ...prev, clips: next };
    });
  }, []);

  const moveClipToIndex = useCallback((id: string, targetIndex: number) => {
    setData((prev) => {
      const fromIndex = prev.clips.findIndex((c) => c.id === id);
      if (fromIndex === -1) return prev;
      const clamped = Math.max(0, Math.min(prev.clips.length - 1, targetIndex));
      if (fromIndex === clamped) return prev;
      const next = [...prev.clips];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(clamped, 0, moved);
      return { ...prev, clips: next };
    });
  }, []);

  const removeClip = useCallback(
    (id: string) => {
      const curr = dataRef.current;
      const target = curr.clips.find((c) => c.id === id);
      if (!target) return;
      const remaining = curr.clips.filter((c) => c.id !== id);
      const sharedWithClips = remaining.some((c) => c.audioId === target.audioId);
      const usedByFinal = curr.finalAudio?.id === target.audioId;
      const usedByCache = Object.values(curr.audioCache).some((e) => e.audioId === target.audioId);

      setData((prev) => ({
        ...prev,
        clips: prev.clips.filter((c) => c.id !== id),
      }));

      if (!sharedWithClips && !usedByFinal && !usedByCache) {
        audioEngine.revokeAudioObjectUrl(target.audioId);
      }

      showToast(
        sharedWithClips ? 'کلیپ حذف شد؛ فایل صوتی مشترک با کلیپ‌های دیگر دست‌نخورده ماند.' : 'کلیپ حذف شد.',
        'info'
      );
    },
    [showToast]
  );

  const clearAllClips = useCallback(() => {
    const curr = dataRef.current;
    const audioIds = Array.from(new Set(curr.clips.map((c) => c.audioId).filter(Boolean)));
    setData((prev) => ({ ...prev, clips: [] }));
    audioIds.forEach((aid) => {
      const usedByFinal = curr.finalAudio?.id === aid;
      const usedByCache = Object.values(curr.audioCache).some((e) => e.audioId === aid);
      if (!usedByFinal && !usedByCache) {
        audioEngine.revokeAudioObjectUrl(aid);
      }
    });
    showToast('کتابخانه ویس‌ها پاک‌سازی شد.', 'info');
  }, [showToast]);

  const resynthesizeClip = useCallback(
    async (clip: Clip) => {
      try {
        showToast(`در حال تولید مجدد با صدای «${clip.voiceName}»...`, 'info');
        const textToSynth = clip.preparedText || clip.text;
        const res = await audioEngine.synthesizeSegment(
          { text: textToSynth, voice: clip.engineVoice, rate: clip.rate },
          cacheHooks
        );
        const clonedClip: Clip = {
          ...clip,
          id: generateId('clip'),
          audioId: res.audioId,
          audioUrl: res.url,
          durationSec: res.durationSec,
          trimStartSec: 0,
          trimEndSec: res.durationSec,
          waveformPeaks: res.waveformPeaks,
          createdAt: new Date().toISOString(),
          selected: true,
        };
        setData((prev) => {
          const origIdx = prev.clips.findIndex((c) => c.id === clip.id);
          if (origIdx === -1) {
            return { ...prev, clips: [...prev.clips, clonedClip] };
          }
          const nextClips = [...prev.clips];
          nextClips.splice(origIdx + 1, 0, clonedClip);
          return { ...prev, clips: nextClips };
        });
        showToast(
          res.fromCache
            ? 'کلیپ جدید (با همان فایل صوتی کش‌شده) ساخته شد.'
            : 'کلیپ جدید با موفقیت ساخته شد.',
          'success'
        );
      } catch (err: unknown) {
        showToast(`خطا در ساخت دوباره: ${(err as Error).message}`, 'error');
      }
    },
    [cacheHooks, showToast]
  );

  const mergeSelectedClips = useCallback(async () => {
    const allClips = dataRef.current.clips;
    if (allClips.length === 0) {
      showToast('برای ساخت ویس کامل، حداقل ۱ کلیپ در کتابخانه باید وجود داشته باشد.', 'warning');
      return;
    }

    const selected = allClips.filter((c) => c.selected);
    const clipsToMerge = selected.length >= 1 ? selected : allClips;

    const gapAfterMs = clipsToMerge.map((c, idx) =>
      idx === clipsToMerge.length - 1 ? 0 : (c.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS)
    );

    const prevFinalId = dataRef.current.finalAudio?.id;
    const result = await audioEngine.mergeClips(clipsToMerge, gapAfterMs);
    const lastIdx = clipsToMerge.length - 1;
    const finalAudio: FinalAudio = {
      id: result.id,
      url: result.url,
      clipIds: clipsToMerge.map((c) => c.id),
      durationSec: result.durationSec || 0,
      createdAt: new Date().toISOString(),
      clipSnapshots: clipsToMerge.map((c, idx) => {
        const bounds = audioEngine.getEffectiveClipBounds(c);
        return {
          id: c.id,
          audioId: c.audioId,
          text: c.text,
          preparedText: c.preparedText || c.text,
          voiceName: c.voiceName,
          speakerColor: c.speakerColor || 'sky',
          pauseAfterMs: idx === lastIdx ? 0 : gapAfterMs[idx],
          durationSec: bounds.effectiveDuration,
          trimStartSec: bounds.start,
          trimEndSec: bounds.end,
          waveformPeaks: c.waveformPeaks,
        };
      }),
    };

    if (prevFinalId && prevFinalId !== finalAudio.id) {
      audioEngine.revokeAudioObjectUrl(prevFinalId);
    }
    finalEditStackRef.current.forEach((item) => {
      if (item.id && item.id !== finalAudio.id) {
        audioEngine.revokeAudioObjectUrl(item.id);
      }
    });
    finalEditStackRef.current = [];
    setHistoryTick((t) => t + 1);

    setData((prev) => ({
      ...prev,
      clips: selected.length === 0 ? prev.clips.map((c) => ({ ...c, selected: true })) : prev.clips,
      finalAudio,
    }));
    showToast(`ویس کامل با ترکیب ${clipsToMerge.length} کلیپ با موفقیت ساخته شد!`, 'success');
  }, [showToast]);

  const editFinalAudio = useCallback(
    (mode: 'cut-middle' | 'keep-range', startSec: number, endSec: number): boolean => {
      const curr = dataRef.current;
      if (!curr.finalAudio) return false;
      try {
        const res = audioEngine.applyCutToAudio(
          curr.finalAudio.id,
          mode,
          startSec,
          endSec,
          curr.finalAudio.durationSec
        );
        if (finalEditStackRef.current.length >= 15) {
          const dropped = finalEditStackRef.current.shift();
          if (dropped?.id) audioEngine.revokeAudioObjectUrl(dropped.id);
        }
        finalEditStackRef.current.push(curr.finalAudio);
        setHistoryTick((t) => t + 1);

        setData((prev) => {
          if (!prev.finalAudio) return prev;
          const slicedSnapshots = audioEngine.sliceClipSnapshotsForCut(
            prev.finalAudio.clipSnapshots || [],
            mode,
            startSec,
            endSec,
            res.durationSec
          );
          return {
            ...prev,
            finalAudio: {
              ...prev.finalAudio,
              id: res.id,
              url: res.url,
              durationSec: res.durationSec,
              isEdited: true,
              clipSnapshots: slicedSnapshots,
            },
          };
        });

        showToast(
          mode === 'cut-middle'
            ? `بازهٔ انتخاب‌شده از وسط خروجی نهایی حذف شد (مدت جدید: ${res.durationSec.toFixed(1)} ثانیه).`
            : `خروجی نهایی به بازهٔ انتخابی برش داده شد (مدت جدید: ${res.durationSec.toFixed(1)} ثانیه).`,
          'success'
        );
        return true;
      } catch (err: unknown) {
        showToast((err as Error).message || 'خطا در ویرایش خروجی نهایی', 'warning');
        return false;
      }
    },
    [showToast]
  );

  const applyFinalAudioEffect = useCallback(
    (effect: 'normalize' | 'fade'): boolean => {
      const curr = dataRef.current;
      if (!curr.finalAudio) return false;
      try {
        const res = audioEngine.applyAudioMasterEffect(
          curr.finalAudio.id,
          effect,
          curr.finalAudio.durationSec
        );
        if (finalEditStackRef.current.length >= 15) {
          const dropped = finalEditStackRef.current.shift();
          if (dropped?.id) audioEngine.revokeAudioObjectUrl(dropped.id);
        }
        finalEditStackRef.current.push(curr.finalAudio);
        setHistoryTick((t) => t + 1);

        setData((prev) => {
          if (!prev.finalAudio) return prev;
          return {
            ...prev,
            finalAudio: {
              ...prev.finalAudio,
              id: res.id,
              url: res.url,
              durationSec: res.durationSec,
              isEdited: true,
            },
          };
        });

        showToast(
          effect === 'normalize'
            ? 'بلندی و تراز صدای خروجی نهایی نرمال‌سازی شد.'
            : 'فید نرم ورود و خروج (Fade In / Out) به خروجی نهایی اعمال شد.',
          'success'
        );
        return true;
      } catch (err: unknown) {
        showToast((err as Error).message || 'خطا در پردازش صوت', 'warning');
        return false;
      }
    },
    [showToast]
  );

  const undoFinalAudioEdit = useCallback((): boolean => {
    if (finalEditStackRef.current.length === 0) return false;
    const prevSnapshot = finalEditStackRef.current.pop()!;
    const currentId = dataRef.current.finalAudio?.id;
    setHistoryTick((t) => t + 1);
    setData((prev) => ({ ...prev, finalAudio: prevSnapshot }));
    if (currentId && currentId !== prevSnapshot.id) {
      audioEngine.revokeAudioObjectUrl(currentId);
    }
    showToast('آخرین برش خروجی نهایی بازگردانی شد.', 'info');
    return true;
  }, [showToast]);

  const clearFinalAudio = useCallback(() => {
    const curr = dataRef.current;
    if (!curr.finalAudio) return;
    const finalId = curr.finalAudio.id;
    const usedByClips = curr.clips.some((c) => c.audioId === finalId);
    const usedByCache = Object.values(curr.audioCache).some((e) => e.audioId === finalId);
    finalEditStackRef.current.forEach((item) => {
      if (item.id && !curr.clips.some((c) => c.audioId === item.id)) {
        audioEngine.revokeAudioObjectUrl(item.id);
      }
    });
    finalEditStackRef.current = [];
    setHistoryTick((t) => t + 1);
    setData((prev) => ({ ...prev, finalAudio: null }));
    if (finalId && !usedByClips && !usedByCache) {
      audioEngine.revokeAudioObjectUrl(finalId);
    }
    showToast('خروجی نهایی حذف شد. می‌توانید دوباره ویس کامل بسازید.', 'info');
  }, [showToast]);

  const exportProjectJSON = useCallback(() => {
    const curr = dataRef.current;
    return JSON.stringify(
      {
        schemaVersion: CONFIG.SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        projectName: 'Persian-TTS-Project',
        data: {
          voices: curr.voices,
          allTags: curr.allTags,
          dictionary: curr.dictionary,
          segments: curr.segments.map((s) => ({ ...s, status: 'idle', error: null })),
          clips: curr.clips,
          finalAudio: curr.finalAudio,
          characterVoices: curr.characterVoices,
          audioCache: curr.audioCache,
        },
      },
      null,
      2
    );
  }, []);

  const importProjectJSON = useCallback((jsonString: string) => {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      throw new Error('ساختار فایل پروژه نامعتبر است؛ شیء داده (data) یافت نشد.');
    }
    const d = parsed.data;
    if (!Array.isArray(d.voices) || !Array.isArray(d.segments)) {
      throw new Error('فایل پروژه فاقد بخش‌های الزامی صداها یا پاراگراف‌ها است.');
    }

    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryTick((t) => t + 1);

    const voices: Voice[] = d.voices;
    const rawSegs: Segment[] = d.segments.map((s: Partial<Segment>) => ({
      ...normalizeSegment(s, voices),
      status: 'idle' as const,
      error: null,
    }));
    const rawCharVoices: Record<string, string> =
      d.characterVoices && typeof d.characterVoices === 'object' ? { ...d.characterVoices } : {};
    const rec = reconcileSegmentsAndCharacters(rawSegs, rawCharVoices, voices);

    setData((prev) => ({
      ...prev,
      voices,
      allTags: Array.isArray(d.allTags) ? d.allTags : extractAllTags(voices),
      dictionary: Array.isArray(d.dictionary) ? d.dictionary : [],
      segments: rec.segments,
      clips: Array.isArray(d.clips) ? d.clips : [],
      finalAudio: d.finalAudio || null,
      characterVoices: rec.characterVoices,
      audioCache: d.audioCache && typeof d.audioCache === 'object' ? { ...d.audioCache } : {},
    }));

    return {
      version: parsed.schemaVersion || '1.0',
      segmentCount: rec.segments.length,
      clipCount: Array.isArray(d.clips) ? d.clips.length : 0,
    };
  }, []);

  const characterSummary = useMemo<CharacterSummary[]>(() => {
    const map = new Map<string, CharacterSummary>();
    const validIds = new Set(data.voices.map((v) => v.id));
    for (const seg of data.segments) {
      if (!seg.characterName) continue;
      if (!map.has(seg.characterName)) {
        const mapped = data.characterVoices[seg.characterName];
        map.set(seg.characterName, {
          name: seg.characterName,
          voiceId: mapped && validIds.has(mapped) ? mapped : '',
          total: 0,
          unresolved: 0,
        });
      }
      const entry = map.get(seg.characterName)!;
      entry.total += 1;
      if (!validIds.has(seg.voiceId)) entry.unresolved += 1;
    }
    return Array.from(map.values());
  }, [data.segments, data.characterVoices, data.voices]);

  const canUndo = useMemo(() => undoStackRef.current.length > 0, [historyTick, data.segments]);
  const canRedo = useMemo(() => redoStackRef.current.length > 0, [historyTick, data.segments]);
  const canUndoFinalEdit = useMemo(() => finalEditStackRef.current.length > 0, [historyTick, data.finalAudio]);

  const value = useMemo<TtsContextValue>(
    () => ({
      voices: data.voices,
      allTags: data.allTags,
      dictionary: data.dictionary,
      segments: data.segments,
      clips: data.clips,
      finalAudio: data.finalAudio,
      tagFilter: data.tagFilter,
      characterVoices: data.characterVoices,
      batch,
      toasts,
      canUndo,
      canRedo,
      canUndoFinalEdit,
      characterSummary,
      confirmState,
      isVoiceValid,
      showToast,
      dismissToast,
      showConfirm,
      registerPlayingAudio,
      pushHistory,
      undo,
      redo,
      addVoice,
      updateVoice,
      deleteVoice,
      setTagFilter,
      addDictionaryEntry,
      deleteDictionaryEntry,
      addSegment,
      duplicateSegment,
      removeSegment,
      moveSegment,
      updateSegment,
      autoSplitText,
      convertSegmentById,
      handleConvertAll,
      handleCancelBatch,
      setCharacterVoice,
      removeCharacterVoice,
      applyDialogueLines,
      toggleClipSelect,
      selectAllClips,
      invertClipSelection,
      updateClipPause,
      updateClipTrim,
      changeClipVoice,
      moveClip,
      moveClipToIndex,
      removeClip,
      clearAllClips,
      resynthesizeClip,
      mergeSelectedClips,
      editFinalAudio,
      applyFinalAudioEffect,
      undoFinalAudioEdit,
      clearFinalAudio,
      exportProjectJSON,
      importProjectJSON,
    }),
    [
      data.voices,
      data.allTags,
      data.dictionary,
      data.segments,
      data.clips,
      data.finalAudio,
      data.tagFilter,
      data.characterVoices,
      batch,
      toasts,
      canUndo,
      canRedo,
      canUndoFinalEdit,
      characterSummary,
      confirmState,
      isVoiceValid,
      showToast,
      dismissToast,
      showConfirm,
      registerPlayingAudio,
      pushHistory,
      undo,
      redo,
      addVoice,
      updateVoice,
      deleteVoice,
      setTagFilter,
      addDictionaryEntry,
      deleteDictionaryEntry,
      addSegment,
      duplicateSegment,
      removeSegment,
      moveSegment,
      updateSegment,
      autoSplitText,
      convertSegmentById,
      handleConvertAll,
      handleCancelBatch,
      setCharacterVoice,
      removeCharacterVoice,
      applyDialogueLines,
      toggleClipSelect,
      selectAllClips,
      invertClipSelection,
      updateClipPause,
      updateClipTrim,
      changeClipVoice,
      moveClip,
      moveClipToIndex,
      removeClip,
      clearAllClips,
      resynthesizeClip,
      mergeSelectedClips,
      editFinalAudio,
      applyFinalAudioEffect,
      undoFinalAudioEdit,
      clearFinalAudio,
      exportProjectJSON,
      importProjectJSON,
    ]
  );

  return <TtsContext.Provider value={value}>{children}</TtsContext.Provider>;
}

export function computeClipDropIndex(
  fromIndex: number,
  toIndex: number,
  isBottom: boolean
): number {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return fromIndex;
  let targetIndex = toIndex;
  if (isBottom && fromIndex > toIndex) targetIndex = toIndex + 1;
  else if (!isBottom && fromIndex < toIndex) targetIndex = Math.max(0, toIndex - 1);
  return targetIndex;
}

export function useTts(): TtsContextValue {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error('useTts must be used inside TtsProvider');
  return ctx;
}
