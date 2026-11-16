import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
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
import { SPEAKER_PALETTE } from '../config/config';
import { useTts } from '../context/TtsContext';
import * as audioEngine from '../utils/audioEngine';
import { AuditionRequest, MultiColorSegment, WaveformPlayer } from './WaveformPlayer';

export function FinalAudioSection() {
  const {
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
    return finalAudio.clipSnapshots.map((snap, idx) => ({
      durationSec: snap.durationSec || 2.5,
      pauseAfterMs: snap.pauseAfterMs ?? 0,
      color: snap.speakerColor || 'sky',
      peaks: snap.waveformPeaks || audioEngine.generateDeterministicPeaks(snap.id, 72),
      label: `#${idx + 1} ${(snap.voiceName || 'گوینده').split(' ')[0]}`,
    }));
  }, [finalAudio]);

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
      message: 'آیا می‌خواهید فایل ویس کامل فعلی را حذف کنید؟ کلیپ‌های کتابخانه دست‌نخورده می‌مانند و هر زمان می‌توانید دوباره ویس کامل بسازید.',
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

  return (
    <section className="flex flex-col gap-4" aria-labelledby="section-final-title">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Puzzle className="h-5 w-5 text-emerald-400" />
            <h2 id="section-final-title" className="text-base font-extrabold text-slate-50 sm:text-lg">
              خروجی نهایی و ادغام صوت
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            ساخت فایل صوتی یکپارچه از تمام کلیپ‌های کتابخانه به ترتیب از بالا به پایین همراه با ابزار برش و ادیت
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {finalAudio && (
            <button
              type="button"
              onClick={handleDeleteFinal}
              disabled={merging}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>حذف خروجی</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleMerge}
            disabled={clips.length === 0 || batch.active || merging}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-slate-950 shadow-sm transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
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

      {/* Final Merged Card */}
      {!finalAudio ? (
        <div className="rounded-2xl border border-dashed border-[#1d2b46] p-7 text-center text-sm text-slate-400">
          هنوز ویس کاملی ساخته نشده است. پاراگراف‌ها را به ویس تبدیل کنید و روی «ساخت ویس کامل» بزنید.
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 rounded-2xl border border-emerald-500/45 bg-gradient-to-b from-emerald-950/35 to-[#0b181b] p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Mic2 className="h-4 w-4 text-emerald-400" />
                <strong className="text-sm font-extrabold text-emerald-400">
                  ویس کامل ادغام‌شده آماده است ({finalAudio.clipSnapshots?.length || finalAudio.clipIds.length} کلیپ)
                </strong>
                {finalAudio.isEdited && (
                  <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                    ویرایش‌شده
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                مدت کل: {(finalAudio.durationSec || 0).toFixed(2)} ثانیه
                {!finalAudio.isEdited && (finalAudio.clipSnapshots?.length || 0) >= 2 && (
                  <>
                    {' '}
                    (میانگین مکث <span className="font-mono">{avgPauseMs}ms</span> بین کلیپ‌ها)
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(finalAudio.clipSnapshots || []).map((snap, i) => {
                const shortName = (snap.voiceName || 'گوینده').split(' ')[0];
                const pal = SPEAKER_PALETTE[snap.speakerColor || 'sky'] || SPEAKER_PALETTE.sky;
                return (
                  <span
                    key={`${snap.id}_${i}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pal.badgeBg} ${pal.badgeText}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${pal.dot}`} />
                    <span>
                      #{i + 1} {shortName}
                    </span>
                  </span>
                );
              })}

              {isOutOfSync ? (
                <span
                  title="ترتیب، انتخاب، گوینده یا برش کلیپ‌ها در کتابخانه تغییر یافته است"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span>نیازمند ادغام مجدد</span>
                </span>
              ) : (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  {finalAudio.isEdited ? 'برش‌خورده و آماده' : 'ادغام شده'}
                </span>
              )}

              <button
                type="button"
                onClick={() => setEditOpen((prev) => !prev)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  editOpen
                    ? 'border-rose-400 bg-rose-500/20 text-rose-200'
                    : 'border-rose-500/40 bg-[#1a1324] text-rose-300 hover:bg-rose-500/15'
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
            selectionOverlay={
              editOpen
                ? {
                    active: true,
                    startSec: cutStart,
                    endSec: cutEnd,
                    onChange: handleSelectionChange,
                  }
                : undefined
            }
            extraActions={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={clips.length === 0 || merging}
                  title="ادغام مجدد با تمام کلیپ‌های کتابخانه"
                  aria-label="ادغام مجدد"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${merging ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFinal}
                  title="دانلود فایل صوتی نهایی"
                  aria-label="دانلود فایل صوتی نهایی"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#223254] bg-[#131d35] text-slate-200 transition-colors hover:border-emerald-400 hover:text-emerald-300"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDeleteFinal}
                  disabled={merging}
                  title="حذف خروجی نهایی"
                  aria-label="حذف خروجی نهایی"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            }
          />

          {/* Final Audio Cut & Middle-Splice Editor */}
          {editOpen && (
            <div className="flex flex-col gap-3 rounded-xl border border-rose-500/30 bg-[#090d16] p-3.5 text-xs text-slate-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-100">
                  بازهٔ دلخواه را روی موج صدا یا با نوارهای زیر انتخاب کنید تا از وسط حذف یا برش داده شود:
                </span>
                <span className="font-mono text-[11px] text-rose-300 tabular-nums">
                  طول انتخاب: {selectionLen.toFixed(2)}s
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex flex-1 min-w-[180px] items-center gap-2">
                  <span className="whitespace-nowrap">شروع انتخاب:</span>
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
                    className="flex-1 accent-rose-400 cursor-pointer touch-none"
                  />
                  <span className="w-12 font-mono text-rose-300 tabular-nums" dir="ltr">
                    {cutStart.toFixed(2)}s
                  </span>
                </label>

                <label className="flex flex-1 min-w-[180px] items-center gap-2">
                  <span className="whitespace-nowrap">پایان انتخاب:</span>
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
                    className="flex-1 accent-amber-400 cursor-pointer touch-none"
                  />
                  <span className="w-12 font-mono text-amber-300 tabular-nums" dir="ltr">
                    {cutEnd.toFixed(2)}s
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setAuditionReq({
                      startSec: cutStart,
                      endSec: cutEnd,
                      nonce: Date.now(),
                    })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/25 whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>پخش بازهٔ انتخابی</span>
                </button>

                <button
                  type="button"
                  onClick={() => editFinalAudio('cut-middle', cutStart, cutEnd)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white transition-colors hover:bg-rose-500 whitespace-nowrap shrink-0"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  <span>حذف بازهٔ انتخابی از وسط</span>
                </button>

                <button
                  type="button"
                  onClick={() => editFinalAudio('keep-range', cutStart, cutEnd)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-500/25 whitespace-nowrap shrink-0"
                >
                  <Crop className="h-3.5 w-3.5" />
                  <span>نگه‌داشتن فقط همین بازه</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyFinalAudioEffect('normalize')}
                  title="یکدست‌سازی و افزایش تراز بلندی صدای خروجی نهایی"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/25 whitespace-nowrap shrink-0"
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span>نرمال‌سازی صدا</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyFinalAudioEffect('fade')}
                  title="اعمال شروع و پایان نرم (Fade In / Fade Out) روی خروجی نهایی"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/15 px-3 text-xs font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-500/25 whitespace-nowrap shrink-0"
                >
                  <Waves className="h-3.5 w-3.5" />
                  <span>فید نرم ابتدا/انتها</span>
                </button>

                <button
                  type="button"
                  onClick={() => undoFinalAudioEdit()}
                  disabled={!canUndoFinalEdit}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131d35] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>واگرد ویرایش</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
