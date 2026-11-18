import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  voiceColorCss?: string;
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
  voiceColorCss?: string;
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

interface ComputedBar {
  topPct: number;
  bottomPct: number;
  unplayedCls: string;
  playedCls: string;
  colorVar?: string;
  barOpacityUnplayed?: number;
  barOpacityPlayed?: number;
}

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0, 0.75];
const ZOOM_STEPS = [100, 150, 200, 300, 400];

const WaveformBarsLayer = React.memo(function WaveformBarsLayer({
  bars,
  variant,
}: {
  bars: ComputedBar[];
  variant: 'unplayed' | 'played';
}) {
  return (
    <div className="pointer-events-none flex h-full items-center gap-[2px]">
      {bars.map((bar, i) => {
        const colorCls = variant === 'played' ? bar.playedCls : bar.unplayedCls;
        const barBg = bar.colorVar;
        const barOpacity = variant === 'played' ? bar.barOpacityPlayed : bar.barOpacityUnplayed;
        return (
          <div
            key={i}
            className="flex h-full flex-1 min-w-[2px] flex-col items-center justify-center"
          >
            <div className="flex h-1/2 w-full items-end justify-center pb-[0.5px]">
              <div
                style={{
                  height: `${bar.topPct}%`,
                  ...(barBg ? { backgroundColor: barBg, opacity: barOpacity } : {}),
                }}
                className={`w-full rounded-t-[2px] ${colorCls}`}
              />
            </div>
            <div className="flex h-1/2 w-full items-start justify-center pt-[0.5px]">
              <div
                style={{
                  height: `${bar.bottomPct}%`,
                  ...(barBg
                    ? {
                        backgroundColor: barBg,
                        opacity: barOpacity !== undefined ? barOpacity * 0.7 : undefined,
                      }
                    : {}),
                }}
                className={`w-full rounded-b-[2px] opacity-70 ${colorCls}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export const WaveformPlayer = React.memo(function WaveformPlayer({
  audioId,
  durationSec,
  engineVoice = 'fa-male-narrator-1',
  fallbackText = 'پیش نمایش صدا',
  speakerColor = 'purple',
  voiceColorCss,
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
  const playedClipRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
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

  const currentTimeRef = useRef(0);
  const lastDisplayTenthsRef = useRef(0);
  const localTrimRef = useRef(localTrim);
  localTrimRef.current = localTrim;
  const onChangeTrimRef = useRef(onChangeTrim);
  onChangeTrimRef.current = onChangeTrim;
  const selectionRef = useRef(selectionOverlay);
  selectionRef.current = selectionOverlay;

  const scrubSecRef = useRef(0);
  const wasPlayingOnScrubRef = useRef(false);
  const prevEffectiveBoundsRef = useRef({ start: propStart, end: propEnd });

  const syncPlayheadPosition = useCallback(
    (sec: number, forceDisplay = false) => {
      const clamped = Math.max(0, Math.min(safeDuration, sec));
      currentTimeRef.current = clamped;
      const ratio = clamped / safeDuration;
      const pct = (ratio * 100).toFixed(3);
      const rightInset = ((1 - ratio) * 100).toFixed(3);

      if (playheadRef.current) {
        playheadRef.current.style.left = `${pct}%`;
      }
      if (playedClipRef.current) {
        playedClipRef.current.style.clipPath = `inset(0 ${rightInset}% 0 0)`;
      }

      const tenths = Math.round(clamped * 10);
      if (forceDisplay || tenths !== lastDisplayTenthsRef.current) {
        lastDisplayTenthsRef.current = tenths;
        setDisplayTime(clamped);
      }
    },
    [safeDuration]
  );

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
        voiceColorCss: seg.voiceColorCss,
        startRatio,
        endRatio,
        widthPct: Math.max(0, (endRatio - startRatio) * 100),
        leftPct: startRatio * 100,
      };
    });
  }, [multiSegments]);

  // Build static bar heights + palette geometry once per waveform/speaker setup
  const rawBars = useMemo(() => {
    if (multiSegments && multiSegments.length > 0) {
      const list: Array<{
        height: number;
        color: SpeakerColor;
        voiceColorCss?: string;
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
            voiceColorCss: seg.voiceColorCss,
            ratioStart: barStart,
            ratioEnd: barEnd,
          });
        }
        cursorMs += segMs;

        if (sIdx < multiSegments.length - 1 && seg.pauseAfterMs > 0) {
          const gapCount = Math.max(1, Math.round((seg.pauseAfterMs / totalMs) * targetTotalBars));
          for (let g = 0; g < gapCount; g++) {
            const gStart = (cursorMs + (g / gapCount) * seg.pauseAfterMs) / totalMs;
            const gEnd = (cursorMs + ((g + 1) / gapCount) * seg.pauseAfterMs) / totalMs;
            list.push({
              height: 0.08,
              color: seg.color,
              voiceColorCss: seg.voiceColorCss,
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
      voiceColorCss,
      ratioStart: i / highRes.length,
      ratioEnd: (i + 1) / highRes.length,
      isGap: false,
    }));
  }, [multiSegments, peaks, audioId, speakerColor, voiceColorCss]);

  const startRatio = effectiveStart / safeDuration;
  const endRatio = effectiveEnd / safeDuration;
  const selActive = !!selectionOverlay?.active;
  const selStartRatio = selActive ? (selectionOverlay!.startSec / safeDuration) : -1;
  const selEndRatio = selActive ? (selectionOverlay!.endSec / safeDuration) : -1;

  // Precompute static bar visual classes only when bars/trim/cut-zone change (NOT on playback ticks!)
  const computedBars = useMemo<ComputedBar[]>(() => {
    return rawBars.map((bar) => {
      const barMid = (bar.ratioStart + bar.ratioEnd) / 2;
      const inTrimRange = barMid >= startRatio - 0.01 && barMid <= endRatio + 0.01;
      const inCutZone = selActive && barMid >= selStartRatio && barMid <= selEndRatio;
      const barPalette = SPEAKER_PALETTE[bar.color] || palette;
      const resolvedVar = bar.voiceColorCss || barPalette.cssVar;

      const topHeightPct = bar.isGap ? 6 : Math.max(10, Math.round(bar.height * 46));
      const bottomHeightPct = bar.isGap ? 5 : Math.max(8, Math.round(bar.height * 38));

      let unplayedCls = '';
      let playedCls = '';
      let colorVar: string | undefined;
      let barOpacityUnplayed: number | undefined;
      let barOpacityPlayed: number | undefined;

      if (inCutZone) {
        unplayedCls = 'bg-[var(--danger)]/45';
        playedCls = 'bg-[var(--danger)]';
      } else if (bar.isGap) {
        unplayedCls = 'bg-[var(--text-muted)]/35';
        playedCls = 'bg-[var(--text-muted)]/60';
      } else if (inTrimRange) {
        colorVar = resolvedVar;
        barOpacityUnplayed = 0.42;
        barOpacityPlayed = 1;
      } else {
        colorVar = resolvedVar;
        barOpacityUnplayed = 0.14;
        barOpacityPlayed = 0.22;
      }

      return {
        topPct: Math.min(96, topHeightPct * 2),
        bottomPct: Math.min(88, bottomHeightPct * 2),
        unplayedCls,
        playedCls,
        colorVar,
        barOpacityUnplayed,
        barOpacityPlayed,
      };
    });
  }, [rawBars, startRatio, endRatio, selActive, selStartRatio, selEndRatio, palette]);

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
    syncPlayheadPosition(0, true);
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
      const curr = currentTimeRef.current;
      if (curr < effectiveStart || curr > effectiveEnd) {
        syncPlayheadPosition(effectiveStart, true);
      }
    }
  }, [effectiveStart, effectiveEnd, isPlaying, isScrubbing, syncPlayheadPosition]);

  // 60fps zero-re-render DOM playhead & clipPath animation while playing
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
          syncPlayheadPosition(loopStart, true);
        } else {
          el.pause();
          const resetTo = playStartReturnRef.current;
          el.currentTime = resetTo;
          syncPlayheadPosition(resetTo, true);
          setIsPlaying(false);
          return;
        }
      } else {
        syncPlayheadPosition(el.currentTime, false);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isScrubbing, safeDuration, syncPlayheadPosition]);

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

  // External audition range trigger
  useEffect(() => {
    if (!auditionRequest) return;
    let cancelled = false;
    (async () => {
      const start = Math.max(0, Math.min(safeDuration - 0.1, auditionRequest.startSec));
      const end = Math.max(start + 0.05, Math.min(safeDuration, auditionRequest.endSec));
      playStartReturnRef.current = start;
      playLimitRef.current = end;
      syncPlayheadPosition(start, true);
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
      const exactPausedTime = Number.isFinite(el.currentTime) ? el.currentTime : currentTimeRef.current;
      el.pause();
      syncPlayheadPosition(exactPausedTime, true);
      setIsPlaying(false);
      return;
    }

    try {
      const curr = currentTimeRef.current;
      const limit =
        curr >= effectiveEnd - 0.02 && curr < safeDuration - 0.04
          ? safeDuration
          : effectiveEnd;
      const startAt = curr >= limit - 0.04 || curr < 0 ? effectiveStart : curr;
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
    syncPlayheadPosition(clamped, true);

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
    void seekToPosition(currentTimeRef.current + deltaSec, isPlaying);
  };

  const resetToStart = () => {
    const el = audioRef.current;
    if (el && isPlaying) {
      el.pause();
      setIsPlaying(false);
    }
    const target = Math.abs(currentTimeRef.current - effectiveStart) < 0.05 ? 0 : effectiveStart;
    playStartReturnRef.current = effectiveStart;
    playLimitRef.current = effectiveEnd;
    syncPlayheadPosition(target, true);
    if (el && el.src && el.readyState >= 1) {
      el.currentTime = target;
    }
  };

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
      syncPlayheadPosition(sec, true);
      setHoverSec(sec);
      const el = audioRef.current;
      if (el && el.readyState >= 1) {
        const maxSeek = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.015 : safeDuration - 0.02;
        el.currentTime = Math.max(0, Math.min(Math.max(0, maxSeek), sec));
      }
    };

    const handleUp = () => {
      setIsScrubbing(false);
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
  }, [isScrubbing, safeDuration, syncPlayheadPosition]);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingHandle || e.button !== 0) return;
    e.preventDefault();
    const sec = getSecFromClientX(e.clientX);
    scrubSecRef.current = sec;
    wasPlayingOnScrubRef.current = isPlayingRef.current;
    syncPlayheadPosition(sec, true);
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
      void seekToPosition(currentTimeRef.current + delta, isPlaying);
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

  const handleHandleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    kind: 'start' | 'end' | 'cut-start' | 'cut-end'
  ) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 0.2 : 0.05;
    const delta = e.key === 'ArrowRight' ? step : -step;

    if (kind === 'cut-start' || kind === 'cut-end') {
      const sel = selectionRef.current;
      if (!sel) return;
      if (kind === 'cut-start') {
        const next = Math.max(0, Math.min(sel.endSec - 0.1, Math.round((sel.startSec + delta) * 100) / 100));
        sel.onChange(next, sel.endSec);
      } else {
        const next = Math.min(safeDuration, Math.max(sel.startSec + 0.1, Math.round((sel.endSec + delta) * 100) / 100));
        sel.onChange(sel.startSec, next);
      }
      return;
    }

    handleRangeChange(
      kind,
      (kind === 'start' ? localTrimRef.current.start : localTrimRef.current.end) + delta
    );
  };

  const hoverSpeakerLabel = useMemo(() => {
    if (hoverSec === null || segmentSpans.length === 0) return null;
    const r = hoverSec / safeDuration;
    const found = segmentSpans.find((s) => r >= s.startRatio && r <= s.endRatio);
    return found?.label || null;
  }, [hoverSec, safeDuration, segmentSpans]);

  const initialRatio = Math.min(1, Math.max(0, displayTime / safeDuration));
  const hasTrim = !multiSegments && (effectiveStart > 0.01 || effectiveEnd < safeDuration - 0.01 || trimOpen);

  return (
    <div
      data-no-drag="true"
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="cursor-default rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5 select-none sm:p-4"
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
              syncPlayheadPosition(loopStart, true);
            } else {
              el.pause();
              const resetTo = playStartReturnRef.current;
              el.currentTime = resetTo;
              syncPlayheadPosition(resetTo, true);
              setIsPlaying(false);
            }
            return;
          }
          syncPlayheadPosition(el.currentTime, false);
        }}
        onPause={() => {
          if (!isScrubbing && audioRef.current) {
            syncPlayheadPosition(audioRef.current.currentTime, true);
            setIsPlaying(false);
          }
        }}
        onEnded={() => {
          const resetTo = playStartReturnRef.current;
          if (isLoopingRef.current && audioRef.current) {
            const loopStart = Math.max(0, Math.min(safeDuration - 0.05, resetTo));
            audioRef.current.currentTime = loopStart;
            syncPlayheadPosition(loopStart, true);
            void audioRef.current.play().catch(() => setIsPlaying(false));
          } else {
            if (audioRef.current) audioRef.current.currentTime = resetTo;
            setIsPlaying(false);
            syncPlayheadPosition(resetTo, true);
          }
        }}
        className="hidden"
      />

      {/* Top Studio Transport & Precision Toolbar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        {/* Primary Transport + Digital Timecode */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? 'توقف در همین نقطه' : 'پخش از موقعیت مکان‌نما'}
            aria-label={isPlaying ? 'توقف پخش' : 'پخش صوت'}
            className={`btn-gold relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-95 sm:h-9 sm:w-9 ${
              isPlaying ? 'ring-4 ring-[var(--focus-ring)]' : ''
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[-1px]" />}
          </button>

          <div className="flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-transparent p-0.5">
            <button
              type="button"
              onClick={resetToStart}
              title="بازگشت به ابتدا"
              aria-label="بازگشت به ابتدا"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => jumpRelative(-2)}
              title="۲ ثانیه به عقب"
              aria-label="۲ ثانیه به عقب"
              className="inline-flex h-8 items-center gap-0.5 rounded-lg px-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <RotateCcw className="h-3 w-3" />
              <span>2s</span>
            </button>

            <button
              type="button"
              onClick={() => jumpRelative(2)}
              title="۲ ثانیه به جلو"
              aria-label="۲ ثانیه به جلو"
              className="inline-flex h-8 items-center gap-0.5 rounded-lg px-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                isLooping
                  ? 'border border-[var(--border-strong)] bg-[var(--bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Digital Timecode Console */}
          <div
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 font-mono text-xs tabular-nums"
            dir="ltr"
          >
            {isPlaying && (
              <span className="flex h-2.5 items-end gap-[1.5px]" aria-hidden="true">
                <span className="h-2.5 w-[2px] rounded-full bg-[var(--ui-accent)] animate-eq-1" />
                <span className="h-2.5 w-[2px] rounded-full bg-[var(--text-primary)] animate-eq-2" />
                <span className="h-2.5 w-[2px] rounded-full bg-[var(--text-muted)] animate-eq-3" />
              </span>
            )}
            <span className="font-semibold text-[var(--text-primary)]">{formatClock(displayTime)}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-secondary)]">{formatClock(safeDuration)}</span>
          </div>
        </div>

        {/* Studio Secondary Controls: Speed, Volume, Zoom, Extra Actions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEED_OPTIONS.length)}
            title="تغییر سرعت پخش"
            className="btn-studio-secondary inline-flex h-8 items-center rounded-xl px-2.5 font-mono text-xs font-medium text-[var(--text-primary)] transition-colors tabular-nums"
          >
            {playbackRate.toFixed(2).replace(/\.00$/, '.0')}x
          </button>

          <div className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-transparent px-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'وصل صدا' : 'بی‌صدا'}
              aria-label={muted ? 'وصل صدا' : 'بی‌صدا'}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-3.5 w-3.5 text-[var(--danger)]" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
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
              style={{
                background: `linear-gradient(to right, var(--ui-accent) ${Math.round((muted ? 0 : volume) * 100)}%, var(--border-subtle) ${Math.round((muted ? 0 : volume) * 100)}%)`,
              }}
              aria-label="تنظیم بلندی صدا"
              className="studio-range hidden w-12 cursor-pointer sm:block"
            />
          </div>

          {showZoom && (
            <div className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-transparent px-1.5 font-mono text-xs text-[var(--text-secondary)] tabular-nums">
              <button
                type="button"
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                disabled={zoomIdx === 0}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
                aria-label="کاهش زوم موج صدا"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <span className="w-11 text-center text-xs">{zoom}%</span>
              <button
                type="button"
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
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
      <div className="relative overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]" dir="ltr">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="نوار موج صدا — برای قرار دادن خط پخش کلیک کنید یا بکشید"
          aria-valuemin={0}
          aria-valuemax={safeDuration}
          aria-valuenow={Math.round(displayTime * 100) / 100}
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
          className="relative flex flex-col cursor-crosshair focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] touch-none"
          style={{ width: `${zoom}%`, minWidth: '100%' }}
        >
          {/* Time Ruler Strip */}
          <div className="pointer-events-none relative h-6 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60">
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
                <span className="mb-0.5 px-1 font-mono text-xs leading-none text-[var(--text-muted)] tabular-nums">
                  {tick.label}
                </span>
                <span className="h-1.5 w-[1px] bg-[var(--border-subtle)]" />
              </div>
            ))}
          </div>

          {/* Multi-speaker Segment Header Strip */}
          {segmentSpans.length > 0 && (
            <div className="pointer-events-none relative h-5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30">
              {segmentSpans.map((span) => {
                const pal = SPEAKER_PALETTE[span.color] || palette;
                const segColor = span.voiceColorCss || pal.cssVar;
                return (
                  <div
                    key={span.index}
                    style={{ left: `${span.leftPct}%`, width: `${span.widthPct}%` }}
                    className="absolute inset-y-0 flex items-center overflow-hidden border-r border-[var(--border-subtle)] px-1.5"
                  >
                    <span
                      style={{ backgroundColor: segColor }}
                      className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    />
                    <span
                      style={{ color: segColor }}
                      className="truncate text-xs font-medium"
                    >
                      {span.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main Symmetrical Mirrored Waveform Canvas Area */}
          <div className="relative h-20 px-1 sm:h-22">
            {/* Subtle acoustic reference grid */}
            <div className="pointer-events-none absolute inset-0">
              {rulerTicks.slice(1, -1).map((tick, idx) => (
                <div
                  key={idx}
                  className="absolute inset-y-0 w-[1px] bg-[var(--border-subtle)] opacity-60"
                  style={{ left: `${tick.ratio * 100}%` }}
                />
              ))}
              {segmentSpans.slice(1).map((span) => (
                <div
                  key={span.index}
                  className="absolute inset-y-0 w-[1px] border-l border-dashed border-[var(--text-muted)]/45"
                  style={{ left: `${span.leftPct}%` }}
                />
              ))}
              <div className="absolute inset-x-0 top-1/4 h-[1px] bg-[var(--border-subtle)] opacity-45" />
              <div className="absolute inset-x-0 top-1/2 h-[1px] -translate-y-1/2 bg-[var(--border-subtle)]" />
              <div className="absolute inset-x-0 top-3/4 h-[1px] bg-[var(--border-subtle)] opacity-45" />
            </div>

            {/* Base Unplayed Layer (Memoized — zero re-render on playback) */}
            <WaveformBarsLayer bars={computedBars} variant="unplayed" />

            {/* Played Progress Layer (Clipped via DOM ref at 60fps with zero bar re-renders) */}
            <div
              ref={playedClipRef}
              className="pointer-events-none absolute inset-0 px-1"
              style={{ clipPath: `inset(0 ${((1 - initialRatio) * 100).toFixed(3)}% 0 0)` }}
            >
              <WaveformBarsLayer bars={computedBars} variant="played" />
            </div>

            {/* Hover Cursor Guide & Floating Timestamp / Speaker Preview */}
            {hoverSec !== null && !draggingHandle && (
              <div
                className="pointer-events-none absolute inset-y-0 z-[11]"
                style={{ left: `${Math.min(100, Math.max(0, (hoverSec / safeDuration) * 100))}%` }}
              >
                <div className="h-full w-[1px] bg-[var(--ui-accent)]/75" />
                <span className="absolute top-1 -translate-x-1/2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)] shadow-lg whitespace-nowrap">
                  {hoverSpeakerLabel ? `${hoverSpeakerLabel} · ` : ''}
                  {formatClock(hoverSec)}
                </span>
              </div>
            )}

            {/* Permanent Glowing Playhead Cursor Line (Neutral-Light) */}
            <div
              ref={playheadRef}
              className="pointer-events-none absolute inset-y-0 z-[14] -translate-x-1/2"
              style={{ left: `${(initialRatio * 100).toFixed(3)}%` }}
            >
              <div className="mx-auto h-full w-[2px] bg-[var(--text-primary)] shadow-[0_0_10px_rgba(233,237,245,0.45)]" />
              <span className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border border-[var(--bg-base)] bg-[var(--ui-accent)] shadow-[0_0_8px_rgba(233,237,245,0.35)]" />
              <span className="absolute -bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--text-primary)]" />
            </div>

            {/* Interactive Cut/Edit Selection Overlay */}
            {selectionOverlay?.active && (
              <>
                <div
                  className="pointer-events-none absolute inset-y-0 z-[6] border-x border-[var(--danger)]/75 bg-[var(--danger-muted)]"
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
                  onKeyDown={(e) => handleHandleKeyDown(e, 'cut-start')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('cut-start');
                  }}
                  style={{ left: `${(selectionOverlay.startSec / safeDuration) * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-3 flex w-6 cursor-ew-resize items-center justify-center touch-none focus:outline-none sm:-ml-2 sm:w-4"
                >
                  <span className="h-full w-[3px] rounded-full bg-[var(--danger)] shadow-[0_0_8px_var(--danger-border)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg-base)] bg-[var(--danger)] shadow" />
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="پایان انتخاب برش"
                  aria-valuemin={selectionOverlay.startSec}
                  aria-valuemax={safeDuration}
                  aria-valuenow={selectionOverlay.endSec}
                  onKeyDown={(e) => handleHandleKeyDown(e, 'cut-end')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('cut-end');
                  }}
                  style={{ left: `${(selectionOverlay.endSec / safeDuration) * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-3 flex w-6 cursor-ew-resize items-center justify-center touch-none focus:outline-none sm:-ml-2 sm:w-4"
                >
                  <span className="h-full w-[3px] rounded-full bg-[var(--ui-accent)] shadow-[0_0_8px_rgba(233,237,245,0.4)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg-base)] bg-[var(--ui-accent)] shadow" />
                </div>
              </>
            )}

            {/* Interactive Pointer-Draggable Trim Handles */}
            {hasTrim && onChangeTrim && (
              <>
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="شروع برش"
                  aria-valuemin={0}
                  aria-valuemax={effectiveEnd}
                  aria-valuenow={effectiveStart}
                  onKeyDown={(e) => handleHandleKeyDown(e, 'start')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('start');
                  }}
                  style={{ left: `${startRatio * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-3 flex w-6 cursor-ew-resize items-center justify-center touch-none focus:outline-none sm:-ml-2 sm:w-4"
                >
                  <span className="h-full w-[3px] rounded-full bg-[var(--ui-accent)] shadow-[0_0_8px_rgba(233,237,245,0.4)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg-base)] bg-[var(--ui-accent)] shadow" />
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="پایان برش"
                  aria-valuemin={effectiveStart}
                  aria-valuemax={safeDuration}
                  aria-valuenow={effectiveEnd}
                  onKeyDown={(e) => handleHandleKeyDown(e, 'end')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDraggingHandle('end');
                  }}
                  style={{ left: `${endRatio * 100}%` }}
                  className="group absolute inset-y-0 z-[15] -ml-3 flex w-6 cursor-ew-resize items-center justify-center touch-none focus:outline-none sm:-ml-2 sm:w-4"
                >
                  <span className="h-full w-[3px] rounded-full bg-[var(--text-primary)] shadow-[0_0_8px_var(--playhead-glow)] transition-transform group-hover:scale-x-125" />
                  <span className="absolute -top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg-base)] bg-[var(--text-primary)] shadow" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Trim / Cut Bounds Readout Strip */}
      {(hasTrim || selectionOverlay?.active) && (
        <div className="mt-2 flex items-center justify-between px-1 font-mono text-xs tabular-nums">
          {hasTrim ? (
            <>
              <span className="text-[var(--text-secondary)]">شروع: {formatClock(effectiveStart)}</span>
              <span className="text-[var(--text-secondary)]">
                مدت برش: {Math.max(0.1, effectiveEnd - effectiveStart).toFixed(2)}s
              </span>
              <span className="text-[var(--text-primary)]">پایان: {formatClock(effectiveEnd)}</span>
            </>
          ) : (
            <>
              <span className="text-[var(--danger)]">شروع انتخاب: {formatClock(selectionOverlay!.startSec)}</span>
              <span className="text-[var(--text-secondary)]">
                بازهٔ انتخابی: {Math.max(0.1, selectionOverlay!.endSec - selectionOverlay!.startSec).toFixed(2)}s
              </span>
              <span className="text-[var(--text-primary)]">پایان انتخاب: {formatClock(selectionOverlay!.endSec)}</span>
            </>
          )}
        </div>
      )}

      {/* Smooth Continuous Trim Sliders (Clip Library Trim Mode) */}
      {trimOpen && onChangeTrim && !multiSegments && (
        <div className="mt-2.5 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <label className="flex flex-1 min-w-[170px] items-center gap-2.5">
            <span className="whitespace-nowrap font-normal text-[var(--text-secondary)]">شروع برش:</span>
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
              style={{
                background: `linear-gradient(to right, var(--ui-accent) ${Math.round(startRatio * 100)}%, var(--border-subtle) ${Math.round(startRatio * 100)}%)`,
              }}
              className="studio-range flex-1 cursor-pointer touch-none"
            />
            <span className="w-12 font-mono text-xs text-[var(--text-primary)] tabular-nums" dir="ltr">
              {effectiveStart.toFixed(2)}s
            </span>
          </label>

          <label className="flex flex-1 min-w-[170px] items-center gap-2.5">
            <span className="whitespace-nowrap font-normal text-[var(--text-secondary)]">پایان برش:</span>
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
              style={{
                background: `linear-gradient(to right, var(--ui-accent) ${Math.round(endRatio * 100)}%, var(--border-subtle) ${Math.round(endRatio * 100)}%)`,
              }}
              className="studio-range flex-1 cursor-pointer touch-none"
            />
            <span className="w-12 font-mono text-xs text-[var(--text-primary)] tabular-nums" dir="ltr">
              {effectiveEnd.toFixed(2)}s
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void seekToPosition(effectiveStart, true)}
              className="btn-studio-secondary inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-xl px-3 text-xs font-medium transition-colors sm:flex-initial"
            >
              <Play className="h-3 w-3 text-[var(--ui-accent)]" />
              <span>شنیدن بازه</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLocalTrim({ start: 0, end: safeDuration });
                onChangeTrim(0, safeDuration);
              }}
              className="btn-studio-secondary inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-xl px-3 text-xs font-medium transition-colors sm:flex-initial"
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
