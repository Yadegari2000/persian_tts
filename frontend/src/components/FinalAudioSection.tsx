import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Crop,
  Mic2,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Waves,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { resolveVoiceVisualTheme } from '../config/config';
import { useTts } from '../context/TtsContext';
import * as audioEngine from '../utils/audioEngine';
import { AuditionRequest, MultiColorSegment, WaveformPlayer } from './WaveformPlayer';

export const FinalAudioSection = React.memo(function FinalAudioSection() {
  const {
    voices,
    clips,
    finalAudio,
    batch,
    canUndoFinalEdit,
    mergeSelectedClips,
    editFinalAudio,
    applyFinalAudioEffect,
    undoFinalAudioEdit,
    clearFinalAudio,
    showConfirm,
    showToast,
  } = useTts();
  const [merging, setMerging] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cutStart, setCutStart] = useState(0);
  const [cutEnd, setCutEnd] = useState(0);
  const [auditionReq, setAuditionReq] = useState<AuditionRequest | null>(null);

  const finalDur = Math.max(0.2, finalAudio?.durationSec || 0.2);

  useEffect(() => {
    if (!finalAudio) {
      setEditOpen(false);
      setCutStart(0);
      setCutEnd(0);
      return;
    }
    const dur = Math.max(0.2, finalAudio.durationSec || 0.2);
    const defaultStart = Math.round(dur * 0.25 * 100) / 100;
    const defaultEnd = Math.round(dur * 0.75 * 100) / 100;
    setCutStart(defaultStart);
    setCutEnd(Math.max(defaultStart + 0.1, defaultEnd));
  }, [finalAudio?.id, finalAudio?.durationSec]);

  const handleSelectionChange = useCallback((s: number, e: number) => {
    setCutStart(s);
    setCutEnd(e);
  }, []);

  const selectionOverlay = useMemo(
    () =>
      editOpen
        ? {
            active: true,
            startSec: cutStart,
            endSec: cutEnd,
            onChange: handleSelectionChange,
          }
        : undefined,
    [editOpen, cutStart, cutEnd, handleSelectionChange]
  );

  const selectedClips = useMemo(() => clips.filter((c) => c.selected), [clips]);
  const clipsToMerge = selectedClips.length >= 1 ? selectedClips : clips;

  const isOutOfSync = useMemo(() => {
    if (!finalAudio) return false;
    if (finalAudio.isEdited) return false;
    const snaps = finalAudio.clipSnapshots || [];
    if (clipsToMerge.length !== snaps.length) return true;

    for (let i = 0; i < clipsToMerge.length; i++) {
      const clip = clipsToMerge[i];
      const snap = snaps[i];
      if (!snap || clip.id !== snap.id) return true;
      if (snap.audioId && clip.audioId !== snap.audioId) return true;
      const expectedGap = i === clipsToMerge.length - 1 ? 0 : (clip.pauseAfterMs ?? 0);
      if (expectedGap !== (snap.pauseAfterMs ?? 0)) return true;
      const bounds = audioEngine.getEffectiveClipBounds(clip);
      if (
        (snap.trimStartSec !== undefined && Math.abs(bounds.start - snap.trimStartSec) > 0.02) ||
        (snap.trimEndSec !== undefined && Math.abs(bounds.end - snap.trimEndSec) > 0.02)
      ) {
        return true;
      }
    }
    return false;
  }, [finalAudio, clipsToMerge]);

  const multiSegments = useMemo<MultiColorSegment[] | undefined>(() => {
    if (!finalAudio?.clipSnapshots || finalAudio.clipSnapshots.length === 0) return undefined;
    return finalAudio.clipSnapshots.map((snap, idx) => {
      const theme = resolveVoiceVisualTheme(voices, {
        voiceName: snap.voiceName,
        fallbackColor: snap.speakerColor,
        fallbackIndex: idx,
      });
      return {
        durationSec: snap.durationSec || 2.5,
        pauseAfterMs: snap.pauseAfterMs ?? 0,
        color: snap.speakerColor || 'sky',
        voiceColorCss: theme.cssVar,
        peaks: snap.waveformPeaks || audioEngine.generateDeterministicPeaks(snap.id, 72),
        label: `#${idx + 1} ${(snap.voiceName || 'گوینده').split(' ')[0]}`,
      };
    });
  }, [finalAudio, voices]);

  const avgPauseMs = useMemo(() => {
    if (!finalAudio?.clipSnapshots || finalAudio.clipSnapshots.length < 2) return 0;
    const gaps = finalAudio.clipSnapshots.slice(0, -1).map((s) => s.pauseAfterMs || 0);
    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }, [finalAudio]);

  const handleMerge = async () => {
    setMerging(true);
    try {
      await mergeSelectedClips();
    } catch (err: unknown) {
      showToast(`خطا در ساخت ویس کامل: ${(err as Error).message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  const handleDeleteFinal = async () => {
    if (!finalAudio) return;
    const ok = await showConfirm({
      title: 'حذف خروجی نهایی',
      message:
        'آیا می‌خواهید فایل ویس کامل فعلی را حذف کنید؟ کلیپ‌های کتابخانه دست‌نخورده می‌مانند و هر زمان می‌توانید دوباره ویس کامل بسازید.',
      confirmText: 'حذف خروجی نهایی',
      danger: true,
    });
    if (ok) {
      clearFinalAudio();
    }
  };

  const handleDownloadFinal = async () => {
    if (!finalAudio) return;
    try {
      const objUrl = await audioEngine.getAudioObjectUrl(finalAudio.id, finalAudio.durationSec);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `final-audio-persian-tts-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: unknown) {
      showToast(`خطا در دانلود ویس کامل: ${(err as Error).message}`, 'error');
    }
  };

  const selectionLen = Math.max(0, Math.round((cutEnd - cutStart) * 100) / 100);
  const cutStartPct = Math.round((cutStart / finalDur) * 100);
  const cutEndPct = Math.round((cutEnd / finalDur) * 100);

  return (
    <section
      id="section-final"
      className="flex scroll-mt-20 flex-col gap-6"
      aria-labelledby="section-final-title"
    >
      {/* Calmer Header */}
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--ui-accent)]">
            <Puzzle className="h-4 w-4" />
          </div>
          <div>
            <h2
              id="section-final-title"
              className="text-lg font-bold tracking-tight text-[var(--text-primary)] sm:text-xl"
            >
              خروجی نهایی و ادغام صوت
            </h2>
            <p className="mt-1 text-xs font-normal text-[var(--text-secondary)] sm:text-[13px]">
              ساخت فایل صوتی یکپارچه از تمام کلیپ‌های کتابخانه به ترتیب از بالا به پایین همراه با ابزار برش و ادیت
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {finalAudio && (
            <button
              type="button"
              onClick={handleDeleteFinal}
              disabled={merging}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-transparent px-3.5 text-xs font-medium text-[var(--text-secondary)] transition-all duration-200 ease-out hover:border-[var(--danger-border)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] disabled:opacity-45 sm:h-9 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>حذف خروجی</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleMerge}
            disabled={clips.length === 0 || batch.active || merging}
            className="btn-gold btn-gold-pulse inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-xs transition-all duration-200 ease-out hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 sm:h-9 sm:flex-initial whitespace-nowrap shrink-0"
          >
            <Puzzle className="h-4 w-4" />
            <span>
              {merging
                ? 'در حال ساخت ویس کامل...'
                : `ساخت ویس کامل (${clipsToMerge.length} کلیپ)`}
            </span>
          </button>
        </div>
      </div>

      {/* Final Merged Card or Clean Empty State */}
      {!finalAudio ? (
        <div className="glass-card-calm flex flex-col items-center justify-center gap-3.5 px-6 py-10 text-center">
          <Puzzle className="h-12 w-12 stroke-[1.3] text-[var(--text-muted)] opacity-55" />
          <p className="max-w-md text-xs font-normal leading-relaxed text-[var(--text-muted)] sm:text-sm">
            هنوز ویس کاملی ساخته نشده است. پاراگراف‌ها را به ویس تبدیل کنید و روی «ساخت ویس کامل» بزنید.
          </p>
          {clips.length > 0 && (
            <button
              type="button"
              onClick={handleMerge}
              disabled={batch.active || merging}
              className="btn-gold inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs transition-all duration-200 ease-out hover:-translate-y-0.5 disabled:opacity-45"
            >
              <Puzzle className="h-3.5 w-3.5" />
              <span>ساخت ویس کامل ({clipsToMerge.length} کلیپ)</span>
            </button>
          )}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card-calm flex flex-col gap-4 p-5 transition-colors duration-200 hover:border-[var(--border-strong)] sm:p-6"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Mic2 className="h-4 w-4 text-[var(--success)]" />
                <strong className="text-sm font-bold text-[var(--text-primary)]">
                  ویس کامل ادغام‌شده آماده است ({finalAudio.clipSnapshots?.length || finalAudio.clipIds.length} کلیپ)
                </strong>
                {finalAudio.isEdited && (
                  <>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                    <span className="text-xs font-medium text-[var(--text-secondary)]">ویرایش‌شده</span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs font-normal text-[var(--text-secondary)] tabular-nums">
                مدت کل:{' '}
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  {(finalAudio.durationSec || 0).toFixed(2)}s
                </span>
                {!finalAudio.isEdited && (finalAudio.clipSnapshots?.length || 0) >= 2 && (
                  <>
                    {' '}
                    · میانگین مکث{' '}
                    <span className="font-mono font-semibold text-[var(--text-primary)]">{avgPauseMs}ms</span> بین کلیپ‌ها
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {(finalAudio.clipSnapshots || []).map((snap, i) => {
                  const shortName = (snap.voiceName || 'گوینده').split(' ')[0];
                  const theme = resolveVoiceVisualTheme(voices, {
                    voiceName: snap.voiceName,
                    fallbackColor: snap.speakerColor,
                    fallbackIndex: i,
                  });
                  return (
                    <span
                      key={`${snap.id}_${i}`}
                      style={{
                        backgroundColor: theme.chipBg,
                        borderColor: theme.chipBorder,
                        color: theme.cssVar,
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium"
                    >
                      <span
                        style={{ backgroundColor: theme.cssVar }}
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                      />
                      <span>
                        #{i + 1} {shortName}
                      </span>
                    </span>
                  );
                })}
              </div>

              <span aria-hidden="true" className="hidden text-[var(--text-muted)] sm:inline">
                |
              </span>

              {isOutOfSync ? (
                <span
                  title="ترتیب، انتخاب، گوینده یا برش کلیپ‌ها در کتابخانه تغییر یافته است"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--warning)]"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>نیازمند ادغام مجدد</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{finalAudio.isEdited ? 'برش‌خورده و آماده' : 'ادغام شده'}</span>
                </span>
              )}

              <button
                type="button"
                onClick={() => setEditOpen((prev) => !prev)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0 ${
                  editOpen
                    ? 'border-[var(--border-strong)] bg-[var(--bg-hover)] text-[var(--text-primary)]'
                    : 'btn-studio-secondary'
                }`}
              >
                <Scissors className="h-3.5 w-3.5" />
                <span>ابزار برش و ادیت</span>
              </button>
            </div>
          </div>

          <WaveformPlayer
            audioId={finalAudio.id}
            durationSec={finalAudio.durationSec}
            speakerColor="emerald"
            showZoom
            multiSegments={multiSegments}
            auditionRequest={auditionReq}
            selectionOverlay={selectionOverlay}
            extraActions={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={clips.length === 0 || merging}
                  title="ادغام مجدد با تمام کلیپ‌های کتابخانه"
                  aria-label="ادغام مجدد"
                  className="btn-studio-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-45"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${merging ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFinal}
                  title="دانلود فایل صوتی نهایی"
                  aria-label="دانلود فایل صوتی نهایی"
                  className="btn-studio-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDeleteFinal}
                  disabled={merging}
                  title="حذف خروجی نهایی"
                  aria-label="حذف خروجی نهایی"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--danger-border)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] disabled:opacity-45"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            }
          />

          {/* Final Audio Cut & Mastering Panel */}
          <AnimatePresence>
            {editOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 text-xs text-[var(--text-secondary)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">
                    بازهٔ دلخواه را روی موج صدا یا با نوارهای زیر انتخاب کنید تا از وسط حذف یا برش داده شود:
                  </span>
                  <span className="font-mono text-xs text-[var(--text-primary)] tabular-nums">
                    طول انتخاب: {selectionLen.toFixed(2)}s
                  </span>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
                  <label className="flex flex-1 min-w-[180px] items-center gap-2.5">
                    <span className="whitespace-nowrap font-normal text-[var(--text-secondary)]">شروع انتخاب:</span>
                    <input
                      type="range"
                      dir="ltr"
                      min={0}
                      max={finalDur}
                      step={0.01}
                      value={cutStart}
                      onChange={(e) => {
                        const val = Math.round(parseFloat(e.target.value) * 100) / 100;
                        setCutStart(Math.max(0, Math.min(cutEnd - 0.1, val)));
                      }}
                      style={{
                        background: `linear-gradient(to right, var(--ui-accent) ${cutStartPct}%, var(--border-subtle) ${cutStartPct}%)`,
                      }}
                      className="studio-range flex-1 cursor-pointer touch-none"
                    />
                    <span className="w-14 font-mono text-xs text-[var(--text-primary)] tabular-nums" dir="ltr">
                      {cutStart.toFixed(2)}s
                    </span>
                  </label>

                  <label className="flex flex-1 min-w-[180px] items-center gap-2.5">
                    <span className="whitespace-nowrap font-normal text-[var(--text-secondary)]">پایان انتخاب:</span>
                    <input
                      type="range"
                      dir="ltr"
                      min={0}
                      max={finalDur}
                      step={0.01}
                      value={cutEnd}
                      onChange={(e) => {
                        const val = Math.round(parseFloat(e.target.value) * 100) / 100;
                        setCutEnd(Math.min(finalDur, Math.max(cutStart + 0.1, val)));
                      }}
                      style={{
                        background: `linear-gradient(to right, var(--ui-accent) ${cutEndPct}%, var(--border-subtle) ${cutEndPct}%)`,
                      }}
                      className="studio-range flex-1 cursor-pointer touch-none"
                    />
                    <span className="w-14 font-mono text-xs text-[var(--text-primary)] tabular-nums" dir="ltr">
                      {cutEnd.toFixed(2)}s
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-2 pt-1 sm:flex sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={() =>
                      setAuditionReq({
                        startSec: cutStart,
                        endSec: cutEnd,
                        nonce: Date.now(),
                      })
                    }
                    className="btn-studio-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <Play className="h-3.5 w-3.5 text-[var(--ui-accent)]" />
                    <span>پخش بازهٔ انتخابی</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => editFinalAudio('cut-middle', cutStart, cutEnd)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--danger-border)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span>حذف بازهٔ انتخابی از وسط</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => editFinalAudio('keep-range', cutStart, cutEnd)}
                    className="btn-studio-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <Crop className="h-3.5 w-3.5" />
                    <span>نگه‌داشتن فقط همین بازه</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyFinalAudioEffect('normalize')}
                    title="یکدست‌سازی و افزایش تراز بلندی صدای خروجی نهایی"
                    className="btn-studio-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    <span>نرمال‌سازی صدا</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyFinalAudioEffect('fade')}
                    title="اعمال شروع و پایان نرم (Fade In / Fade Out) روی خروجی نهایی"
                    className="btn-studio-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <Waves className="h-3.5 w-3.5" />
                    <span>فید نرم ابتدا/انتها</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => undoFinalAudioEdit()}
                    disabled={!canUndoFinalEdit}
                    className="btn-studio-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 disabled:opacity-45 sm:h-8 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>واگرد ویرایش</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
});
