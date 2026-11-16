import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Drama,
  FileEdit,
  FileText,
  Plus,
  Scissors,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { CONFIG, SPEAKER_PALETTE } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { DictionaryEntry, Segment, SegmentStatus, Voice } from '../types/tts';
import { parseDialogueScript, prepareText } from '../utils/text';

interface ParagraphsSectionProps {
  onOpenSplitModal: () => void;
  onFocusSegment: (id: string) => void;
}

const STATUS_BADGES: Record<SegmentStatus, { text: string; className: string }> = {
  idle: {
    text: 'آماده',
    className: 'border border-slate-600/40 bg-slate-700/30 text-slate-300',
  },
  loading: {
    text: 'در حال تبدیل...',
    className: 'border border-sky-400/40 bg-sky-500/20 text-sky-300 animate-pulse',
  },
  done: {
    text: 'تبدیل‌شده',
    className: 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
  },
  error: {
    text: 'خطا',
    className: 'border border-rose-400/40 bg-rose-500/15 text-rose-300',
  },
};

export function ParagraphsSection({ onOpenSplitModal, onFocusSegment }: ParagraphsSectionProps) {
  const {
    voices,
    dictionary,
    segments,
    characterVoices,
    characterSummary,
    batch,
    isVoiceValid,
    addSegment,
    duplicateSegment,
    removeSegment,
    moveSegment,
    updateSegment,
    pushHistory,
    convertSegmentById,
    handleConvertAll,
    handleCancelBatch,
    setCharacterVoice,
    removeCharacterVoice,
    applyDialogueLines,
    showConfirm,
    showToast,
  } = useTts();

  const [mode, setMode] = useState<'normal' | 'dialogue'>('normal');
  const [dialogueScript, setDialogueScript] = useState('');

  const parsedDialogue = useMemo(() => parseDialogueScript(dialogueScript), [dialogueScript]);

  const unresolvedCount = useMemo(
    () => characterSummary.reduce((sum, c) => sum + c.unresolved, 0),
    [characterSummary]
  );

  const handleApplyDialogue = async () => {
    if (!dialogueScript.trim()) {
      showToast('لطفاً متن دیالوگ یا فیلمنامه را وارد کنید.', 'warning');
      return;
    }

    const { characters, lines } = parsedDialogue;
    if (lines.length === 0) {
      showToast('هیچ خط دیالوگی با فرمت «نام: دیالوگ» یافت نشد.', 'warning');
      return;
    }

    const unmapped = characters.filter((c) => !isVoiceValid(characterVoices[c] || ''));
    if (unmapped.length > 0) {
      const ok = await showConfirm({
        title: 'شخصیت‌های بدون صدا',
        message: `شخصیت‌های زیر هنوز صدای معتبری ندارند: ${unmapped.join('، ')}. پاراگراف‌های این شخصیت‌ها تا زمان انتخاب صدا تبدیل نخواهند شد. آیا اعمال شود؟`,
        confirmText: 'اعمال و ادامه',
        danger: false,
      });
      if (!ok) return;
    }

    applyDialogueLines(lines);
    setMode('normal');
    showToast(`${lines.length} پاراگراف دیالوگ با موفقیت اضافه شد.`, 'success');
  };

  const batchPercent = batch.total > 0 ? Math.round((batch.completed / batch.total) * 100) : 0;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="section-paragraphs-title">
      {/* Section Header */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileEdit className="h-5 w-5 text-amber-400" />
            <h2 id="section-paragraphs-title" className="text-base font-extrabold text-slate-50 sm:text-lg">
              ویرایشگر و تولید صدا
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            متن را بنویسید؛ پیش‌پردازش کلمات و مکث انتهای هر بخش را تنظیم کنید
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            className="inline-flex items-center gap-1 rounded-xl border border-[#1d2b46] bg-[#10192d] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'normal'}
              onClick={() => setMode('normal')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                mode === 'normal'
                  ? 'bg-gradient-to-l from-cyan-500 to-sky-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>حالت عادی</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'dialogue'}
              onClick={() => setMode('dialogue')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                mode === 'dialogue'
                  ? 'bg-gradient-to-l from-cyan-500 to-sky-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Drama className="h-3.5 w-3.5 text-amber-300" />
              <span>حالت دیالوگ / فیلمنامه</span>
            </button>
          </div>

          {mode === 'normal' && (
            <>
              <button
                type="button"
                onClick={onOpenSplitModal}
                title="تقسیم متن بلند به پاراگراف‌ها با خط خالی"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#1d2b46] bg-[#10192d] px-3.5 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#16233e] whitespace-nowrap shrink-0"
              >
                <Scissors className="h-3.5 w-3.5 text-rose-400" />
                <span>تقسیم متن</span>
              </button>

              {!batch.active ? (
                <button
                  type="button"
                  onClick={handleConvertAll}
                  title="تبدیل تمام پاراگراف‌های آماده (Ctrl+Shift+Enter)"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-l from-cyan-500 to-sky-600 px-3.5 text-xs font-bold text-white shadow-sm transition-all hover:brightness-110 whitespace-nowrap shrink-0"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-300" />
                  <span>تبدیل همه به ویس</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCancelBatch}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-bold text-white transition-colors hover:bg-rose-500 whitespace-nowrap shrink-0"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>لغو تبدیل</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => addSegment()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 text-xs font-bold text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>افزودن پاراگراف</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Batch Progress */}
      {batch.active && (
        <div className="rounded-2xl border border-sky-500/50 bg-[#10192d] p-3.5">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-100 tabular-nums">
            <span>
              در حال تبدیل {batch.completed} از {batch.total} پاراگراف ({batchPercent}٪)...
            </span>
            {batch.errors > 0 && <span className="text-rose-400">{batch.errors} خطا</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-[#223254] bg-[#090d16]">
            <div
              className="h-full bg-gradient-to-l from-cyan-400 to-sky-600 transition-all duration-300"
              style={{ width: `${batchPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Dialogue Mode Panel */}
      {mode === 'dialogue' ? (
        <div className="flex flex-col gap-5 rounded-2xl border border-[#1d2b46] bg-[#10192d] p-5">
          <p className="text-sm leading-relaxed text-slate-300">
            متن دیالوگ یا فیلمنامه را با فرمت «نام شخصیت: دیالوگ» در هر خط وارد کنید. سپس برای هر شخصیت یک صدا انتخاب کنید و روی «اعمال» کلیک کنید.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="dialogue-textarea-inline" className="text-xs font-semibold text-slate-200">
              متن دیالوگ یا فیلمنامه:
            </label>
            <textarea
              id="dialogue-textarea-inline"
              value={dialogueScript}
              onChange={(e) => setDialogueScript(e.target.value)}
              rows={6}
              placeholder={
                'علی: سلام، حالت چطوره؟\nسارا: ممنون، امروز قراره روی پروژه جدید کار کنیم.\nراوی: هر دو با اشتیاق کار را شروع کردند.'
              }
              className="w-full rounded-xl border border-[#1d2b46] bg-[#090d16] p-3 text-sm leading-7 text-slate-100 placeholder:text-slate-500/65 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="border-t border-[#1d2b46] pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-200">گوینده شخصیت‌ها:</span>
              <span className="text-xs text-slate-400">
                برای هر شخصیت نام‌برده در متن، گوینده مورد نظر را انتخاب کنید
              </span>
            </div>

            {parsedDialogue.characters.length === 0 ? (
              <p className="text-xs text-slate-400">
                با نوشتن دیالوگ (مانند «علی: سلام»)، شخصیت‌ها اینجا لیست می‌شوند.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {parsedDialogue.characters.map((char) => {
                  const mappedId = characterVoices[char] || '';
                  const hasVoice = isVoiceValid(mappedId);
                  const suggestion = !hasVoice
                    ? voices.find((v) => (v.tags || []).some((t) => t.trim() === char)) || null
                    : null;

                  return (
                    <div
                      key={char}
                      className={`flex flex-wrap items-center gap-3 rounded-xl border p-2.5 ${
                        hasVoice
                          ? 'border-[#1d2b46] bg-[#090d16]'
                          : 'border-amber-500/50 bg-amber-500/5'
                      }`}
                    >
                      <span className="min-w-[5rem] text-sm font-bold text-slate-100">{char}</span>
                      <span className="text-slate-500">←</span>
                      <select
                        value={hasVoice ? mappedId : ''}
                        onChange={(e) => {
                          if (e.target.value) setCharacterVoice(char, e.target.value);
                          else removeCharacterVoice(char);
                        }}
                        aria-label={`صدای ${char}`}
                        className="min-w-[12rem] flex-1 rounded-lg border border-[#223254] bg-[#10192d] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                      >
                        <option value="">— انتخاب صدا —</option>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.tags?.length ? ` (${v.tags.join('، ')})` : ''}
                          </option>
                        ))}
                      </select>
                      {hasVoice ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <Check className="h-3.5 w-3.5" />
                          <span>تنظیم شد</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>بدون صدا</span>
                        </span>
                      )}
                      {suggestion && (
                        <button
                          type="button"
                          onClick={() => setCharacterVoice(char, suggestion.id)}
                          className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
                        >
                          پیشنهاد: {suggestion.name}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApplyDialogue}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-cyan-500 to-sky-600 px-5 py-2 text-sm font-bold text-white hover:brightness-110"
            >
              <Check className="h-4 w-4" />
              <span>اعمال دیالوگ‌ها</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Character Mapping Panel */}
          {characterSummary.length > 0 && unresolvedCount > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-[#10192d] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-slate-100">شخصیت‌ها و صداها</strong>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{unresolvedCount} پاراگراف بدون صدا؛ تا انتخاب صدا تبدیل نمی‌شوند</span>
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {characterSummary.map((c) => (
                  <div
                    key={c.name}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${
                      c.voiceId ? 'border-[#1d2b46] bg-[#090d16]' : 'border-amber-500/50 bg-amber-500/5'
                    }`}
                  >
                    <div className="min-w-[4.5rem]">
                      <div className="text-xs font-bold text-slate-100">{c.name}</div>
                      <div className="text-[11px] text-slate-400 tabular-nums">{c.total} پاراگراف</div>
                    </div>
                    <select
                      value={c.voiceId}
                      onChange={(e) => {
                        if (e.target.value) setCharacterVoice(c.name, e.target.value);
                        else removeCharacterVoice(c.name);
                      }}
                      aria-label={`صدای ${c.name}`}
                      className="flex-1 rounded-lg border border-[#223254] bg-[#10192d] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                    >
                      <option value="">— انتخاب صدا —</option>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Segment Cards */}
          <div className="flex flex-col gap-4">
            {segments.map((segment, idx) => (
              <SegmentCard
                key={segment.id}
                segment={segment}
                idx={idx}
                totalSegments={segments.length}
                voices={voices}
                dictionary={dictionary}
                voiceOk={isVoiceValid(segment.voiceId)}
                onFocusSegment={onFocusSegment}
                onMoveSegment={moveSegment}
                onDuplicateSegment={duplicateSegment}
                onRemoveSegment={removeSegment}
                onUpdateSegment={updateSegment}
                onPushHistory={pushHistory}
                onConvertSegment={convertSegmentById}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

interface SegmentCardProps {
  segment: Segment;
  idx: number;
  totalSegments: number;
  voices: Voice[];
  dictionary: DictionaryEntry[];
  voiceOk: boolean;
  onFocusSegment: (id: string) => void;
  onMoveSegment: (id: string, dir: 'up' | 'down') => void;
  onDuplicateSegment: (id: string) => void;
  onRemoveSegment: (id: string) => void;
  onUpdateSegment: (id: string, updates: Partial<Segment>, recordHistory?: boolean) => void;
  onPushHistory: () => void;
  onConvertSegment: (id: string) => Promise<boolean>;
}

const SegmentCard = React.memo(function SegmentCard({
  segment,
  idx,
  totalSegments,
  voices,
  dictionary,
  voiceOk,
  onFocusSegment,
  onMoveSegment,
  onDuplicateSegment,
  onRemoveSegment,
  onUpdateSegment,
  onPushHistory,
  onConvertSegment,
}: SegmentCardProps) {
  const charCount = segment.text.length;
  const isOverLimit = charCount > CONFIG.MAX_CHAR_COUNT;
  const isEmpty = charCount === 0;
  const prepared = useMemo(() => prepareText(segment.text, dictionary), [segment.text, dictionary]);
  const hasModifications = prepared !== segment.text && segment.text.trim().length > 0;
  const selectedVoice = useMemo(() => voices.find((v) => v.id === segment.voiceId), [voices, segment.voiceId]);
  const statusBadge = STATUS_BADGES[segment.status] || STATUS_BADGES.idle;
  const speakerLabel = segment.characterName || (selectedVoice ? selectedVoice.name.split(' ')[0] : null);
  const speakerPalette = SPEAKER_PALETTE[selectedVoice?.color || 'sky'] || SPEAKER_PALETTE.sky;

  return (
    <div
      data-segment-id={segment.id}
      onFocus={() => onFocusSegment(segment.id)}
      className="flex flex-col gap-3 rounded-2xl border border-[#1d2b46] bg-[#10192d] p-4 transition-colors hover:border-[#2a3f66]"
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold text-sky-400 tabular-nums">پاراگراف {idx + 1}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
            {statusBadge.text}
          </span>
          {speakerLabel && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${speakerPalette.badgeBg} ${speakerPalette.badgeText}`}
            >
              <Drama className="h-3 w-3" />
              <span>{speakerLabel}</span>
            </span>
          )}
          {!voiceOk && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              <span>بدون صدا</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveSegment(segment.id, 'up')}
            disabled={idx === 0}
            title="انتقال به بالا"
            aria-label="انتقال به بالا"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#090d16] hover:text-slate-100 disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMoveSegment(segment.id, 'down')}
            disabled={idx === totalSegments - 1}
            title="انتقال به پایین"
            aria-label="انتقال به پایین"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#090d16] hover:text-slate-100 disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDuplicateSegment(segment.id)}
            title="تکثیر پاراگراف"
            aria-label="تکثیر پاراگراف"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-400/80 hover:bg-[#090d16] hover:text-amber-300"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemoveSegment(segment.id)}
            title="حذف پاراگراف"
            aria-label="حذف پاراگراف"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        value={segment.text}
        onChange={(e) => onUpdateSegment(segment.id, { text: e.target.value }, false)}
        onBlur={() => onPushHistory()}
        placeholder="متن فارسی این پاراگراف را اینجا بنویسید..."
        rows={3}
        maxLength={CONFIG.MAX_CHAR_COUNT}
        disabled={segment.status === 'loading'}
        className={`w-full resize-y rounded-xl border bg-[#090e1a] p-3 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
          isOverLimit
            ? 'border-rose-500 focus:ring-rose-500/30'
            : 'border-[#1d2b46] focus:border-sky-400 focus:ring-sky-400/20'
        }`}
      />

      {/* Preprocessed Text Preview Box */}
      <div className="rounded-xl border border-[#1a253d] bg-[#0b1222] px-3.5 py-2.5 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            متن ارسالی به موتور {hasModifications ? '(پیش‌پردازش‌شده با نرمال‌سازی):' : ':'}
          </span>
          {hasModifications && (
            <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-300">
              نرمال‌سازی شده
            </span>
          )}
        </div>
        <div className={`whitespace-pre-wrap break-words leading-relaxed ${prepared ? 'text-slate-200' : 'text-slate-500'}`}>
          {prepared || '—'}
        </div>
      </div>

      {/* Controls Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>گوینده:</span>
            <select
              value={voiceOk ? segment.voiceId : ''}
              onChange={(e) => onUpdateSegment(segment.id, { voiceId: e.target.value }, true)}
              disabled={segment.status === 'loading'}
              aria-invalid={!voiceOk}
              className={`rounded-lg border bg-[#090e1a] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none ${
                voiceOk ? 'border-[#1d2b46]' : 'border-amber-500'
              }`}
            >
              {!voiceOk && (
                <option value="" disabled>
                  — انتخاب صدا —
                </option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>سرعت:</span>
            <span className="font-mono text-xs font-bold text-sky-400 tabular-nums">
              {Number(segment.rate.toFixed(1))}x
            </span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={segment.rate}
              onChange={(e) => onUpdateSegment(segment.id, { rate: parseFloat(e.target.value) }, false)}
              onMouseUp={() => onPushHistory()}
              disabled={segment.status === 'loading'}
              className="w-24 accent-sky-400 cursor-pointer"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>مکث آخر ویس (میلی‌ثانیه):</span>
            <span className="font-mono text-xs font-bold text-sky-400 tabular-nums">
              {segment.pauseAfterMs || 0}ms
            </span>
            <input
              type="range"
              min="0"
              max="2000"
              step="50"
              value={segment.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS}
              onChange={(e) =>
                onUpdateSegment(segment.id, { pauseAfterMs: parseInt(e.target.value, 10) }, false)
              }
              onMouseUp={() => onPushHistory()}
              disabled={segment.status === 'loading'}
              className="w-24 accent-sky-400 cursor-pointer"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mr-auto">
          {segment.status === 'error' && segment.error && (
            <span className="text-xs text-rose-400" title={segment.error}>
              {segment.error.slice(0, 28)}
            </span>
          )}

          <button
            type="button"
            onClick={() => onConvertSegment(segment.id)}
            disabled={segment.status === 'loading' || isEmpty || isOverLimit || !voiceOk}
            title={
              voiceOk
                ? 'تبدیل این پاراگراف (Ctrl+Enter)'
                : 'ابتدا یک صدا برای این پاراگراف انتخاب کنید'
            }
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-all whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-45 ${
              segment.status === 'error'
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-gradient-to-l from-cyan-500 to-sky-600 text-white shadow-sm hover:brightness-110'
            }`}
          >
            {segment.status === 'loading'
              ? 'در حال تبدیل...'
              : segment.status === 'error'
                ? 'تلاش مجدد'
                : 'تبدیل این پاراگراف'}
          </button>
        </div>
      </div>
    </div>
  );
});
