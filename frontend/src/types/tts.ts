export type SegmentStatus = 'idle' | 'loading' | 'done' | 'error';

export type SpeakerColor = 'sky' | 'purple' | 'emerald' | 'amber';

export interface Voice {
  id: string;
  name: string;
  engineVoice: string;
  tags: string[];
  enabled: boolean;
  color?: SpeakerColor;
}

export interface EngineVoiceOption {
  id: string;
  engineVoice: string;
  name: string;
  baseFrequency?: number;
}

export interface DictionaryEntry {
  id: string;
  phrase: string;
  replacement: string;
}

export interface Segment {
  id: string;
  text: string;
  voiceId: string;
  characterName: string | null;
  rate: number;
  pauseAfterMs: number;
  status: SegmentStatus;
  error: string | null;
}

export interface Clip {
  id: string;
  segmentId: string | null;
  text: string;
  preparedText: string;
  voiceName: string;
  engineVoice: string;
  voiceTags: string[];
  speakerColor?: SpeakerColor;
  rate: number;
  pauseAfterMs: number;
  audioId: string;
  audioUrl: string;
  durationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
  waveformPeaks?: number[];
  createdAt: string;
  selected: boolean;
}

export interface ClipSnapshot {
  id: string;
  audioId?: string;
  text: string;
  preparedText?: string;
  voiceName: string;
  speakerColor?: SpeakerColor;
  pauseAfterMs: number;
  durationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
  waveformPeaks?: number[];
}

export interface FinalAudio {
  id: string;
  url: string;
  clipIds: string[];
  durationSec: number;
  createdAt: string;
  clipSnapshots: ClipSnapshot[];
  isEdited?: boolean;
}

export interface TagFilter {
  selectedTags: string[];
  mode: 'OR' | 'AND';
  untagged: boolean;
}

export interface AudioCacheEntry {
  audioId: string;
  url: string;
  durationSec: number;
  waveformPeaks?: number[];
}

export interface BatchState {
  active: boolean;
  total: number;
  completed: number;
  errors: number;
}

export interface CharacterSummary {
  name: string;
  voiceId: string;
  total: number;
  unresolved: number;
}

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
