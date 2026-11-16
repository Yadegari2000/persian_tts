/**
 * Central State Store & Persistence (Phase 3)
 * Adds characterVoices mapping (dialogue mode) and audioCache layer.
 * Manages all application data, pronunciation dictionary, pause intervals,
 * independent clip snapshots, undo/redo history, and project export/import.
 */

import { CONFIG } from './config.js';

// Observer subscribers
const listeners = new Set();

// Undo/Redo Stacks (strictly restricted to segments)
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 30;

// Central reactive state
let state = {
  voices: [],
  allTags: [],
  dictionary: [],
  segments: [],
  clips: [],
  finalAudio: null,
  characterVoices: {}, // { [characterName]: voiceId } — dialogue mode mapping
  audioCache: {},      // { [cacheKey]: { audioId, url, durationSec } } — synthesis cache
  tagFilter: {
    selectedTags: [],
    mode: 'OR', // 'OR' | 'AND'
    untagged: false
  },
  batch: {
    active: false,
    total: 0,
    completed: 0,
    errors: 0,
    controller: null
  }
};

/**
 * Generate a unique ID with an optional prefix.
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * True when voiceId points to an existing voice.
 */
export function isVoiceValid(voiceId) {
  return !!voiceId && state.voices.some(v => v.id === voiceId);
}

/**
 * The exact rate that is both cached on and sent to the engine (clamped 0.5–2.0, 2 decimals).
 */
export function normalizeRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return CONFIG.DEFAULT_RATE;
  return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
}

/**
 * Normalize one stored/imported segment.
 * Dialogue paragraphs (characterName set) whose voice is missing get voiceId '' (= unassigned)
 * instead of a guessed fallback; plain paragraphs keep the old fallback-to-first-voice behavior.
 */
function normalizeSegment(s, voices = state.voices) {
  const characterName = typeof s.characterName === 'string' && s.characterName.trim()
    ? s.characterName.trim()
    : null;
  const voiceExists = !!s.voiceId && voices.some(v => v.id === s.voiceId);
  const voiceId = voiceExists
    ? s.voiceId
    : (characterName ? '' : (voices[0]?.id ?? 'default'));

  return {
    id: s.id || generateId('seg'),
    text: typeof s.text === 'string' ? s.text : '',
    voiceId,
    characterName,
    rate: typeof s.rate === 'number' ? s.rate : CONFIG.DEFAULT_RATE,
    pauseAfterMs: typeof s.pauseAfterMs === 'number' ? s.pauseAfterMs : CONFIG.DEFAULT_PAUSE_AFTER_MS,
    status: s.status === 'loading' ? 'idle' : (s.status || 'idle'),
    error: s.status === 'loading' ? null : (s.error || null)
  };
}

/**
 * Keep dialogue data consistent (no notify): drop mappings to missing voices,
 * fill unassigned dialogue paragraphs from the mapping, repair plain paragraphs with a dead voice.
 */
function reconcileDialogueState() {
  for (const [name, vid] of Object.entries(state.characterVoices)) {
    if (!isVoiceValid(vid)) delete state.characterVoices[name];
  }
  for (const seg of state.segments) {
    if (isVoiceValid(seg.voiceId)) continue;
    if (seg.characterName) {
      const mapped = state.characterVoices[seg.characterName];
      seg.voiceId = isVoiceValid(mapped) ? mapped : '';
    } else {
      seg.voiceId = state.voices[0]?.id ?? 'default';
    }
  }
}

/**
 * Deep clone segments for undo/redo snapshots.
 */
function cloneSegments(segments) {
  return segments.map(s => ({
    id: s.id,
    text: s.text,
    voiceId: s.voiceId,
    rate: s.rate,
    pauseAfterMs: s.pauseAfterMs,
    status: s.status === 'loading' ? 'idle' : s.status,
    error: s.error,
    characterName: s.characterName ?? null
  }));
}

/**
 * Push snapshot of segments to undo history stack.
 */
export function pushHistory() {
  if (undoStack.length >= MAX_HISTORY) {
    undoStack.shift();
  }
  undoStack.push(cloneSegments(state.segments));
  redoStack.length = 0; // Clear redo on new action
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function undo() {
  if (!canUndo()) return false;
  redoStack.push(cloneSegments(state.segments));
  const previous = undoStack.pop();
  state.segments = cloneSegments(previous);
  reconcileDialogueState();
  notify('UNDO');
  return true;
}

export function redo() {
  if (!canRedo()) return false;
  undoStack.push(cloneSegments(state.segments));
  const next = redoStack.pop();
  state.segments = cloneSegments(next);
  reconcileDialogueState();
  notify('REDO');
  return true;
}

/**
 * Notify all registered subscribers and persist state to localStorage.
 */
function notify(changeType = 'GENERAL') {
  saveState();
  for (const listener of listeners) {
    try {
      listener(state, changeType);
    } catch (err) {
      console.error('State subscriber error:', err);
    }
  }
}

/**
 * Subscribe to state changes.
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get read-only snapshot of state.
 */
export function getState() {
  return state;
}

/**
 * Validate and safely load state from localStorage.
 */
export function loadState() {
  try {
    // Try v3 storage key, then fallback to v2, then v1
    let raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem('persian_tts_state_v2');
    }
    if (!raw) {
      raw = localStorage.getItem('persian_tts_state_v1');
    }

    if (raw) {
      const parsed = JSON.parse(raw);

      state.voices = Array.isArray(parsed.voices) && parsed.voices.length > 0
        ? parsed.voices
        : [...CONFIG.INITIAL_VOICES];

      state.allTags = Array.isArray(parsed.allTags)
        ? Array.from(new Set(parsed.allTags))
        : extractAllTags(state.voices);

      // Restore pronunciation dictionary
      state.dictionary = Array.isArray(parsed.dictionary)
        ? parsed.dictionary.map(d => ({
            id: d.id || generateId('dict'),
            phrase: d.phrase || '',
            replacement: d.replacement || ''
          }))
        : [...CONFIG.INITIAL_DICTIONARY];

      // Restore segments (keeps characterName; dialogue paragraphs without a valid voice stay unassigned)
      state.segments = Array.isArray(parsed.segments)
        ? parsed.segments.map(s => normalizeSegment(s, state.voices))
        : [];

      // Restore clips with pauseAfterMs and preparedText
      state.clips = Array.isArray(parsed.clips)
        ? parsed.clips.map(c => ({
            id: c.id || generateId('clip'),
            segmentId: c.segmentId || null,
            text: c.text || '',
            preparedText: c.preparedText || c.text || '',
            voiceName: c.voiceName || 'صدای نامشخص',
            engineVoice: c.engineVoice || 'default',
            voiceTags: Array.isArray(c.voiceTags) ? c.voiceTags : [],
            rate: typeof c.rate === 'number' ? c.rate : 1.0,
            pauseAfterMs: typeof c.pauseAfterMs === 'number' ? c.pauseAfterMs : CONFIG.DEFAULT_PAUSE_AFTER_MS,
            audioId: c.audioId || '',
            audioUrl: c.audioUrl || '',
            durationSec: typeof c.durationSec === 'number' ? c.durationSec : 0,
            createdAt: c.createdAt || new Date().toISOString(),
            selected: c.selected !== undefined ? Boolean(c.selected) : true
          }))
        : [];

      state.finalAudio = parsed.finalAudio && typeof parsed.finalAudio === 'object'
        ? {
            id: parsed.finalAudio.id || '',
            url: parsed.finalAudio.url || '',
            clipIds: Array.isArray(parsed.finalAudio.clipIds) ? parsed.finalAudio.clipIds : [],
            durationSec: parsed.finalAudio.durationSec || 0,
            createdAt: parsed.finalAudio.createdAt || new Date().toISOString(),
            clipSnapshots: Array.isArray(parsed.finalAudio.clipSnapshots) ? parsed.finalAudio.clipSnapshots : []
          }
        : null;

      if (parsed.tagFilter) {
        state.tagFilter = {
          selectedTags: Array.isArray(parsed.tagFilter.selectedTags) ? parsed.tagFilter.selectedTags : [],
          mode: parsed.tagFilter.mode === 'AND' ? 'AND' : 'OR',
          untagged: Boolean(parsed.tagFilter.untagged)
        };
      }

      // Restore characterVoices (dialogue mode)
      state.characterVoices = parsed.characterVoices && typeof parsed.characterVoices === 'object'
        ? { ...parsed.characterVoices }
        : {};

      // Restore audioCache (only metadata references, not binary audio data)
      if (parsed.audioCache && typeof parsed.audioCache === 'object') {
        state.audioCache = {};
        for (const [key, val] of Object.entries(parsed.audioCache)) {
          if (key.startsWith('v1|') && val && val.audioId && val.url) {
            state.audioCache[key] = {
              audioId: val.audioId,
              url: val.url,
              durationSec: typeof val.durationSec === 'number' ? val.durationSec : 0
            };
          }
        }
      } else {
        state.audioCache = {};
      }
    } else {
      // First run default state
      state.voices = [...CONFIG.INITIAL_VOICES];
      state.allTags = extractAllTags(state.voices);
      state.dictionary = [...CONFIG.INITIAL_DICTIONARY];
      state.segments = [
        {
          id: generateId('seg'),
          text: 'به سامانه تبدیل متن به گفتار فارسی خوش آمدید. این سامانه از اعشار، اعداد ۱۲۳ و دیکشنری تلفظ پشتیبانی می‌کند.',
          voiceId: state.voices[0]?.id || 'voice-1',
          rate: 1.0,
          pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
          status: 'idle',
          error: null
        }
      ];
      state.clips = [];
      state.finalAudio = null;
      state.characterVoices = {};
      state.audioCache = {};
    }
  } catch (err) {
    console.warn('Failed to load state from localStorage, resetting:', err);
    state.voices = [...CONFIG.INITIAL_VOICES];
    state.allTags = extractAllTags(state.voices);
    state.dictionary = [...CONFIG.INITIAL_DICTIONARY];
    state.segments = [];
    state.clips = [];
    state.finalAudio = null;
    state.characterVoices = {};
    state.audioCache = {};
  }

  reconcileDialogueState();

  if (state.segments.length === 0) {
    state.segments.push({
      id: generateId('seg'),
      text: '',
      voiceId: state.voices[0]?.id || 'voice-1',
      rate: 1.0,
      pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
      status: 'idle',
      error: null
    });
  }

  notify('INITIALIZED');
}

/**
 * Persist current state to localStorage.
 */
export function saveState() {
  try {
    const payload = {
      schemaVersion: CONFIG.SCHEMA_VERSION,
      voices: state.voices,
      allTags: state.allTags,
      dictionary: state.dictionary,
      segments: state.segments.map(s => ({
        id: s.id,
        text: s.text,
        voiceId: s.voiceId,
        rate: s.rate,
        pauseAfterMs: s.pauseAfterMs,
        status: s.status === 'loading' ? 'idle' : s.status,
        error: s.error,
        characterName: s.characterName ?? null
      })),
      clips: state.clips,
      finalAudio: state.finalAudio,
      tagFilter: state.tagFilter,
      characterVoices: state.characterVoices,
      audioCache: state.audioCache
    };
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
}

function extractAllTags(voices) {
  const set = new Set();
  for (const v of voices) {
    if (Array.isArray(v.tags)) {
      v.tags.forEach(t => t && set.add(t.trim()));
    }
  }
  return Array.from(set);
}

// ==========================================
// PRONUNCIATION DICTIONARY ACTIONS
// ==========================================

export function addDictionaryEntry(phrase, replacement) {
  const cleanPhrase = (phrase || '').trim();
  const cleanReplacement = (replacement || '').trim();
  if (!cleanPhrase) return null;

  const entry = {
    id: generateId('dict'),
    phrase: cleanPhrase,
    replacement: cleanReplacement
  };

  state.dictionary.push(entry);
  notify('DICTIONARY_UPDATED');
  return entry;
}

export function updateDictionaryEntry(id, { phrase, replacement }) {
  const entry = state.dictionary.find(d => d.id === id);
  if (!entry) return;

  if (typeof phrase === 'string') entry.phrase = phrase.trim();
  if (typeof replacement === 'string') entry.replacement = replacement.trim();

  notify('DICTIONARY_UPDATED');
}

export function deleteDictionaryEntry(id) {
  const index = state.dictionary.findIndex(d => d.id === id);
  if (index !== -1) {
    state.dictionary.splice(index, 1);
    notify('DICTIONARY_UPDATED');
  }
}

// ==========================================
// VOICE ACTIONS
// ==========================================

export function addVoice({ name, engineVoice, tags = [] }) {
  const cleanTags = tags.map(t => t.trim()).filter(Boolean);
  const newVoice = {
    id: generateId('voice'),
    name: name.trim() || 'صدای جدید',
    engineVoice: engineVoice || 'default',
    tags: cleanTags,
    enabled: true
  };

  state.voices.push(newVoice);
  for (const tag of cleanTags) {
    if (!state.allTags.includes(tag)) state.allTags.push(tag);
  }

  notify('VOICE_ADDED');
  return newVoice;
}

export function updateVoice(id, { name, tags }) {
  const voice = state.voices.find(v => v.id === id);
  if (!voice) return;

  if (typeof name === 'string') voice.name = name.trim();
  if (Array.isArray(tags)) {
    const cleanTags = tags.map(t => t.trim()).filter(Boolean);
    voice.tags = cleanTags;
    for (const tag of cleanTags) {
      if (!state.allTags.includes(tag)) state.allTags.push(tag);
    }
  }

  notify('VOICE_UPDATED');
}

export function deleteVoice(id) {
  const index = state.voices.findIndex(v => v.id === id);
  if (index === -1) return;

  const remainingVoices = state.voices.filter(v => v.id !== id);
  const fallbackVoiceId = remainingVoices[0]?.id || 'default';

  let remappedCount = 0;   // plain paragraphs moved to the fallback voice
  let unassignedCount = 0; // dialogue paragraphs left WITHOUT a voice (never silently re-voiced)
  for (const seg of state.segments) {
    if (seg.voiceId !== id) continue;
    if (seg.characterName) {
      seg.voiceId = '';
      unassignedCount++;
    } else {
      seg.voiceId = fallbackVoiceId;
      remappedCount++;
    }
  }
  for (const [name, vid] of Object.entries(state.characterVoices)) {
    if (vid === id) delete state.characterVoices[name];
  }

  state.voices.splice(index, 1);
  state.allTags = extractAllTags(state.voices);

  notify('VOICE_DELETED');
  return { remappedCount, unassignedCount };
}

export function setTagFilter({ selectedTags, mode, untagged }) {
  if (selectedTags !== undefined) state.tagFilter.selectedTags = selectedTags;
  if (mode !== undefined) state.tagFilter.mode = mode;
  if (untagged !== undefined) state.tagFilter.untagged = untagged;
  notify('TAG_FILTER_CHANGED');
}

// ==========================================
// SEGMENT (PARAGRAPH) ACTIONS WITH UNDO
// ==========================================

export function addSegment(afterId = null) {
  pushHistory();

  let insertIndex = state.segments.length;
  let inheritedVoiceId = state.voices[0]?.id || 'voice-1';
  let inheritedPause = CONFIG.DEFAULT_PAUSE_AFTER_MS;

  if (afterId) {
    const idx = state.segments.findIndex(s => s.id === afterId);
    if (idx !== -1) {
      insertIndex = idx + 1;
      inheritedVoiceId = state.segments[idx].voiceId;
      inheritedPause = state.segments[idx].pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS;
    }
  } else if (state.segments.length > 0) {
    inheritedVoiceId = state.segments[state.segments.length - 1].voiceId;
    inheritedPause = state.segments[state.segments.length - 1].pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS;
  }

  if (!isVoiceValid(inheritedVoiceId)) inheritedVoiceId = state.voices[0]?.id || 'voice-1';

  const newSegment = {
    id: generateId('seg'),
    text: '',
    voiceId: inheritedVoiceId,
    characterName: null,
    rate: CONFIG.DEFAULT_RATE,
    pauseAfterMs: inheritedPause,
    status: 'idle',
    error: null
  };

  state.segments.splice(insertIndex, 0, newSegment);
  notify('SEGMENT_ADDED');
  return newSegment;
}

export function duplicateSegment(id) {
  pushHistory();

  const idx = state.segments.findIndex(s => s.id === id);
  if (idx === -1) return;

  const original = state.segments[idx];
  const duplicate = {
    id: generateId('seg'),
    text: original.text,
    voiceId: original.voiceId,
    characterName: original.characterName ?? null,
    rate: original.rate,
    pauseAfterMs: original.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS,
    status: 'idle',
    error: null
  };

  state.segments.splice(idx + 1, 0, duplicate);
  notify('SEGMENT_DUPLICATED');
  return duplicate;
}

export function removeSegment(id) {
  pushHistory();

  if (state.segments.length <= 1) {
    const seg = state.segments[0];
    seg.text = '';
    seg.status = 'idle';
    seg.error = null;
    notify('SEGMENT_RESET');
    return;
  }

  const index = state.segments.findIndex(s => s.id === id);
  if (index !== -1) {
    state.segments.splice(index, 1);
    notify('SEGMENT_REMOVED');
  }
}

export function moveSegment(id, direction) {
  pushHistory();

  const index = state.segments.findIndex(s => s.id === id);
  if (index === -1) return;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= state.segments.length) return;

  const [moved] = state.segments.splice(index, 1);
  state.segments.splice(targetIndex, 0, moved);
  notify('SEGMENT_MOVED');
}

export function updateSegment(id, updates, recordHistory = false) {
  if (recordHistory) pushHistory();

  const seg = state.segments.find(s => s.id === id);
  if (!seg) return;

  if (typeof updates.text === 'string') seg.text = updates.text;
  if (typeof updates.voiceId === 'string') seg.voiceId = updates.voiceId;
  if (typeof updates.rate === 'number') seg.rate = updates.rate;
  if (typeof updates.pauseAfterMs === 'number') seg.pauseAfterMs = Math.max(0, Math.min(2000, updates.pauseAfterMs));

  notify('SEGMENT_UPDATED');
}

/**
 * Update segment properties quietly without triggering DOM re-render.
 * Ideal for smooth range sliders (rate, pause) and realtime typing.
 */
export function updateSegmentQuiet(id, updates) {
  const seg = state.segments.find(s => s.id === id);
  if (!seg) return;

  if (typeof updates.text === 'string') seg.text = updates.text;
  if (typeof updates.voiceId === 'string') seg.voiceId = updates.voiceId;
  if (typeof updates.rate === 'number') seg.rate = updates.rate;
  if (typeof updates.pauseAfterMs === 'number') seg.pauseAfterMs = Math.max(0, Math.min(2000, updates.pauseAfterMs));

  saveState();
}

export function setSegmentStatus(id, status, error = null) {
  const seg = state.segments.find(s => s.id === id);
  if (!seg) return;

  seg.status = status;
  seg.error = error;
  notify('SEGMENT_STATUS_CHANGED');
}

export function autoSplitText(rawText) {
  pushHistory();

  if (!rawText || !rawText.trim()) return;

  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return;

  const defaultVoiceId = state.voices[0]?.id || 'voice-1';
  state.segments = paragraphs.map(text => ({
    id: generateId('seg'),
    text: text.slice(0, CONFIG.MAX_CHAR_COUNT),
    voiceId: defaultVoiceId,
    characterName: null,
    rate: CONFIG.DEFAULT_RATE,
    pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
    status: 'idle',
    error: null
  }));

  notify('AUTO_SPLIT_DONE');
}

// ==========================================
// CLIP LIBRARY ACTIONS (INDEPENDENT SNAPSHOTS)
// ==========================================

export function addClipFromSegment(segment, synthesisResult, preparedText = '') {
  const voice = state.voices.find(v => v.id === segment.voiceId);

  // Independent immutable snapshot
  const clip = {
    id: generateId('clip'),
    segmentId: segment.id,
    text: segment.text,
    preparedText: preparedText || segment.text,
    voiceName: voice ? voice.name : 'صدای نامشخص',
    engineVoice: voice ? voice.engineVoice : 'default',
    voiceTags: voice && Array.isArray(voice.tags) ? [...voice.tags] : [],
    rate: segment.rate,
    pauseAfterMs: segment.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS,
    audioId: synthesisResult.audioId,
    audioUrl: synthesisResult.url,
    durationSec: synthesisResult.durationSec || 0,
    createdAt: new Date().toISOString(),
    selected: true
  };

  state.clips.unshift(clip);
  notify('CLIP_ADDED');
  return clip;
}

export function addClipDirect(clipData) {
  state.clips.unshift({
    ...clipData,
    id: generateId('clip'),
    createdAt: new Date().toISOString(),
    selected: true
  });
  notify('CLIP_ADDED');
}

export function updateClipPause(id, pauseAfterMs) {
  const clip = state.clips.find(c => c.id === id);
  if (clip) {
    clip.pauseAfterMs = Math.max(0, Math.min(2000, pauseAfterMs));
    notify('CLIP_UPDATED');
  }
}

/**
 * True when an audio file (by audioId) is still referenced by a clip, the final audio or the cache.
 * The file itself is never deleted from the client; this only guards local cleanup (blob URLs).
 */
export function isAudioIdReferenced(audioId, { excludeClipId = null } = {}) {
  if (!audioId) return false;
  if (state.clips.some(c => c.id !== excludeClipId && c.audioId === audioId)) return true;
  if (state.finalAudio && state.finalAudio.id === audioId) return true;
  return Object.values(state.audioCache).some(e => e.audioId === audioId);
}

/**
 * Remove ONE clip card. Shared audio (other clips / final audio / cache) is untouched.
 * @returns {{removed: boolean, audioId?: string, sharedWithClips?: boolean, audioStillReferenced?: boolean}}
 */
export function removeClip(id) {
  const index = state.clips.findIndex(c => c.id === id);
  if (index === -1) return { removed: false };

  const [removedClip] = state.clips.splice(index, 1);
  const sharedWithClips = state.clips.some(c => c.audioId === removedClip.audioId);
  const audioStillReferenced = isAudioIdReferenced(removedClip.audioId);

  notify('CLIP_REMOVED');
  return { removed: true, audioId: removedClip.audioId, sharedWithClips, audioStillReferenced };
}

/**
 * Remove all clips. The final audio keeps its own file and snapshots.
 * @returns {string[]} audioIds that are no longer referenced by anything (safe to release locally)
 */
export function clearAllClips() {
  const audioIds = Array.from(new Set(state.clips.map(c => c.audioId).filter(Boolean)));
  state.clips = [];
  const releasable = audioIds.filter(a => !isAudioIdReferenced(a));
  notify('CLIPS_CLEARED');
  return releasable;
}

export function moveClip(id, direction) {
  const index = state.clips.findIndex(c => c.id === id);
  if (index === -1) return;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= state.clips.length) return;

  const [moved] = state.clips.splice(index, 1);
  state.clips.splice(targetIndex, 0, moved);
  notify('CLIP_MOVED');
}

/**
 * Move a clip to a specific target index (used by drag and drop reordering).
 */
export function moveClipToIndex(id, targetIndex) {
  const fromIndex = state.clips.findIndex(c => c.id === id);
  if (fromIndex === -1) return;
  const clampedTarget = Math.max(0, Math.min(state.clips.length - 1, targetIndex));
  if (fromIndex === clampedTarget) return;

  const [moved] = state.clips.splice(fromIndex, 1);
  state.clips.splice(clampedTarget, 0, moved);
  notify('CLIP_MOVED');
}

export function toggleClipSelect(id) {
  const clip = state.clips.find(c => c.id === id);
  if (clip) {
    clip.selected = !clip.selected;
    notify('CLIP_SELECTION_CHANGED');
  }
}

export function selectAllClips(value = true) {
  for (const c of state.clips) {
    c.selected = value;
  }
  notify('CLIP_SELECTION_CHANGED');
}

export function invertClipSelection() {
  for (const c of state.clips) {
    c.selected = !c.selected;
  }
  notify('CLIP_SELECTION_CHANGED');
}

// ==========================================
// FINAL AUDIO ACTIONS
// ==========================================

/**
 * @param {object} result        merge response ({ id, url, durationSec })
 * @param {object[]} selectedClips clips in merge order
 * @param {number[]} [gapAfterMs]  the gaps actually sent to the merge (last = 0). Snapshots store
 *                                 these effective gaps so SRT timing matches the merged audio.
 */
export function setFinalAudio(result, selectedClips, gapAfterMs = null) {
  const lastIdx = selectedClips.length - 1;
  state.finalAudio = {
    id: result.id,
    url: result.url,
    clipIds: selectedClips.map(c => c.id),
    durationSec: result.durationSec || 0,
    createdAt: new Date().toISOString(),
    clipSnapshots: selectedClips.map((c, idx) => ({
      id: c.id,
      text: c.text,
      preparedText: c.preparedText || c.text,
      voiceName: c.voiceName,
      pauseAfterMs: idx === lastIdx
        ? 0
        : (Array.isArray(gapAfterMs) && typeof gapAfterMs[idx] === 'number' ? gapAfterMs[idx] : (c.pauseAfterMs ?? 0)),
      durationSec: c.durationSec
    }))
  };
  notify('FINAL_AUDIO_SET');
}

export function clearFinalAudio() {
  state.finalAudio = null;
  notify('FINAL_AUDIO_CLEARED');
}

// ==========================================
// PROJECT EXPORT & IMPORT
// ==========================================

export function exportProjectJSON() {
  const project = {
    schemaVersion: CONFIG.SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    projectName: "Persian-TTS-Project",
    data: {
      voices: state.voices,
      allTags: state.allTags,
      dictionary: state.dictionary,
      segments: state.segments.map(s => ({
        ...s,
        status: 'idle',
        error: null
      })),
      clips: state.clips,
      finalAudio: state.finalAudio,
      characterVoices: state.characterVoices,
      audioCache: state.audioCache
    }
  };
  return JSON.stringify(project, null, 2);
}

export function importProjectJSON(jsonString) {
  if (typeof jsonString !== 'string') {
    throw new Error('فایل ورودی نامعتبر است.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('فرمت فایل JSON نامعتبر است یا محتوا خراب شده است.');
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('ساختار فایل پروژه نامعتبر است؛ شیء داده (data) یافت نشد.');
  }

  const d = parsed.data;

  // Validate critical collections
  if (!Array.isArray(d.voices) || !Array.isArray(d.segments)) {
    throw new Error('فایل پروژه فاقد بخش‌های الزامی صداها یا پاراگراف‌ها است.');
  }

  // Clear undo/redo history before applying imported project
  undoStack.length = 0;
  redoStack.length = 0;

  state.voices = d.voices;
  state.allTags = Array.isArray(d.allTags) ? d.allTags : extractAllTags(d.voices);
  state.dictionary = Array.isArray(d.dictionary) ? d.dictionary : [];
  state.segments = d.segments.map(s => ({
    ...normalizeSegment(s, state.voices),
    status: 'idle',
    error: null
  }));
  state.clips = Array.isArray(d.clips) ? d.clips : [];
  state.finalAudio = d.finalAudio || null;
  state.characterVoices = d.characterVoices && typeof d.characterVoices === 'object' ? { ...d.characterVoices } : {};
  state.audioCache = d.audioCache && typeof d.audioCache === 'object' ? { ...d.audioCache } : {};

  reconcileDialogueState(); // drop mappings to missing voices, keep unassigned dialogue paragraphs unassigned

  notify('PROJECT_IMPORTED');
  return {
    version: parsed.schemaVersion || '1.0',
    segmentCount: state.segments.length,
    clipCount: state.clips.length
  };
}

// ==========================================
// BATCH PROGRESS ACTIONS
// ==========================================

export function setBatchState(updates) {
  state.batch = { ...state.batch, ...updates };
  notify('BATCH_STATE_CHANGED');
}

// ==========================================
// CHARACTER VOICE MAPPING (DIALOGUE MODE)
// ==========================================

/**
 * Assign a voice to a character. Only an existing voice is accepted.
 * All paragraphs of that character follow the mapping.
 * (Mapping edits are not part of the segment undo stack.)
 * @returns {boolean} true if applied
 */
export function setCharacterVoice(characterName, voiceId) {
  const name = (characterName || '').trim();
  if (!name || !isVoiceValid(voiceId)) return false;

  state.characterVoices[name] = voiceId;
  for (const seg of state.segments) {
    if (seg.characterName === name) seg.voiceId = voiceId;
  }
  notify('CHARACTER_VOICE_SET');
  return true;
}

/**
 * Remove a character's mapping; its paragraphs that used the mapped voice become unassigned.
 */
export function removeCharacterVoice(characterName) {
  if (!(characterName in state.characterVoices)) return;

  const previous = state.characterVoices[characterName];
  delete state.characterVoices[characterName];
  for (const seg of state.segments) {
    if (seg.characterName === characterName && seg.voiceId === previous) seg.voiceId = '';
  }
  notify('CHARACTER_VOICE_REMOVED');
}

/**
 * Characters present in the current paragraphs with their mapping status.
 * @returns {Array<{name: string, voiceId: string, total: number, unresolved: number}>}
 */
export function getCharacterSummary() {
  const map = new Map();
  for (const seg of state.segments) {
    if (!seg.characterName) continue;
    if (!map.has(seg.characterName)) {
      const mapped = state.characterVoices[seg.characterName];
      map.set(seg.characterName, {
        name: seg.characterName,
        voiceId: isVoiceValid(mapped) ? mapped : '',
        total: 0,
        unresolved: 0
      });
    }
    const entry = map.get(seg.characterName);
    entry.total += 1;
    if (!isVoiceValid(seg.voiceId)) entry.unresolved += 1;
  }
  return Array.from(map.values());
}

/**
 * Replace all segments with dialogue turns. A character without a valid mapped voice
 * gets voiceId '' (unassigned): such a paragraph is flagged in the UI and cannot be converted.
 *
 * @param {Array<{character: string, text: string}>} dialogueLines
 */
export function applyDialogueLines(dialogueLines) {
  pushHistory();

  state.segments = dialogueLines.map(line => {
    const mapped = state.characterVoices[line.character];
    return {
      id: generateId('seg'),
      text: line.text,
      voiceId: isVoiceValid(mapped) ? mapped : '',
      characterName: line.character,
      rate: CONFIG.DEFAULT_RATE,
      pauseAfterMs: CONFIG.DEFAULT_PAUSE_AFTER_MS,
      status: 'idle',
      error: null
    };
  });

  notify('DIALOGUE_APPLIED');
}

// ==========================================
// AUDIO CACHE ACTIONS
// ==========================================

/**
 * 53-bit string hash (cyrb53) — keeps cache keys short instead of embedding the whole text.
 */
function hashString(str) {
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

/**
 * Canonical cache key from what is ACTUALLY sent to the engine:
 * the exact preparedText, the engineVoice and the normalized rate.
 * Format: v1|engineVoice|rate|textLength|textHash
 */
export function buildCacheKey(preparedText, engineVoice, rate) {
  const text = String(preparedText ?? '');
  return `v1|${engineVoice}|${normalizeRate(rate)}|${text.length}|${hashString(text)}`;
}

/**
 * @returns {{ audioId: string, url: string, durationSec: number } | null}
 */
export function getCachedAudio(cacheKey) {
  return state.audioCache[cacheKey] || null;
}

/**
 * Store an audio reference (metadata only — never audio data). Oldest entries are pruned.
 */
export function setCachedAudio(cacheKey, { audioId, url, durationSec }) {
  delete state.audioCache[cacheKey]; // re-insert → becomes the newest entry
  state.audioCache[cacheKey] = { audioId, url, durationSec: typeof durationSec === 'number' ? durationSec : 0 };

  const max = CONFIG.CACHE_MAX_ENTRIES || 300;
  const keys = Object.keys(state.audioCache);
  for (let i = 0; i < keys.length - max; i++) {
    delete state.audioCache[keys[i]];
  }
  saveState(); // silent: no re-render for cache-only updates
}

/**
 * Invalidate one stale cache entry (e.g. server returned 404). Clips are NOT touched.
 */
export function invalidateCacheEntry(cacheKey) {
  if (cacheKey in state.audioCache) {
    delete state.audioCache[cacheKey];
    saveState();
  }
}

/**
 * Invalidate every cache entry that points to this audioId (used when a file 404s on playback/download).
 * Clips and final audio are NOT touched.
 * @returns {number} number of removed entries
 */
export function invalidateCacheByAudioId(audioId) {
  let removed = 0;
  for (const [key, entry] of Object.entries(state.audioCache)) {
    if (entry.audioId === audioId) {
      delete state.audioCache[key];
      removed++;
    }
  }
  if (removed > 0) saveState();
  return removed;
}
