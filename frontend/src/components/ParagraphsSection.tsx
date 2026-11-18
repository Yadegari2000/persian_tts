import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Drama,
  FileEdit,
  FileText,
  Loader2,
  Plus,
  Scissors,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CONFIG, resolveVoiceVisualTheme } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { DictionaryEntry, Segment, SegmentStatus, Voice } from '../types/tts';
import { parseDialogueScript, prepareText } from '../utils/text';

interface ParagraphsSectionProps {
  onOpenSplitModal: () => void;
  onFocusSegment: (id: string) => void;
}

const STATUS_META: Record<
  SegmentStatus,
  { text: string; textClass: string; iconClass: string; Icon: typeof Clock }
> = {
  idle: {
    text: 'آماده',
    textClass: 'text-[var(--success)]',
    iconClass: 'text-[var(--success)]',
    Icon: Clock,
  },
  loading: {
    text: 'در حال تبدیل...',
    textClass: 'text-[var(--text-primary)]',
    iconClass: 'text-[var(--ui-accent)] animate-spin',
    Icon: Loader2,
  },
  done: {
    text: 'تبدیل‌شده',
    textClass: 'text-[var(--success)]',
    iconClass: 'text-[var(--success)]',
    Icon: CheckCircle2,
  },
  error: {
    text: 'خطا',
    textClass: 'text-[var(--danger)]',
    iconClass: 'text-[var(--danger)]',
    Icon: AlertCircle,
  },
};

export const ParagraphsSection = React.memo(function ParagraphsSection({
  onOpenSplitModal,
  onFocusSegment,
}: ParagraphsSectionProps) {
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
    <section
      id="section-paragraphs"
      className="flex scroll-mt-20 flex-col gap-6"
      aria-labelledby="section-paragraphs-title"
    >
      {/* Row 1: Stationary Title + Mode Switcher (tablist NEVER moves when switching modes) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--ui-accent)]">
            <FileEdit className="h-4 w-4" />
          </div>
          <div>
            <h2
              id="section-paragraphs-title"
              className="text-lg font-bold tracking-tight text-[var(--text-primary)] sm:text-xl"
            >
              ویرایشگر و تولید صدا
            </h2>
            <p className="mt-1 text-xs font-normal text-[var(--text-secondary)] sm:text-[13px]">
              متن را بنویسید؛ پیش‌پردازش کلمات و مکث انتهای هر بخش را تنظیم کنید
            </p>
          </div>
        </div>

        {/* Fixed-position Mode Tab Switcher */}
        <div
          role="tablist"
          aria-label="حالت ویرایشگر"
          className="relative inline-flex w-full shrink-0 items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1 sm:w-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'normal'}
            onClick={() => setMode('normal')}
            className={`relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors duration-200 sm:flex-initial sm:py-1.5 whitespace-nowrap shrink-0 ${
              mode === 'normal'
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {mode === 'normal' && (
              <motion.span
                layoutId="editor-mode-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-hover)]"
              />
            )}
            <FileText className="h-3.5 w-3.5" />
            <span>حالت عادی</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'dialogue'}
            onClick={() => setMode('dialogue')}
            className={`relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors duration-200 sm:flex-initial sm:py-1.5 whitespace-nowrap shrink-0 ${
              mode === 'dialogue'
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {mode === 'dialogue' && (
              <motion.span
                layoutId="editor-mode-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-hover)]"
              />
            )}
            <Drama className="h-3.5 w-3.5" />
            <span>حالت دیالوگ / فیلمنامه</span>
          </button>
        </div>
      </div>

      {/* Row 2: Dedicated Action Bar for Normal Mode (decoupled from Row 1 so tablist never shifts) */}
      {mode === 'normal' && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-y border-[var(--border-subtle)] py-3">
          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
            <span className="font-mono font-semibold text-[var(--text-primary)]">{segments.length}</span>{' '}
            پاراگراف در صف ویرایش
          </span>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={onOpenSplitModal}
              title="تقسیم متن بلند به پاراگراف‌ها با خط خالی"
              className="btn-studio-secondary inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-all duration-200 ease-out sm:h-9 sm:flex-initial whitespace-nowrap shrink-0"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>تقسیم متن</span>
            </button>

            <button
              type="button"
              onClick={() => addSegment()}
              className="btn-studio-secondary inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-all duration-200 ease-out sm:h-9 sm:flex-initial whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>افزودن پاراگراف</span>
            </button>

            {!batch.active ? (
              <button
                type="button"
                onClick={handleConvertAll}
                title="تبدیل تمام پاراگراف‌های آماده (Ctrl+Shift+Enter)"
                className="btn-gold btn-gold-pulse inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs transition-all duration-200 ease-out hover:-translate-y-0.5 sm:h-9 sm:w-auto whitespace-nowrap shrink-0"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>تبدیل همه به ویس</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancelBatch}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--danger)] px-4 text-xs font-bold text-[var(--cta-text)] transition-all duration-200 hover:brightness-110 sm:h-9 sm:w-auto whitespace-nowrap shrink-0"
              >
                <Square className="h-3.5 w-3.5" />
                <span>لغو تبدیل</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Batch Progress Bar */}
      <AnimatePresence>
        {batch.active && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="glass-card p-4 sm:p-5"
          >
            <div className="mb-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-primary)] tabular-nums">
              <span>
                در حال تبدیل {batch.completed} از {batch.total} پاراگراف (
                <span className="font-mono text-[var(--text-primary)]">{batchPercent}%</span>)...
              </span>
              {batch.errors > 0 && <span className="text-[var(--danger)]">{batch.errors} خطا</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)]">
              <motion.div
                initial={false}
                animate={{ width: `${batchPercent}%` }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full bg-gradient-to-l from-[var(--cta-from)] to-[var(--cta-to)]"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialogue Mode Panel or Segment Cards */}
      <AnimatePresence mode="wait">
        {mode === 'dialogue' ? (
          <motion.div
            key="dialogue-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="glass-card editor-card-glow flex flex-col gap-5 p-5 sm:p-6"
          >
            <p className="text-xs font-normal leading-relaxed text-[var(--text-secondary)] sm:text-sm">
              متن دیالوگ یا فیلمنامه را با فرمت «نام شخصیت: دیالوگ» در هر خط وارد کنید. سپس برای هر شخصیت یک صدا انتخاب کنید و روی «اعمال» کلیک کنید.
            </p>

            <div className="flex flex-col gap-2">
              <label htmlFor="dialogue-textarea-inline" className="text-xs font-semibold text-[var(--text-primary)]">
                متن دیالوگ یا فیلمنامه:
              </label>
              <textarea
                id="dialogue-textarea-inline"
                value={dialogueScript}
                onChange={(e) => setDialogueScript(e.target.value)}
                rows={7}
                placeholder={
                  'علی: سلام، حالت چطوره؟\nسارا: ممنون، امروز قراره روی پروژه جدید کار کنیم.\nراوی: هر دو با اشتیاق کار را شروع کردند.'
                }
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 text-sm leading-7 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-200 focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">گوینده شخصیت‌ها</span>
                <span className="text-[var(--text-muted)]" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs font-normal text-[var(--text-secondary)]">
                  برای هر شخصیت نام‌برده در متن، گوینده مورد نظر را انتخاب کنید
                </span>
              </div>

              {parsedDialogue.characters.length === 0 ? (
                <p className="text-xs font-normal text-[var(--text-secondary)]">
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
                        className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                          hasVoice
                            ? 'border-[var(--border-subtle)] bg-[var(--bg-input)]'
                            : 'border-[var(--warning-border)] bg-[var(--warning-muted)]'
                        }`}
                      >
                        <span className="min-w-[5rem] text-sm font-bold text-[var(--text-primary)]">{char}</span>
                        <span className="text-[var(--text-muted)]">←</span>
                        <select
                          value={hasVoice ? mappedId : ''}
                          onChange={(e) => {
                            if (e.target.value) setCharacterVoice(char, e.target.value);
                            else removeCharacterVoice(char);
                          }}
                          aria-label={`صدای ${char}`}
                          className="min-w-[11rem] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                        >
                          <option value="">— انتخاب صدا —</option>
                          {voices.map((v) => (
                            <option key={v.id} value={v.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                              {v.name}
                              {v.tags?.length ? ` (${v.tags.join('، ')})` : ''}
                            </option>
                          ))}
                        </select>
                        {hasVoice ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]">
                            <Check className="h-3.5 w-3.5" />
                            <span>تنظیم شد</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--warning)]">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>بدون صدا</span>
                          </span>
                        )}
                        {suggestion && (
                          <button
                            type="button"
                            onClick={() => setCharacterVoice(char, suggestion.id)}
                            className="btn-studio-secondary rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
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
                className="btn-gold inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-5 text-sm transition-all duration-200 ease-out hover:-translate-y-0.5 sm:w-auto"
              >
                <Check className="h-4 w-4" />
                <span>اعمال دیالوگ‌ها</span>
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="normal-panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="flex flex-col gap-6"
          >
            {/* Character Mapping Panel */}
            {characterSummary.length > 0 && unresolvedCount > 0 && (
              <div className="glass-card flex flex-col gap-3 border-[var(--warning-border)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-[var(--text-primary)]">شخصیت‌ها و صداها</strong>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--warning)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{unresolvedCount} پاراگراف بدون صدا؛ تا انتخاب صدا تبدیل نمی‌شوند</span>
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {characterSummary.map((c) => (
                    <div
                      key={c.name}
                      className={`flex items-center gap-2.5 rounded-xl border p-3 ${
                        c.voiceId
                          ? 'border-[var(--border-subtle)] bg-[var(--bg-input)]'
                          : 'border-[var(--warning-border)] bg-[var(--warning-muted)]'
                      }`}
                    >
                      <div className="min-w-[4.5rem]">
                        <div className="text-xs font-bold text-[var(--text-primary)]">{c.name}</div>
                        <div className="text-xs text-[var(--text-secondary)] tabular-nums">{c.total} پاراگراف</div>
                      </div>
                      <select
                        value={c.voiceId}
                        onChange={(e) => {
                          if (e.target.value) setCharacterVoice(c.name, e.target.value);
                          else removeCharacterVoice(c.name);
                        }}
                        aria-label={`صدای ${c.name}`}
                        className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                      >
                        <option value="">— انتخاب صدا —</option>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Segment Cards (24px gap) */}
            <div className="flex flex-col gap-6">
              <AnimatePresence initial={false}>
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
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});

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
  const selectedVoice = useMemo(
    () => voices.find((v) => v.id === segment.voiceId),
    [voices, segment.voiceId]
  );
  const statusMeta = STATUS_META[segment.status] || STATUS_META.idle;
  const StatusIcon = statusMeta.Icon;
  const speakerLabel = segment.characterName || (selectedVoice ? selectedVoice.name.split(' ')[0] : null);
  const voiceTheme = useMemo(
    () =>
      resolveVoiceVisualTheme(voices, {
        voiceId: selectedVoice?.id || segment.voiceId,
        fallbackColor: selectedVoice?.color,
      }),
    [voices, selectedVoice, segment.voiceId]
  );

  const ratePct = Math.round(((segment.rate - 0.5) / 1.5) * 100);
  const pauseVal = segment.pauseAfterMs ?? CONFIG.DEFAULT_PAUSE_AFTER_MS;
  const pausePct = Math.round((pauseVal / 2000) * 100);

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
      data-segment-id={segment.id}
      onFocus={() => onFocusSegment(segment.id)}
      className="glass-card editor-card-glow relative flex flex-col gap-4 overflow-hidden p-5 pr-6 transition-colors duration-200 hover:border-[var(--border-strong)] sm:p-6 sm:pr-7"
    >
      {/* 4px Right-Side Speaker Identity Strip (RTL) */}
      <span
        aria-hidden="true"
        style={{ backgroundColor: voiceOk ? voiceTheme.cssVar : 'var(--warning)' }}
        className="pointer-events-none absolute inset-y-0 right-0 w-1"
      />

      {/* Top Bar: Paragraph Metadata + Dim Uniform Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-[var(--text-primary)] tabular-nums">پاراگراف {idx + 1}</span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ·
          </span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.textClass}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${statusMeta.iconClass}`} />
            <span>{statusMeta.text}</span>
          </span>

          {speakerLabel && (
            <>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span
                style={
                  voiceOk
                    ? {
                        backgroundColor: voiceTheme.chipBg,
                        borderColor: voiceTheme.chipBorder,
                        color: voiceTheme.cssVar,
                      }
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-xs font-medium ${
                  voiceOk
                    ? ''
                    : 'border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]'
                }`}
              >
                <span
                  style={{ backgroundColor: voiceOk ? voiceTheme.cssVar : 'var(--warning)' }}
                  className="h-2 w-2 shrink-0 rounded-full"
                />
                <span>{speakerLabel}</span>
                <span className="font-mono text-[11px] opacity-75">
                  (V-{voiceTheme.index + 1})
                </span>
              </span>
            </>
          )}

          {!voiceOk && (
            <>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-[var(--warning)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>بدون صدا</span>
              </span>
            </>
          )}
        </div>

        {/* Uniform Dim Toolbar Icons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveSegment(segment.id, 'up')}
            disabled={idx === 0}
            title="انتقال به بالا"
            aria-label="انتقال به بالا"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMoveSegment(segment.id, 'down')}
            disabled={idx === totalSegments - 1}
            title="انتقال به پایین"
            aria-label="انتقال به پایین"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDuplicateSegment(segment.id)}
            title="تکثیر پاراگراف"
            aria-label="تکثیر پاراگراف"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemoveSegment(segment.id)}
            title="حذف پاراگراف"
            aria-label="حذف پاراگراف"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--danger-muted)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Prominent Velvet-Dark Textarea with Neutral Focus Ring */}
      <div className="relative">
        <textarea
          value={segment.text}
          onChange={(e) => onUpdateSegment(segment.id, { text: e.target.value }, false)}
          onBlur={() => onPushHistory()}
          placeholder="متن فارسی این پاراگراف را اینجا بنویسید..."
          rows={4}
          maxLength={CONFIG.MAX_CHAR_COUNT}
          disabled={segment.status === 'loading'}
          className={`w-full resize-y rounded-xl border bg-[var(--bg-input)] p-4 text-sm leading-7 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-200 focus:outline-none focus:ring-2 ${
            isOverLimit
              ? 'border-[var(--danger)] focus:ring-[var(--danger-ring)]'
              : 'border-[var(--border-subtle)] focus:border-[var(--ui-accent)] focus:ring-[var(--focus-ring)]'
          }`}
        />
        {charCount > 0 && (
          <span className="pointer-events-none absolute bottom-3 left-3.5 font-mono text-xs text-[var(--text-muted)] tabular-nums">
            {charCount}/{CONFIG.MAX_CHAR_COUNT}
          </span>
        )}
      </div>

      {/* Preprocessed Text Preview Box */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-4 py-3 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-normal text-[var(--text-secondary)]">
            متن ارسالی به موتور {hasModifications ? '· پیش‌پردازش‌شده با نرمال‌سازی' : ''}
          </span>
          {hasModifications && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
              <Check className="h-3 w-3 text-[var(--ui-accent)]" />
              <span>نرمال‌سازی شده</span>
            </span>
          )}
        </div>
        <div
          className={`whitespace-pre-wrap break-words leading-relaxed ${
            prepared ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {prepared || '—'}
        </div>
      </div>

      {/* Controls Footer */}
      <div className="flex flex-col gap-3.5 border-t border-[var(--border-subtle)] pt-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center lg:gap-5">
          <label className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)] lg:justify-start">
            <span className="inline-flex shrink-0 items-center gap-1.5 font-normal text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                style={{ backgroundColor: voiceOk ? voiceTheme.cssVar : 'var(--warning)' }}
                className="h-2.5 w-2.5 shrink-0 rounded-full"
              />
              <span>گوینده:</span>
            </span>
            <select
              value={voiceOk ? segment.voiceId : ''}
              onChange={(e) => onUpdateSegment(segment.id, { voiceId: e.target.value }, true)}
              disabled={segment.status === 'loading'}
              aria-invalid={!voiceOk}
              className={`min-w-0 flex-1 rounded-xl border bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] transition-colors focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] lg:flex-initial ${
                voiceOk ? 'border-[var(--border-subtle)]' : 'border-[var(--warning)]'
              }`}
            >
              {!voiceOk && (
                <option value="" disabled>
                  — انتخاب صدا —
                </option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
            <span className="shrink-0 font-normal text-[var(--text-secondary)]">سرعت:</span>
            <span className="w-9 font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
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
              style={{
                background: `linear-gradient(to left, var(--ui-accent) ${ratePct}%, var(--border-subtle) ${ratePct}%)`,
              }}
              className="studio-range flex-1 cursor-pointer lg:w-24 lg:flex-initial"
            />
          </label>

          <label className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
            <span className="shrink-0 font-normal text-[var(--text-secondary)]">مکث آخر ویس:</span>
            <span className="w-14 font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
              {segment.pauseAfterMs || 0}ms
            </span>
            <input
              type="range"
              min="0"
              max="2000"
              step="50"
              value={pauseVal}
              onChange={(e) =>
                onUpdateSegment(segment.id, { pauseAfterMs: parseInt(e.target.value, 10) }, false)
              }
              onMouseUp={() => onPushHistory()}
              disabled={segment.status === 'loading'}
              style={{
                background: `linear-gradient(to left, var(--ui-accent) ${pausePct}%, var(--border-subtle) ${pausePct}%)`,
              }}
              className="studio-range flex-1 cursor-pointer lg:w-24 lg:flex-initial"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {segment.status === 'error' && segment.error && (
            <span className="text-xs text-[var(--danger)]" title={segment.error}>
              {segment.error.slice(0, 32)}
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
            className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all duration-200 ease-out sm:h-9 sm:w-auto whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-45 ${
              segment.status === 'error'
                ? 'border border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger)] hover:brightness-110'
                : 'btn-gold hover:-translate-y-0.5'
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

      {/* Subtle Loading Progress Bar along bottom edge when converting */}
      {segment.status === 'loading' && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-[var(--bg-input)]"
        >
          <div className="h-full w-1/2 bg-gradient-to-l from-[var(--cta-from)] to-[var(--cta-to)] animate-shimmer-slide" />
        </div>
      )}
    </motion.div>
  );
});
