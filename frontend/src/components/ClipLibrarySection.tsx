import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Download,
  GripVertical,
  Loader2,
  Music,
  RefreshCw,
  Scissors,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { resolveVoiceVisualTheme } from '../config/config';
import { computeClipDropIndex, useTts } from '../context/TtsContext';
import type { Clip } from '../types/tts';
import * as audioEngine from '../utils/audioEngine';
import { WaveformPlayer } from './WaveformPlayer';

const INTERACTIVE_DRAG_BLOCK_SELECTOR =
  'button, input, select, option, textarea, a, label, [data-no-drag="true"]';

export const ClipLibrarySection = React.memo(function ClipLibrarySection() {
  const {
    voices,
    clips,
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
    showConfirm,
    showToast,
  } = useTts();

  const [trimOpenIds, setTrimOpenIds] = useState<Record<string, boolean>>({});
  const [changingVoiceIds, setChangingVoiceIds] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: 'top' | 'bottom' } | null>(null);

  const draggedIdRef = useRef<string | null>(null);
  const allowCardDragRef = useRef<boolean>(true);

  const toggleTrim = (id: string) => {
    setTrimOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleVoiceChange = async (clipId: string, newVoiceId: string) => {
    setChangingVoiceIds((prev) => ({ ...prev, [clipId]: true }));
    try {
      await changeClipVoice(clipId, newVoiceId);
    } finally {
      setChangingVoiceIds((prev) => ({ ...prev, [clipId]: false }));
    }
  };

  const handleClearAll = async () => {
    if (clips.length === 0) return;
    const ok = await showConfirm({
      title: 'پاک‌سازی کتابخانه',
      message: 'آیا از حذف تمام کلیپ‌های موجود در کتابخانه اطمینان دارید؟ این عمل غیرقابل بازگشت است.',
      confirmText: 'حذف همه',
      danger: true,
    });
    if (ok) clearAllClips();
  };

  const handleDeleteClip = async (clip: Clip) => {
    const ok = await showConfirm({
      title: 'حذف کلیپ',
      message: 'آیا از حذف این کلیپ از کتابخانه مطمئن هستید؟',
      confirmText: 'حذف',
      danger: true,
    });
    if (ok) removeClip(clip.id);
  };

  const handleDownloadClip = async (clip: Clip, idx: number) => {
    try {
      const objUrl = await audioEngine.getAudioObjectUrl(
        clip.audioId,
        clip.durationSec,
        clip.engineVoice,
        clip.text
      );
      const fileName = `clip-${String(idx + 1).padStart(2, '0')}-${clip.voiceName.replace(/\s+/g, '_')}.wav`;
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: unknown) {
      showToast(`خطا در دانلود صوت: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <section
      id="section-library"
      className="flex scroll-mt-20 flex-col gap-6"
      aria-labelledby="section-library-title"
    >
      {/* Calmer Section Header */}
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--ui-accent)]">
            <Music className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                id="section-library-title"
                className="text-lg font-bold tracking-tight text-[var(--text-primary)] sm:text-xl"
              >
                کتابخانه کلیپ‌های صوتی
              </h2>
              <span className="font-mono text-xs font-normal text-[var(--text-secondary)] tabular-nums">
                · {clips.length} کلیپ
              </span>
            </div>
            <p className="mt-1 text-xs font-normal text-[var(--text-secondary)] sm:text-[13px]">
              هر کلیپ را از هر قسمت کارت بکشید و رها کنید تا ترتیب و اولویت ادغام تغییر کند
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectAllClips(true)}
            className="btn-studio-secondary inline-flex h-9 flex-1 items-center justify-center rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out sm:flex-initial whitespace-nowrap shrink-0"
          >
            انتخاب همه
          </button>
          <button
            type="button"
            onClick={invertClipSelection}
            className="btn-studio-secondary inline-flex h-9 flex-1 items-center justify-center rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out sm:flex-initial whitespace-nowrap shrink-0"
          >
            معکوس
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clips.length === 0}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-transparent px-3.5 text-xs font-medium text-[var(--text-secondary)] transition-all duration-200 ease-out hover:border-[var(--danger-border)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            پاک‌سازی
          </button>
        </div>
      </div>

      {/* Clips List or Clean Empty State */}
      {clips.length === 0 ? (
        <div className="glass-card-calm flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <Music className="h-12 w-12 stroke-[1.3] text-[var(--text-muted)] opacity-55" />
          <p className="max-w-md text-xs font-normal leading-relaxed text-[var(--text-muted)] sm:text-sm">
            کتابخانه خالی است. پاراگراف‌ها را به ویس تبدیل کنید تا کلیپ‌های صوتی اینجا نمایش داده شوند.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <AnimatePresence initial={false}>
            {clips.map((clip, idx) => {
              const colorKey = clip.speakerColor || 'purple';
              const isTrimOpen = !!trimOpenIds[clip.id];
              const isChangingVoice = !!changingVoiceIds[clip.id];
              const isDragging = draggedId === clip.id;
              const dropTop = dragOver?.id === clip.id && dragOver.pos === 'top';
              const dropBottom = dragOver?.id === clip.id && dragOver.pos === 'bottom';
              const bounds = audioEngine.getEffectiveClipBounds(clip);

              const matchedVoice =
                voices.find((v) => v.name === clip.voiceName && v.engineVoice === clip.engineVoice) ||
                voices.find((v) => v.engineVoice === clip.engineVoice) ||
                voices[0];

              const voiceTheme = resolveVoiceVisualTheme(voices, {
                voiceId: matchedVoice?.id,
                voiceName: clip.voiceName,
                engineVoice: clip.engineVoice,
                fallbackColor: colorKey,
                fallbackIndex: idx,
              });

              return (
                <motion.div
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{
                    duration: 0.2,
                    delay: Math.min(idx * 0.035, 0.18),
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  key={clip.id}
                >
                  <div
                    draggable
                    onMouseDownCapture={(e) => {
                      const target = e.target as HTMLElement | null;
                      allowCardDragRef.current = !target?.closest(INTERACTIVE_DRAG_BLOCK_SELECTOR);
                    }}
                    onDragStart={(e) => {
                      const target = e.target as HTMLElement | null;
                      if (!allowCardDragRef.current || target?.closest(INTERACTIVE_DRAG_BLOCK_SELECTOR)) {
                        e.preventDefault();
                        return;
                      }
                      draggedIdRef.current = clip.id;
                      setDraggedId(clip.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', clip.id);
                    }}
                    onDragEnd={() => {
                      draggedIdRef.current = null;
                      allowCardDragRef.current = true;
                      setDraggedId(null);
                      setDragOver(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const activeSourceId = draggedIdRef.current || draggedId;
                      if (!activeSourceId || activeSourceId === clip.id) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos = e.clientY - rect.top > rect.height / 2 ? 'bottom' : 'top';
                      setDragOver((prev) =>
                        prev?.id === clip.id && prev.pos === pos ? prev : { id: clip.id, pos }
                      );
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setDragOver((prev) => (prev?.id === clip.id ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId = draggedIdRef.current || draggedId || e.dataTransfer.getData('text/plain');
                      draggedIdRef.current = null;
                      allowCardDragRef.current = true;
                      setDragOver(null);
                      setDraggedId(null);
                      if (!sourceId || sourceId === clip.id) return;
                      const fromIndex = clips.findIndex((c) => c.id === sourceId);
                      const toIndex = clips.findIndex((c) => c.id === clip.id);
                      if (fromIndex === -1 || toIndex === -1) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const isBottom = e.clientY - rect.top > rect.height / 2;
                      const targetIndex = computeClipDropIndex(fromIndex, toIndex, isBottom);
                      moveClipToIndex(sourceId, targetIndex);
                    }}
                    className={`glass-card-calm relative flex cursor-grab flex-col gap-4 overflow-hidden p-5 pr-6 transition-colors duration-200 hover:border-[var(--border-strong)] active:cursor-grabbing sm:p-6 sm:pr-7 ${
                      isDragging ? 'border-dashed border-[var(--border-strong)] opacity-45' : ''
                    } ${dropTop ? 'border-t-2 border-t-[var(--ui-accent)]' : ''} ${
                      dropBottom ? 'border-b-2 border-b-[var(--ui-accent)]' : ''
                    }`}
                  >
                    {/* Right-Side Speaker Identity Bar (RTL) */}
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: voiceTheme.cssVar }}
                      className="pointer-events-none absolute inset-y-0 right-0 w-1"
                    />

                    {/* Top Header */}
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                          title="برای تغییر ترتیب، کارت را بکشید و رها کنید"
                          aria-hidden="true"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>

                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={clip.selected}
                            onChange={() => toggleClipSelect(clip.id)}
                            className="h-4 w-4 cursor-pointer rounded accent-[var(--ui-accent)]"
                          />
                          <span className="font-mono text-xs font-bold text-[var(--text-primary)] tabular-nums">
                            #{idx + 1}
                          </span>
                        </label>

                        <span aria-hidden="true" className="text-[var(--text-muted)]">
                          ·
                        </span>

                        {/* Inline Speaker Selector */}
                        <div className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                          {isChangingVoice ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ui-accent)]" />
                          ) : (
                            <span
                              style={{ backgroundColor: voiceTheme.cssVar }}
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                            />
                          )}
                          <select
                            value={matchedVoice?.id || ''}
                            onChange={(e) => handleVoiceChange(clip.id, e.target.value)}
                            disabled={isChangingVoice}
                            aria-label="تغییر گوینده کلیپ"
                            title="تغییر گوینده و بازتولید صدا"
                            className="cursor-pointer rounded-lg border border-transparent bg-transparent py-0.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] focus:border-[var(--ui-accent)] focus:outline-none"
                          >
                            {voices.map((v) => (
                              <option key={v.id} value={v.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                                {v.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <span aria-hidden="true" className="text-[var(--text-muted)]">
                          ·
                        </span>

                        <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                          <Clock className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                          <span>{bounds.effectiveDuration.toFixed(1)}s</span>
                        </span>

                        <span aria-hidden="true" className="text-[var(--text-muted)]">
                          ·
                        </span>

                        <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
                          <span>مکث آخر ویس:</span>
                          <input
                            type="number"
                            min={0}
                            max={2000}
                            step={50}
                            value={clip.pauseAfterMs ?? 0}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              updateClipPause(clip.id, isNaN(val) ? 0 : val);
                            }}
                            className="w-12 bg-transparent text-center font-mono text-xs text-[var(--text-primary)] focus:outline-none tabular-nums"
                          />
                          <span className="font-mono text-xs text-[var(--text-muted)]">ms</span>
                        </label>
                      </div>

                      {/* Uniform Transparent-Bordered Actions */}
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleTrim(clip.id)}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0 ${
                            isTrimOpen
                              ? 'border-[var(--border-strong)] bg-[var(--bg-hover)] text-[var(--text-primary)]'
                              : 'btn-studio-secondary'
                          }`}
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          <span>ابزار برش (Trim)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => moveClip(clip.id, 'up')}
                          disabled={idx === 0}
                          title="انتقال به بالا"
                          aria-label="انتقال به بالا"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveClip(clip.id, 'down')}
                          disabled={idx === clips.length - 1}
                          title="انتقال به پایین"
                          aria-label="انتقال به پایین"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => resynthesizeClip(clip)}
                          title="ساخت دوباره با همان متن و صدا"
                          aria-label="ساخت دوباره"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadClip(clip, idx)}
                          title="دانلود فایل صوتی"
                          aria-label="دانلود فایل صوتی"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClip(clip)}
                          title="حذف کلیپ"
                          aria-label="حذف کلیپ"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-muted)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Text Content */}
                    <p className="text-xs font-normal leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                      {clip.preparedText || clip.text}
                    </p>

                    {/* Waveform Player */}
                    <WaveformPlayer
                      audioId={clip.audioId}
                      durationSec={clip.durationSec}
                      engineVoice={clip.engineVoice}
                      fallbackText={clip.text}
                      speakerColor={colorKey}
                      voiceColorCss={voiceTheme.cssVar}
                      peaks={clip.waveformPeaks}
                      trimStartSec={clip.trimStartSec ?? 0}
                      trimEndSec={clip.trimEndSec ?? clip.durationSec}
                      trimOpen={isTrimOpen}
                      onChangeTrim={(start, end) => updateClipTrim(clip.id, start, end)}
                      showZoom
                    />
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
});
