import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { SPEAKER_PALETTE } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { SpeakerColor } from '../types/tts';
import * as audioEngine from '../utils/audioEngine';

function formatClock(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

export interface MultiColorSegment {
  durationSec: number;
  pauseAfterMs: number;
  color: SpeakerColor;
  peaks: number[];
  label?: string;
}

export interface SelectionOverlay {
  active: boolean;
  startSec: number;
  endSec: number;
  onChange: (start: number, end: number) => void;
}

export interface AuditionRequest {
  startSec: number;
  endSec: number;
  nonce: number;
}

interface WaveformPlayerProps {
  audioId: string;
  durationSec: number;
  engineVoice?: string;
  fallbackText?: string;
  speakerColor?: SpeakerColor;
  peaks?: number[];
  trimStartSec?: number;
  trimEndSec?: number;
  trimOpen?: boolean;
  onChangeTrim?: (start: number, end: number) => void;
  selectionOverlay?: SelectionOverlay;
  auditionRequest?: AuditionRequest | null;
  showZoom?: boolean;
  multiSegments?: MultiColorSegment[];
  extraActions?: React.ReactNode;
}

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0, 0.75];
const ZOOM_STEPS = [100, 150, 200, 300, 400];

export const WaveformPlayer = React.memo(function WaveformPlayer({
  audioId,
  durationSec,
  engineVoice = 'fa-male-narrator-1',
  fallbackText = 'پیش نمایش صدا',
  speakerColor = 'purple',
  peaks,
  trimStartSec = 0,
  trimEndSec,
  trimOpen = false,
  onChangeTrim,
  selectionOverlay,
  auditionRequest,
  showZoom = true,
  multiSegments,
  extraActions,
}: WaveformPlayerProps) {
  const { registerPlayingAudio, showToast } = useTts();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [muted, setMuted] = useState(false);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const zoom = ZOOM_STEPS[zoomIdx];
  const safeDuration = Math.max(0.2, durationSec || 2.5);
  const propEnd = trimEndSec !== undefined ? Math.min(safeDuration, trimEndSec) : safeDuration;
  const propStart = Math.max(0, Math.min(propEnd - 0.1, trimStartSec));

  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | 'cut-start' | 'cut-end' | null>(null);
  const [slidingRange, setSlidingRange] = useState(false);
  const [localTrim, setLocalTrim] = useState<{ start: number; end: number }>({
    start: propStart,
    end: propEnd,
  });

  const localTrimRef = useRef(localTrim);
  localTrimRef.current = localTrim;
  const onChangeTrimRef = useRef(onChangeTrim);
  onChangeTrimRef.current = onChangeTrim;
  const selectionRef = useRef(selectionOverlay);
  selectionRef.current = selectionOverlay;

  const scrubSecRef = useRef(0);
  const wasPlayingOnScrubRef = useRef(false);
  const prevEffectiveBoundsRef = useRef({ start: propStart, end: propEnd });

  useEffect(() => {
    if (!draggingHandle && !slidingRange) {
      setLocalTrim({ start: propStart, end: propEnd });
    }
  }, [propStart, propEnd, draggingHandle, slidingRange]);

  const effectiveStart = localTrim.start;
  const effectiveEnd = localTrim.end;
  const playStartReturnRef = useRef(effectiveStart);
  const playLimitRef = useRef(effectiveEnd);
  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const playbackRate = SPEED_OPTIONS[speedIdx];
  const palette = SPEAKER_PALETTE[speakerColor] || SPEAKER_PALETTE.purple;

  // Segment boundary metadata for multi-speaker Final Audio timeline markers & hover lookup
  const segmentSpans = useMemo(() => {
    if (!multiSegments || multiSegments.length === 0) return [];
    const totalMs = Math.max(
      100,
      multiSegments.reduce(
        (sum, seg, i) =>
          sum + seg.durationSec * 1000 + (i < multiSegments.length - 1 ? seg.pauseAfterMs : 0),
        0
      )
    );
    let cursorMs = 0;
    return multiSegments.map((seg, i) => {
      const segMs = seg.durationSec * 1000;
      const startRatio = cursorMs / totalMs;
      const endRatio = (cursorMs + segMs) / totalMs;
      const gapMs = i < multiSegments.length - 1 ? seg.pauseAfterMs : 0;
      cursorMs += segMs + gapMs;
      return {
        index: i,
        label: seg.label || `#${i + 1}`,
        color: seg.color,
        startRatio,
        endRatio,
        widthPct: Math.max(0, (endRatio - startRatio) * 100),
        leftPct: startRatio * 100,
      };
    });
  }, [multiSegments]);

  // Build high-density symmetrical waveform bars
  const bars = useMemo(() => {
    if (multiSegments && multiSegments.length > 0) {
      const list: Array<{
        height: number;
        color: SpeakerColor;
        ratioStart: number;
        ratioEnd: number;
        isGap?: boolean;
      }> = [];
      const totalMs = Math.max(
        100,
        multiSegments.reduce(
          (sum, seg, i) =>
            sum + seg.durationSec * 1000 + (i < multiSegments.length - 1 ? seg.pauseAfterMs : 0),
          0
        )
      );
      const targetTotalBars = Math.min(108, Math.max(64, multiSegments.length * 18));
      let cursorMs = 0;

      multiSegments.forEach((seg, sIdx) => {
        const rawPeaks =
          seg.peaks && seg.peaks.length > 0
            ? seg.peaks
            : audioEngine.generateDeterministicPeaks(`${audioId}_${sIdx}`, 24);
        const segBarCount = Math.max(
          6,
          Math.round(((seg.durationSec * 1000) / totalMs) * targetTotalBars)
        );
        const resampled = audioEngine.resamplePeaks(rawPeaks, segBarCount);
        const segMs = seg.durationSec * 1000;

        for (let b = 0; b < segBarCount; b++) {
          const barStart = (cursorMs + (b / segBarCount) * segMs) / totalMs;
          const barEnd = (cursorMs + ((b + 1) / segBarCount) * segMs) / totalMs;
          list.push({
            height: resampled[b] ?? 0.45,
            color: seg.color,
            ratioStart: barStart,
            ratioEnd: barEnd,
          });
        }
        cursorMs += segMs;

        if (sIdx < multiSegments.length - 1 && seg.pauseAfterMs > 0) {
          const gapCount = Math.max(1, Math.round(((seg.pauseAfterMs) / totalMs) * targetTotalBars));
          for (let g = 0; g < gapCount; g++) {
            const gStart = (cursorMs + (g / gapCount) * seg.pauseAfterMs) / totalMs;
            const gEnd = (cursorMs + ((g + 1) / gapCount) * seg.pauseAfterMs) / totalMs;
            list.push({
              height: 0.08,
              color: seg.color,
              ratioStart: gStart,
              ratioEnd: gEnd,
              isGap: true,
            });
          }
          cursorMs += seg.pauseAfterMs;
        }
      });
      return list;
    }

    const highRes = audioEngine.getWaveformPeaksForAudio(audioId, 76, peaks);
    return highRes.map((h, i) => ({
      height: h,
      color: speakerColor,
      ratioStart: i / highRes.length,
      ratioEnd: (i + 1) / highRes.length,
      isGap: false,
    }));
  }, [multiSegments, peaks, audioId, speakerColor]);

  // Adaptive time ruler ticks
  const rulerTicks = useMemo(() => {
    const tickCount = Math.min(14, Math.max(4, Math.round(5 * (zoom / 100))));
    const list: Array<{ ratio: number; label: string }> = [];
    for (let i = 0; i <= tickCount; i++) {
      const r = i / tickCount;
      list.push({
        ratio: r,
        label: formatClock(r * safeDuration),
      });
    }
    return list;
  }, [zoom, safeDuration]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    playStartReturnRef.current = effectiveStart;
    playLimitRef.current = effectiveEnd;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }, [audioId]);

  // Clamp playhead ONLY when trim bounds themselves change
  useEffect(() => {
    const prev = prevEffectiveBoundsRef.current;
    if (prev.start === effectiveStart && prev.end === effectiveEnd) return;
    prevEffectiveBoundsRef.current = { start: effectiveStart, end: effectiveEnd };
    playStartReturnRef.current = effectiveStart;
    playLimitRef.current = effectiveEnd;
    if (!isPlaying && !isScrubbing) {
      setCurrentTime((curr) => {
        if (curr < effectiveStart || curr > effectiveEnd) {
          return effectiveStart;
        }
        return curr;
      });
    }
  }, [effectiveStart, effectiveEnd, isPlaying, isScrubbing]);

  // Smooth 60fps playhead & exact limit / loop handling while playing
  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let rafId = 0;

    const tick = () => {
      const el = audioRef.current;
      if (!el || el.paused) return;
      const limit = Math.min(safeDuration, playLimitRef.current);
      if (el.currentTime >= limit - 0.015) {
        if (isLoopingRef.current) {
          const loopStart = Math.max(0, Math.min(limit - 0.05, playStartReturnRef.current));
          el.currentTime = loopStart;
          setCurrentTime(loopStart);
        } else {
          el.pause();
          const resetTo = playStartReturnRef.current;
          el.currentTime = resetTo;
          setCurrentTime(resetTo);
          setIsPlaying(false);
          return;
        }
      } else {
        setCurrentTime(el.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isScrubbing, safeDuration]);

  // Handle trim/cut handles drag
  useEffect(() => {
    if (!draggingHandle) return;

    const handlePointerMove = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(ratio * safeDuration * 100) / 100;

      if (draggingHandle === 'cut-start' || draggingHandle === 'cut-end') {
        const sel = selectionRef.current;
        if (!sel) return;
        if (draggingHandle === 'cut-start') {
          const nextStart = Math.max(0, Math.min(sel.endSec - 0.1, sec));
          sel.onChange(nextStart, sel.endSec);
        } else {
          const nextEnd = Math.min(safeDuration, Math.max(sel.startSec + 0.1, sec));
          sel.onChange(sel.startSec, nextEnd);
        }
        return;
      }

      const emit = onChangeTrimRef.current;
      if (!emit) return;

      if (draggingHandle === 'start') {
        const nextStart = Math.max(0, Math.min(localTrimRef.current.end - 0.1, sec));
        const next = { start: nextStart, end: localTrimRef.current.end };
        localTrimRef.current = next;
        setLocalTrim(next);
        emit(next.start, next.end);
      } else {
        const nextEnd = Math.min(safeDuration, Math.max(localTrimRef.current.start + 0.1, sec));
        const next = { start: localTrimRef.current.start, end: nextEnd };
        localTrimRef.current = next;
        setLocalTrim(next);
        emit(next.start, next.end);
      }
    };

    const handlePointerUp = () => {
      setDraggingHandle(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingHandle, safeDuration]);

  const ensureLoadedAndSeek = async (targetTimeSec: number) => {
    const el = audioRef.current;
    if (!el) return null;
    if (!el.src) {
      const url = await audioEngine.getAudioObjectUrl(audioId, safeDuration, engineVoice, fallbackText);
      el.src = url;
      el.playbackRate = playbackRate;
      el.volume = muted ? 0 : volume;
    }
    if (el.readyState < 1) {
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener('loadedmetadata', done);
          el.removeEventListener('error', done);
          resolve();
        };
        el.addEventListener('loadedmetadata', done, { once: true });
        el.addEventListener('error', done, { once: true });
        setTimeout(done, 500);
      });
    }
    const maxSeek = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.015 : safeDuration - 0.02;
    el.currentTime = Math.max(0, Math.min(Math.max(0, maxSeek), targetTimeSec));
    return el;
  };

  // External audition range trigger (e.g. Play Selected Cut Range or Preview Trimmed Clip)
  useEffect(() => {
    if (!auditionRequest) return;
    let cancelled = false;
    (async () => {
      const start = Math.max(0, Math.min(safeDuration - 0.1, auditionRequest.startSec));
      const end = Math.max(start + 0.05, Math.min(safeDuration, auditionRequest.endSec));
      playStartReturnRef.current = start;
      playLimitRef.current = end;
      setCurrentTime(start);
      try {
        const el = await ensureLoadedAndSeek(start);
        if (cancelled || !el) return;
        registerPlayingAudio(el);
        await el.play();
        if (!cancelled) setIsPlaying(true);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auditionRequest?.nonce]);

  const getSecFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * safeDuration * 100) / 100;
  };

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      // Freeze playhead at exact current position!
      const exactPausedTime = Number.isFinite(el.currentTime) ? el.currentTime : currentTime;
      el.pause();
      setCurrentTime(exactPausedTime);
      setIsPlaying(false);
      return;
    }

    try {
      // Resume directly from wherever the playhead cursor is currently positioned
      const limit =
        currentTime >= effectiveEnd - 0.02 && currentTime < safeDuration - 0.04
          ? safeDuration
          : effectiveEnd;
      const startAt =
        currentTime >= limit - 0.04 || currentTime < 0 ? effectiveStart : currentTime;
      playStartReturnRef.current = effectiveStart;
      playLimitRef.current = startAt >= effectiveEnd - 0.02 ? safeDuration : effectiveEnd;

      await ensureLoadedAndSeek(startAt);
      registerPlayingAudio(el);
      await el.play();
      setIsPlaying(true);
    } catch (err: unknown) {
      showToast(`خطا در پخش صوت: ${(err as Error).message}`, 'error');
      setIsPlaying(false);
    }
  };

  const seekToPosition = async (targetSec: number, shouldPlay: boolean) => {
    const clamped = Math.max(0, Math.min(safeDuration - 0.015, Math.round(targetSec * 100) / 100));
    playStartReturnRef.current = effectiveStart;
    playLimitRef.current = clamped >= effectiveEnd - 0.02 ? safeDuration : effectiveEnd;
    setCurrentTime(clamped);

    try {
      const el = audioRef.current;
      if (!el) return;
      if (shouldPlay || el.src) {
        await ensureLoadedAndSeek(clamped);
        if (shouldPlay) {
          registerPlayingAudio(el);
          await el.play();
          setIsPlaying(true);
        }
      }
    } catch {
      // ignore seek error
    }
  };
  const seekToPositionRef = useRef(seekToPosition);
  seekToPositionRef.current = seekToPosition;

  const jumpRelative = (deltaSec: number) => {
    void seekToPosition(currentTime + deltaSec, isPlaying);
  };

  const resetToStart = () => {
    const el = audioRef.current;
    if (el && isPlaying) {
      el.pause();
      setIsPlaying(false);
    }
    const target = Math.abs(currentTime - effectiveStart) < 0.05 ? 0 : effectiveStart;
    playStartReturnRef.current = effectiveStart;
    playLimitRef.current = effectiveEnd;
    setCurrentTime(target);
    if (el && el.src && el.readyState >= 1) {
      el.currentTime = target;
    }
  };

  // Pointer cursor placement & scrubbing:
  // - When PAUSED: clicking/dragging places playhead cursor line and stays paused ready for Play
  // - When PLAYING: clicking/dragging scrubs & continues playing from new position
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMove = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(ratio * safeDuration * 100) / 100;
      scrubSecRef.current = sec;
      setCurrentTime(sec);
      setHoverSec(sec);
      const el = audioRef.current;
      if (el && el.readyState >= 1) {
        const maxSeek = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.015 : safeDuration - 0.02;
        el.currentTime = Math.max(0, Math.min(Math.max(0, maxSeek), sec));
      }
    };

    const handleUp = () => {
      setIsScrubbing(false);
      // Only continue playing if already playing; if paused, keep line pinned cleanly at clicked spot!
      void seekToPositionRef.current(scrubSecRef.current, wasPlayingOnScrubRef.current);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isScrubbing, safeDuration]);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingHandle || e.button !== 0) return;
    e.preventDefault();
    const sec = getSecFromClientX(e.clientX);
    scrubSecRef.current = sec;
    wasPlayingOnScrubRef.current = isPlayingRef.current;
    setCurrentTime(sec);
    setHoverSec(sec);
    setIsScrubbing(true);

    const el = audioRef.current;
    if (el && el.src && el.readyState >= 1) {
      const maxSeek = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.015 : safeDuration - 0.02;
      el.currentTime = Math.max(0, Math.min(Math.max(0, maxSeek), sec));
    }
  };

  const handleTrackKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 0.25 : 1.0;
      const delta = e.key === 'ArrowRight' ? step : -step;
      void seekToPosition(currentTime + delta, isPlaying);
    } else if (e.key === ' ') {
      e.preventDefault();
      void togglePlay();
    } else if (e.key === 'Home') {
      e.preventDefault();
      resetToStart();
    }
  };

  const handleRangeChange = (which: 'start' | 'end', val: number) => {
    const emit = onChangeTrimRef.current;
    if (!emit) return;
    if (which === 'start') {
      const nextStart = Math.max(0, Math.min(localTrimRef.current.end - 0.1, Math.round(val * 100) / 100));
      const next = { start: nextStart, end: localTrimRef.current.end };
      localTrimRef.current = next;
      setLocalTrim(next);
      emit(next.start, next.end);
    } else {
      const nextEnd = Math.min(safeDuration, Math.max(localTrimRef.current.start + 0.1, Math.round(val * 100) / 100));
      const next = { start: localTrimRef.current.start, end: nextEnd };
      localTrimRef.current = next;
      setLocalTrim(next);
      emit(next.start, next.end);
    }
  };

  const hoverSpeakerLabel = useMemo(() => {
    if (hoverSec === null || segmentSpans.length === 0) return null;
    const r = hoverSec / safeDuration;
    const found = segmentSpans.find((s) => r >= s.startRatio && r <= s.endRatio);
    return found?.label || null;
  }, [hoverSec, safeDuration, segmentSpans]);

  const startRatio = effectiveStart / safeDuration;
  const endRatio = effectiveEnd / safeDuration;
  const playRatio = Math.min(1, Math.max(0, currentTime / safeDuration));
  const hasTrim = !multiSegments && (effectiveStart > 0.01 || effectiveEnd < safeDuration - 0.01 || trimOpen);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="rounded-xl border border-[#1d283f] bg-[#070b13] p-3 shadow-inner select-none"
    >
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (!el || isScrubbing) return;
          const limit = Math.min(safeDuration, playLimitRef.current);
          if (el.currentTime >= limit - 0.015) {
            if (isLoopingRef.current) {
              const loopStart = Math.max(0, Math.min(limit - 0.05, playStartReturnRef.current));
              el.currentTime = loopStart;
              setCurrentTime(loopStart);
            } else {
              el.pause();
              const resetTo = playStartReturnRef.current;
              el.currentTime = resetTo;
              setCurrentTime(resetTo);
              setIsPlaying(false);
            }
            return;
          }
          setCurrentTime(el.currentTime);
        }}
        onPause={() => {
          if (!isScrubbing && audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setIsPlaying(false);
          }
        }}
        onEnded={() => {
          if (isLoopingRef.current && audioRef.current) {
            const loopStart = Math.max(0, Math.min(safeDuration - 0.05, playStartReturnRef.current));
            audioRef.current.currentTime = loopStart;
            setCurrentTime(loopStart);
            void audioRef.current.play().catch(() => setIsPlaying(false));
          } else {
            setIsPlaying(false);
            setCurrentTime(playStartReturnRef.current);
          }
        }}
        className="hidden"
      />

      {/* Top Studio Transport & Precision Toolbar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#141f35] pb-2">
        {/* Left/Right depending on RTL: Transport Buttons + Digital Timecode */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? 'توقف در همین نقطه' : 'پخش از موقعیت مکان‌نما'}
            aria-label={isPlaying ? 'توقف پخش' : 'پخش صوت'}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-md transition-transform active:scale-95 ${palette.playBtn}`}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-[-1px]" />}
          </button>

          <button
            type="button"
            onClick={resetToStart}
            title="بازگشت به ابتدا"
            aria-label="بازگشت به ابتدا"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#1d2b46] bg-[#0f172a] text-slate-300 transition-colors hover:border-sky-400/60 hover:text-white"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => jumpRelative(-2)}
            title="۲ ثانیه به عقب"
            aria-label="۲ ثانیه به عقب"
            className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-[#1d2b46] bg-[#0f172a] px-1.5 font-mono text-[10px] text-slate-300 transition-colors hover:border-sky-400/60 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            <span>2s</span>
          </button>

          <button
            type="button"
            onClick={() => jumpRelative(2)}
            title="۲ ثانیه به جلو"
            aria-label="۲ ثانیه به جلو"
            className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-[#1d2b46] bg-[#0f172a] px-1.5 font-mono text-[10px] text-slate-300 transition-colors hover:border-sky-400/60 hover:text-white"
          >
            <span>2s</span>
            <RotateCw className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={() => setIsLooping((l) => !l)}
            title="پخش تکرارشونده (Loop)"
            aria-label="تغییر حالت تکرار"
            aria-pressed={isLooping}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
              isLooping
                ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-300'
                : 'border-[#1d2b46] bg-[#0f172a] text-slate-400 hover:border-sky-400/50 hover:text-slate-200'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>

          <div
            className="mr-1 inline-flex items-center gap-1 rounded-lg border border-[#1a2642] bg-[#0b1220] px-2.5 py-1 font-mono text-[11px] tabular-nums"
            dir="ltr"
          >
            <span className="font-bold text-emerald-400">{formatClock(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatClock(safeDuration)}</span>
          </div>
        </div>

        {/* Studio Controls: Speed, Volume, Zoom, Extra Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Playback Speed */}
          <button
            type="button"
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEED_OPTIONS.length)}
            title="تغییر سرعت پخش"
            className="inline-flex h-7 items-center rounded-lg border border-[#1d2b46] bg-[#0f172a] px-2 font-mono text-[11px] font-semibold text-sky-300 transition-colors hover:border-sky-400/60 tabular-nums"
          >
            {playbackRate.toFixed(2).replace(/\.00$/, '.0')}x
          </button>

          {/* Volume Mute + Compact Slider */}
          <div className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#1d2b46] bg-[#0f172a] px-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'وصل صدا' : 'بی‌صدا'}
              aria-label={muted ? 'وصل صدا' : 'بی‌صدا'}
              className="text-slate-300 hover:text-white"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-slate-300" />
              )}
            </button>
            <input
              type="range"
              dir="ltr"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              aria-label="تنظیم بلندی صدا"
              className="w-12 accent-sky-400 cursor-pointer"
            />
          </div>

          {/* Zoom Controls */}
          {showZoom && (
            <div className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#1d2b46] bg-[#0f172a] px-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
              <button
                type="button"
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                disabled={zoomIdx === 0}
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[#1c2a4d] disabled:opacity-35"
                aria-label="کاهش زوم موج صدا"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <span className="w-9 text-center text-[10px]">{zoom}%</span>
              <button
                type="button"
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[#1c2a4d] disabled:opacity-35"
                aria-label="افزایش زوم موج صدا"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
            </div>
          )}

          {extraActions}
        </div>
      </div>

      {/* Professional Symmetrical DAW Waveform Timeline (always LTR) */}
      <div className="relative overflow-x-auto rounded-lg border border-[#16213a] bg-[#050810]" dir="ltr">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="نوار موج صدا — برای قرار دادن خط پخش کلیک کنید یا بکشید"
          aria-valuemin={0}
          aria-valuemax={safeDuration}
          aria-valuenow={Math.round(currentTime * 100) / 100}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={(e) => {
            if (!draggingHandle) {
              setHoverSec(getSecFromClientX(e.clientX));
            }
          }}
          onPointerLeave={() => {
            if (!isScrubbing) setHoverSec(null);
          }}
          onKeyDown={handleTrackKeyDown}
          className="relative flex flex-col cursor-crosshair focus:outline-none focus:ring-1 focus:ring-sky-400/60 touch-none"
          style={{ width: `${zoom}%`, minWidth: '100%' }}
        >
          {/* Time Ruler Strip */}
          <div className="pointer-events-none relative h-5 border-b border-[#141e33] bg-[#080d18]">
            {rulerTicks.map((tick, idx) => (
              <div
                key={idx}
                className="absolute bottom-0 flex flex-col items-center"
                style={{
                  left: `${tick.ratio * 100}%`,
                  transform:
                    idx === 0
                      ? 'translateX(0%)'
                      : idx === rulerTicks.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                }}
              >
                <span className="px-1 font-mono text-[9px] text-slate-500 tabular-nums leading-none mb-0.5">
                  {tick.label}
                </span>
                <span className="h-1.5 w-[1px] bg-slate-700" />
              </div>
            ))}
          </div>

          {/* Multi-speaker Segment Header Strip */}
          {segmentSpans.length > 0 && (
            <div className="pointer-events-none relative h-4 border-b border-[#121a2d] bg-[#070b15]">
              {segmentSpans.map((span) => {
                const pal = SPEAKER_PALETTE[span.color] || palette;
                return (
                  <div
                    key={span.index}
                    style={{ left: `${span.leftPct}%`, width: `${span.widthPct}%` }}
                    className="absolute inset-y-0 flex items-center overflow-hidden border-r border-slate-800/80 px-1.5"
                  >
                    <span className={`mr-1 h-1.5 w-1.5 shrink-0 rounded-full ${pal.dot}`} />
                    <span className={`truncate text-[9px] font-semibold ${pal.badgeText}`}>
                      {span.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main Symmetrical Mirrored Waveform Canvas Area */}
          <div className="relative h-20 px-1">
            {/* Subtle vertical acoustic grid lines */}
            <div className="pointer-events-none absolute inset-0">
              {rulerTicks.slice(1, -1).map((tick, idx) => (
                <div
                  key={idx}
                  className="absolute inset-y-0 w-[1px] bg-slate-800/40"
                  style={{ left: `${tick.ratio * 100}%` }}
                />
              ))}
              {/* Segment boundary dividers for Final Audio */}
              {segmentSpans.slice(1).map((span) => (
                <div
                  key={span.index}
                  className="absolute inset-y-0 w-[1px] border-l border-dashed border-slate-500/40"
                  style={{ left: `${span.leftPct}%` }}
                />
              ))}
              {/* 0dB Horizontal Center Hairline */}
              <div className="absolute inset-x-0 top-1/2 h-[1px] -translate-y-1/2 bg-slate-700/45" />
            </div>

            {/* Mirrored Symmetrical Bars */}
            <div className="pointer-events-none relative flex h-full items-center gap-[2px]">
              {bars.map((bar, i) => {
                const barMid = (bar.ratioStart + bar.ratioEnd) / 2;
                const inTrimRange = barMid >= startRatio - 0.01 && barMid <= endRatio + 0.01;
                const inCutZone =
                  selectionOverlay?.active &&
                  barMid >= selectionOverlay.startSec / safeDuration &&
                  barMid <= selectionOverlay.endSec / safeDuration;
                const isPlayed = barMid <= playRatio;
                const barPalette = SPEAKER_PALETTE[bar.color] || palette;

                const topHeightPct = bar.isGap ? 6 : Math.max(10, Math.round(bar.height * 46));
                const bottomHeightPct = bar.isGap ? 5 : Math.max(8, Math.round(bar.height * 38));

                const colorCls = inCutZone
                  ? isPlayed
                    ? 'bg-rose-400'
                    : 'bg-rose-500/55'
                  : bar.isGap
                    ? 'bg-slate-700/50'
                    : inTrimRange
                      ? isPlayed
                        ? `${barPalette.barActive} opacity-100 brightness-110`
                        : `${barPalette.barActive} opacity-45`
                      : `${barPalette.barInactive} opacity-25`;

                return (
                  <div
                    key={i}
                    className="flex h-full flex-1 min-w-[2px] flex-col items-center justify-center"
                  >
                    {/* Upper Positive Lobe */}
                    <div className="flex h-1/2 w-full items-end justify-center pb-[0.5px]">
                      <div
                        style={{ height: `${Math.min(96, topHeightPct * 2)}%` }}
                        className={`w-full rounded-t-[2px] transition-opacity duration-75 ${colorCls}`}
                      />
                    </div>
                    {/* Lower Mirrored Lobe */}
                    <div className="flex h-1/2 w-full items-start justify-center pt-[0.5px]">
                      <div
                        style={{ height: `${Math.min(88, bottomHeightPct * 2)}%` }}
                        className={`w-full rounded-b-[2px] transition-opacity duration-75 opacity-70 ${colorCls}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hover Cursor Guide & Floating Timestamp / Speaker Preview */}
            {hoverSec !== null && !draggingHandle && (
              <div
                className="pointer-events-none absolute inset-y-0 z-[11]"
                style={{ left: `${Math.min(100, Math.max(0, (hoverSec / safeDuration) * 100))}%` }}
              >
                <div className="h-full w-[1px] bg-sky-300/65" />
                <span className="absolute top-1 -translate-x-1/2 rounded border border-sky-400/35 bg-slate-950/95 px-1.5 py-0.5 font-mono text-[10px] text-sky-200 shadow-lg whitespace-nowrap">
                  {hoverSpeakerLabel ? `${hoverSpeakerLabel} • ` : ''}
                  {formatClock(hoverSec)}
                </span>
              </div>
            )}

            {/* Permanent Glowing Playhead Cursor Line */}
            <div
              className="pointer-events-none absolute inset-y-0 z-[14] -translate-x-1/2"
              style={{ left: `${playRatio * 100}%` }}
            >
              <div className="mx-auto h-full w-[2px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)]" />
              <span className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border border-slate-950 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              <span className="absolute -bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white" />
            </div>

            {/* Interactive Cut/Edit Selection Overlay (Final Audio middle-cut mode) */}
            {selectionOverlay?.active && (
              <>
                <div
                  className="pointer-events-none absolute inset-y-0 z-[6] border-x border-rose-400/75 bg-rose-500/15"
                  style={{
                    left: `${(selectionOverlay.startSec / safeDuration) * 100}%`,
                    width: `${Math.max(1, ((selectionOverlay.endSec - selectionOverlay.startSec) / safeDuration) * 100)}%`,
                  }}
                />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="شروع انتخاب برش"
                  aria-valuemin={0}
                  aria-valuemax={selectionOverlay.endSec}
                  aria-valuenow={selectionOverlay.startSec}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('cut-start');
                  }}
                  style={{ left: `${(selectionOverlay.startSec / safeDuration) * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-2 flex w-4 cursor-ew-resize items-center justify-center touch-none"
                >
                  <span className="h-full w-[3px] rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.9)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-slate-900 bg-rose-400 shadow" />
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="پایان انتخاب برش"
                  aria-valuemin={selectionOverlay.startSec}
                  aria-valuemax={safeDuration}
                  aria-valuenow={selectionOverlay.endSec}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('cut-end');
                  }}
                  style={{ left: `${(selectionOverlay.endSec / safeDuration) * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-2 flex w-4 cursor-ew-resize items-center justify-center touch-none"
                >
                  <span className="h-full w-[3px] rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.9)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-slate-900 bg-amber-300 shadow" />
                </div>
              </>
            )}

            {/* Interactive Pointer-Draggable Trim Handles directly on Waveform */}
            {hasTrim && onChangeTrim && (
              <>
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="شروع برش"
                  aria-valuemin={0}
                  aria-valuemax={effectiveEnd}
                  aria-valuenow={effectiveStart}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('start');
                  }}
                  style={{ left: `${startRatio * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-2 flex w-4 cursor-ew-resize items-center justify-center touch-none"
                >
                  <span className="h-full w-[3px] rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.9)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-slate-900 bg-fuchsia-400 shadow" />
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="پایان برش"
                  aria-valuemin={effectiveStart}
                  aria-valuemax={safeDuration}
                  aria-valuenow={effectiveEnd}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('end');
                  }}
                  style={{ left: `${endRatio * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-2 flex w-4 cursor-ew-resize items-center justify-center touch-none"
                >
                  <span className="h-full w-[3px] rounded-full bg-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.9)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-slate-900 bg-sky-300 shadow" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Trim / Cut Bounds Readout Strip */}
      {(hasTrim || selectionOverlay?.active) && (
        <div className="mt-1.5 flex items-center justify-between px-1 font-mono text-[10px] tabular-nums">
          {hasTrim ? (
            <>
              <span className="text-fuchsia-300">شروع: {formatClock(effectiveStart)}</span>
              <span className="text-slate-400">
                مدت برش: {Math.max(0.1, effectiveEnd - effectiveStart).toFixed(2)}s
              </span>
              <span className="text-sky-300">پایان: {formatClock(effectiveEnd)}</span>
            </>
          ) : (
            <>
              <span className="text-rose-300">شروع انتخاب: {formatClock(selectionOverlay!.startSec)}</span>
              <span className="text-slate-400">
                بازهٔ انتخابی: {Math.max(0.1, selectionOverlay!.endSec - selectionOverlay!.startSec).toFixed(2)}s
              </span>
              <span className="text-amber-300">پایان انتخاب: {formatClock(selectionOverlay!.endSec)}</span>
            </>
          )}
        </div>
      )}

      {/* Smooth Continuous Trim Sliders (Clip Library Trim Mode) */}
      {trimOpen && onChangeTrim && !multiSegments && (
        <div className="mt-2.5 flex flex-wrap items-center gap-4 border-t border-[#141f35] pt-2.5 text-xs text-slate-300">
          <label className="flex flex-1 min-w-[170px] items-center gap-2">
            <span className="whitespace-nowrap">شروع برش:</span>
            <input
              type="range"
              dir="ltr"
              min={0}
              max={safeDuration}
              step={0.01}
              value={effectiveStart}
              onPointerDown={() => setSlidingRange(true)}
              onPointerUp={() => setSlidingRange(false)}
              onPointerCancel={() => setSlidingRange(false)}
              onBlur={() => setSlidingRange(false)}
              onChange={(e) => handleRangeChange('start', parseFloat(e.target.value))}
              className="flex-1 accent-fuchsia-500 cursor-pointer touch-none"
            />
            <span className="w-12 font-mono text-fuchsia-300 tabular-nums" dir="ltr">
              {effectiveStart.toFixed(2)}s
            </span>
          </label>

          <label className="flex flex-1 min-w-[170px] items-center gap-2">
            <span className="whitespace-nowrap">پایان برش:</span>
            <input
              type="range"
              dir="ltr"
              min={0}
              max={safeDuration}
              step={0.01}
              value={effectiveEnd}
              onPointerDown={() => setSlidingRange(true)}
              onPointerUp={() => setSlidingRange(false)}
              onPointerCancel={() => setSlidingRange(false)}
              onBlur={() => setSlidingRange(false)}
              onChange={(e) => handleRangeChange('end', parseFloat(e.target.value))}
              className="flex-1 accent-sky-400 cursor-pointer touch-none"
            />
            <span className="w-12 font-mono text-sky-300 tabular-nums" dir="ltr">
              {effectiveEnd.toFixed(2)}s
            </span>
          </label>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void seekToPosition(effectiveStart, true)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
            >
              <Play className="h-3 w-3" />
              <span>شنیدن بازه</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLocalTrim({ start: 0, end: safeDuration });
                onChangeTrim(0, safeDuration);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[#223254] bg-[#131d35] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-sky-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              <span>بازنشانی برش</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
