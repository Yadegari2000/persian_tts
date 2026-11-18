import React, { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, Users, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { resolveVoiceVisualTheme } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { Voice } from '../types/tts';
import * as audioEngine from '../utils/audioEngine';

interface SidebarVoicesProps {
  onAddVoice: () => void;
  onEditVoice: (voice: Voice) => void;
}

export const SidebarVoices = React.memo(function SidebarVoices({
  onAddVoice,
  onEditVoice,
}: SidebarVoicesProps) {
  const {
    voices,
    allTags,
    tagFilter,
    segments,
    setTagFilter,
    deleteVoice,
    showConfirm,
    showToast,
    registerPlayingAudio,
  } = useTts();

  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const activeVoiceIds = useMemo(
    () => new Set(segments.map((s) => s.voiceId).filter(Boolean)),
    [segments]
  );

  const filteredVoices = useMemo(() => {
    const { selectedTags, mode, untagged } = tagFilter;
    if (untagged) {
      return voices.filter((v) => !v.tags || v.tags.length === 0);
    }
    if (selectedTags.length === 0) return voices;
    return voices.filter((voice) => {
      const vTags = voice.tags || [];
      return mode === 'AND'
        ? selectedTags.every((t) => vTags.includes(t))
        : selectedTags.some((t) => vTags.includes(t));
    });
  }, [voices, tagFilter]);

  const toggleTag = (tag: string) => {
    const current = tagFilter.selectedTags;
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setTagFilter({ selectedTags: next, untagged: false });
  };

  const selectAllTags = () => {
    setTagFilter({ selectedTags: [], untagged: false });
  };

  const handlePreviewVoice = async (voice: Voice) => {
    setPreviewingId(voice.id);
    try {
      const sampleText = `این پیش‌شنود نمونه برای صدای ${voice.name} است.`;
      const url = await audioEngine.previewVoiceAudio(voice.engineVoice, sampleText);
      const audio = new Audio(url);
      registerPlayingAudio(audio);
      await audio.play();
    } catch (err: unknown) {
      showToast(`خطا در پیش‌شنود: ${(err as Error).message}`, 'error');
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDeleteVoice = async (voice: Voice) => {
    if (voices.length <= 1) {
      showToast('حداقل یک صدا باید در سیستم باقی بماند.', 'warning');
      return;
    }

    const affected = segments.filter((s) => s.voiceId === voice.id);
    let confirmMsg = `آیا از حذف صدای «${voice.name}» اطمینان دارید؟`;
    if (affected.length > 0) {
      const dialogueCount = affected.filter((s) => s.characterName).length;
      confirmMsg =
        `این صدا در ${affected.length} پاراگراف استفاده شده است. پس از حذف، پاراگراف‌های عادی به صدای پیش‌فرض تغییر می‌یابند.` +
        (dialogueCount > 0
          ? ` همچنین ${dialogueCount} پاراگراف دیالوگ «بدون صدا» می‌شوند و تا انتخاب صدای جدید برای شخصیت‌ها تبدیل نخواهند شد.`
          : '') +
        ' کلیپ‌های قبلی کتابخانه دست‌نخورده باقی می‌مانند. آیا ادامه می‌دهید؟';
    }

    const ok = await showConfirm({
      title: 'حذف صدا',
      message: confirmMsg,
      confirmText: 'حذف صدا',
      danger: true,
    });

    if (ok) {
      const res = deleteVoice(voice.id);
      const notes: string[] = [];
      if (res.remappedCount) notes.push(`${res.remappedCount} پاراگراف به صدای پیش‌فرض رفت`);
      if (res.unassignedCount) notes.push(`${res.unassignedCount} پاراگراف دیالوگ بدون صدا شد`);
      showToast(
        `صدای «${voice.name}» حذف شد.${notes.length ? ` (${notes.join('، ')})` : ''}`,
        res.unassignedCount ? 'warning' : 'info'
      );
    }
  };

  const isAllActive = tagFilter.selectedTags.length === 0 && !tagFilter.untagged;

  return (
    <aside
      id="sidebar-voices"
      aria-label="بانک گویندگان"
      className="flex scroll-mt-20 flex-col gap-4 min-[900px]:sticky min-[900px]:top-24 min-[900px]:max-h-[calc(100vh-7rem)] min-[900px]:overflow-y-auto min-[900px]:pl-1"
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-[var(--ui-accent)]" />
            <h2 className="text-base font-bold text-[var(--text-primary)] sm:text-lg">بانک گویندگان</h2>
          </div>
          <p className="mt-0.5 text-xs font-normal text-[var(--text-secondary)] tabular-nums">
            {voices.length} گوینده فعال
          </p>
        </div>

        <button
          type="button"
          onClick={onAddVoice}
          className="btn-gold inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs transition-all duration-200 ease-out hover:-translate-y-0.5 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>صدای جدید</span>
        </button>
      </div>

      {/* Smart Tag Filter Chips */}
      <section className="glass-card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">فیلتر هوشمند تگ‌ها</span>
          <button
            type="button"
            onClick={() => setTagFilter({ mode: tagFilter.mode === 'OR' ? 'AND' : 'OR' })}
            title="تغییر منطق فیلتر (OR / AND)"
            className="btn-studio-secondary rounded-lg px-2.5 py-0.5 font-mono text-xs font-medium transition-colors duration-200"
          >
            {tagFilter.mode}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllTags}
            className={`rounded-lg px-3 py-1 text-xs transition-all duration-200 ease-out whitespace-nowrap shrink-0 ${
              isAllActive
                ? 'border border-[var(--border-strong)] bg-[var(--bg-hover)] font-semibold text-[var(--text-primary)]'
                : 'border border-[var(--border-subtle)] bg-transparent font-normal text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
            }`}
          >
            همه
          </button>

          {allTags.map((tag) => {
            const active = tagFilter.selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-lg px-3 py-1 text-xs transition-all duration-200 ease-out whitespace-nowrap shrink-0 ${
                  active
                    ? 'border border-[var(--border-strong)] bg-[var(--bg-hover)] font-semibold text-[var(--text-primary)]'
                    : 'border border-[var(--border-subtle)] bg-transparent font-normal text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      {/* Voice List (Single Column, 12px gap) */}
      <section className="flex flex-col gap-3">
        {filteredVoices.length === 0 ? (
          <div className="glass-card flex flex-col items-center gap-2 p-6 text-center">
            <Users className="h-8 w-8 stroke-[1.4] text-[var(--text-muted)]" />
            <p className="text-xs font-normal text-[var(--text-secondary)]">
              صدایی با تگ‌های انتخابی یافت نشد.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filteredVoices.map((voice, idx) => {
              const initialChar = (voice.name || 'گ').trim().charAt(0);
              const isSelected = activeVoiceIds.has(voice.id);
              const isEnabled = voice.enabled !== false;
              const voiceTheme = resolveVoiceVisualTheme(voices, {
                voiceId: voice.id,
                fallbackColor: voice.color,
                fallbackIndex: idx,
              });

              return (
                <motion.div
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{
                    duration: 0.2,
                    delay: Math.min(idx * 0.035, 0.18),
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  key={voice.id}
                  className={`glass-card group flex flex-col gap-3 p-4 transition-colors duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] ${
                    isSelected ? 'border-[var(--border-strong)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* Solid Speaker Identity Avatar with speaker color and dark text */}
                      <div
                        aria-hidden="true"
                        style={{ backgroundColor: voiceTheme.cssVar }}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[var(--cta-text)] shadow-sm"
                      >
                        {initialChar}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${
                              isEnabled ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'
                            }`}
                            title={isEnabled ? 'فعال' : 'غیرفعال'}
                          >
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                isEnabled ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'
                              }`}
                            />
                            <span className="sr-only">{isEnabled ? 'فعال' : 'غیرفعال'}</span>
                          </span>
                          <div className="truncate text-sm font-bold text-[var(--text-primary)]">
                            {voice.name}
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 truncate font-mono text-xs text-[var(--text-muted)]">
                          <span className="truncate">{voice.engineVoice}</span>
                          <span className="text-[var(--text-muted)]">·</span>
                          <span>V-{voiceTheme.index + 1}</span>
                          <span className="font-sans text-xs text-[var(--text-muted)]">
                            · {isEnabled ? 'فعال' : 'غیرفعال'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Dim Actions Until Hover */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity duration-200 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => handlePreviewVoice(voice)}
                        disabled={previewingId === voice.id}
                        title="پیش‌شنود صدا"
                        aria-label="پیش‌شنود صدا"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                      >
                        {previewingId === voice.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ui-accent)]" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditVoice(voice)}
                        title="ویرایش صدا"
                        aria-label="ویرایش صدا"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVoice(voice)}
                        title="حذف صدا"
                        aria-label="حذف صدا"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--danger-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {voice.tags && voice.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {voice.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)]/70 px-2.5 py-0.5 text-xs text-[var(--text-secondary)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </section>
    </aside>
  );
});
