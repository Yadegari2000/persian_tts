import { useState } from 'react';
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
import { SPEAKER_PALETTE } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { Clip } from '../types/tts';
import * as audioEngine from '../utils/audioEngine';
import { WaveformPlayer } from './WaveformPlayer';

export function ClipLibrarySection() {
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
  const [dragEnabledId, setDragEnabledId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: 'top' | 'bottom' } | null>(null);

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
    <section className="flex flex-col gap-4" aria-labelledby="section-library-title">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Music className="h-5 w-5 text-sky-400" />
            <h2 id="section-library-title" className="text-base font-extrabold text-slate-50 sm:text-lg">
              کتابخانه کلیپ‌های صوتی
            </h2>
            <span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-2.5 py-0.5 text-xs font-bold text-sky-300 tabular-nums">
              {clips.length} کلیپ
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            ترتیب کلیپ‌ها را با Drag &amp; Drop از دستگیره سمت راست تغییر دهید و سپس ادغام کنید
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectAllClips(true)}
            className="inline-flex h-8 items-center rounded-lg border border-[#1d2b46] bg-[#10192d] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#16233e] whitespace-nowrap shrink-0"
          >
            انتخاب همه
          </button>
          <button
            type="button"
            onClick={invertClipSelection}
            className="inline-flex h-8 items-center rounded-lg border border-[#1d2b46] bg-[#10192d] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#16233e] whitespace-nowrap shrink-0"
          >
            معکوس
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clips.length === 0}
            className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3.5 text-xs font-bold text-slate-900 transition-colors hover:bg-white disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            پاک‌سازی
          </button>
        </div>
      </div>

      {/* Clips List */}
      {clips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1d2b46] p-8 text-center text-sm text-slate-400">
          کتابخانه خالی است. پاراگراف‌ها را به ویس تبدیل کنید تا کلیپ‌های صوتی اینجا نمایش داده شوند.
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {clips.map((clip, idx) => {
            const colorKey = clip.speakerColor || 'purple';
            const pal = SPEAKER_PALETTE[colorKey] || SPEAKER_PALETTE.purple;
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

            return (
              <div
                key={clip.id}
                draggable={dragEnabledId === clip.id}
                onDragStart={(e) => {
                  if (dragEnabledId !== clip.id) {
                    e.preventDefault();
                    return;
                  }
                  setDraggedId(clip.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', clip.id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragEnabledId(null);
                  setDragOver(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!draggedId || draggedId === clip.id) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = e.clientY - rect.top > rect.height / 2 ? 'bottom' : 'top';
                  setDragOver({ id: clip.id, pos });
                }}
                onDragLeave={() => {
                  setDragOver((prev) => (prev?.id === clip.id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId = draggedId || e.dataTransfer.getData('text/plain');
                  setDragOver(null);
                  setDraggedId(null);
                  setDragEnabledId(null);
                  if (!sourceId || sourceId === clip.id) return;
                  const fromIndex = clips.findIndex((c) => c.id === sourceId);
                  const toIndex = clips.findIndex((c) => c.id === clip.id);
                  if (fromIndex === -1 || toIndex === -1) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isBottom = e.clientY - rect.top > rect.height / 2;
                  let targetIndex = toIndex;
                  if (isBottom && fromIndex > toIndex) targetIndex = toIndex + 1;
                  else if (!isBottom && fromIndex < toIndex) targetIndex = Math.max(0, toIndex - 1);
                  moveClipToIndex(sourceId, targetIndex);
                }}
                className={`flex flex-col gap-3 rounded-2xl border bg-[#10192d] p-4 transition-all ${
                  isDragging ? 'border-dashed border-sky-400 opacity-45' : pal.border
                } ${dropTop ? 'border-t-2 border-t-sky-400' : ''} ${dropBottom ? 'border-b-2 border-b-sky-400' : ''}`}
              >
                {/* Top Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      onMouseDown={() => setDragEnabledId(clip.id)}
                      onMouseUp={() => setDragEnabledId(null)}
                      onTouchStart={() => setDragEnabledId(clip.id)}
                      className="cursor-grab text-slate-500 hover:text-slate-200 active:cursor-grabbing"
                      title="جابه‌جایی با کشیدن (Drag & Drop)"
                      aria-hidden="true"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={clip.selected}
                        onChange={() => toggleClipSelect(clip.id)}
                        className="h-4 w-4 rounded accent-fuchsia-500 cursor-pointer"
                      />
                      <span className="font-mono text-xs font-bold text-slate-300 tabular-nums">
                        #{idx + 1}
                      </span>
                    </label>

                    {/* Interactive Speaker Selector inside Clip Library */}
                    <div
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${pal.badgeBg} ${pal.badgeText}`}
                    >
                      {isChangingVoice ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className={`h-2 w-2 rounded-full ${pal.dot}`} />
                      )}
                      <select
                        value={matchedVoice?.id || ''}
                        onChange={(e) => handleVoiceChange(clip.id, e.target.value)}
                        disabled={isChangingVoice}
                        aria-label="تغییر گوینده کلیپ"
                        title="تغییر گوینده و بازتولید صدا"
                        className="cursor-pointer bg-transparent text-xs font-semibold focus:outline-none"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id} className="bg-[#0f172a] text-slate-100">
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span className="inline-flex items-center gap-1 text-xs text-slate-300 tabular-nums">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>{bounds.effectiveDuration.toFixed(1)} ثانیه</span>
                    </span>

                    <label className="inline-flex items-center gap-1 rounded-full border border-[#223254] bg-[#0b1329] px-2.5 py-0.5 text-[11px] text-slate-300">
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
                        className="w-11 bg-transparent text-center font-mono text-sky-300 focus:outline-none tabular-nums"
                      />
                      <span>ms</span>
                    </label>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleTrim(clip.id)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        isTrimOpen
                          ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200'
                          : 'border-fuchsia-500/40 bg-[#15182e] text-fuchsia-300 hover:bg-fuchsia-500/15'
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
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#090d16] hover:text-slate-100 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveClip(clip.id, 'down')}
                      disabled={idx === clips.length - 1}
                      title="انتقال به پایین"
                      aria-label="انتقال به پایین"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#090d16] hover:text-slate-100 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => resynthesizeClip(clip)}
                      title="ساخت دوباره با همان متن و صدا"
                      aria-label="ساخت دوباره"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-[#090d16] hover:text-sky-400"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadClip(clip, idx)}
                      title="دانلود فایل صوتی"
                      aria-label="دانلود فایل صوتی"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-[#090d16] hover:text-emerald-400"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClip(clip)}
                      title="حذف کلیپ"
                      aria-label="حذف کلیپ"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Text Content */}
                <p className="text-xs leading-relaxed text-slate-200">{clip.preparedText || clip.text}</p>

                {/* Waveform Player */}
                <WaveformPlayer
                  audioId={clip.audioId}
                  durationSec={clip.durationSec}
                  engineVoice={clip.engineVoice}
                  fallbackText={clip.text}
                  speakerColor={colorKey}
                  peaks={clip.waveformPeaks}
                  trimStartSec={clip.trimStartSec ?? 0}
                  trimEndSec={clip.trimEndSec ?? clip.durationSec}
                  trimOpen={isTrimOpen}
                  onChangeTrim={(start, end) => updateClipTrim(clip.id, start, end)}
                  showZoom
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
