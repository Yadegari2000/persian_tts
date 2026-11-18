import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CONFIG } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { Voice } from '../types/tts';

export const ConfirmModal = React.memo(function ConfirmModal() {
  const { confirmState } = useTts();

  useEffect(() => {
    if (!confirmState) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        confirmState.resolve(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmState]);

  return (
    <AnimatePresence>
      {confirmState && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-[var(--backdrop-modal)] p-3 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="glass-card w-full max-w-md bg-[var(--bg-elevated)] p-5 shadow-2xl"
          >
            <h3
              id="confirm-modal-title"
              className="border-b border-[var(--border-subtle)] pb-3 text-base font-bold text-[var(--text-primary)]"
            >
              {confirmState.title || 'تأیید عملیات'}
            </h3>
            <p className="py-4 text-sm font-normal leading-relaxed text-[var(--text-secondary)]">
              {confirmState.message}
            </p>
            <div className="flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-3">
              <button
                type="button"
                onClick={() => confirmState.resolve(false)}
                className="btn-studio-secondary min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium transition-colors"
              >
                {confirmState.cancelText || 'انصراف'}
              </button>
              <button
                type="button"
                onClick={() => confirmState.resolve(true)}
                className={`min-h-[40px] rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                  confirmState.danger
                    ? 'bg-[var(--danger)] text-[var(--cta-text)] hover:brightness-110'
                    : 'btn-gold'
                }`}
              >
                {confirmState.confirmText || 'تأیید'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

interface VoiceModalProps {
  open: boolean;
  editingVoice: Voice | null;
  onClose: () => void;
}

export const VoiceModal = React.memo(function VoiceModal({ open, editingVoice, onClose }: VoiceModalProps) {
  const { allTags, addVoice, updateVoice, showToast } = useTts();
  const [name, setName] = useState('');
  const [engineVoice, setEngineVoice] = useState(CONFIG.ENGINE_VOICES[0].engineVoice);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editingVoice) {
      setName(editingVoice.name);
      setEngineVoice(editingVoice.engineVoice);
      setTags([...(editingVoice.tags || [])]);
    } else {
      setName('');
      setEngineVoice(CONFIG.ENGINE_VOICES[0].engineVoice);
      setTags([]);
    }
    setTagInput('');
  }, [open, editingVoice]);

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === '،' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.replace(/[،,]/g, '').trim();
      if (val && !tags.includes(val)) {
        setTags((prev) => [...prev, val]);
        setTagInput('');
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('نام نمایشی صدا الزامی است.', 'warning');
      return;
    }

    if (editingVoice) {
      updateVoice(editingVoice.id, { name, engineVoice, tags });
      showToast('صدای مورد نظر به‌روزرسانی شد.', 'success');
    } else {
      addVoice({ name, engineVoice, tags });
      showToast(`صدای «${name.trim()}» با موفقیت افزوده شد.`, 'success');
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-[var(--backdrop-modal)] p-3 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-modal-title"
            className="glass-card max-h-[90dvh] w-full max-w-lg overflow-y-auto bg-[var(--bg-elevated)] p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 id="voice-modal-title" className="text-base font-bold text-[var(--text-primary)]">
                {editingVoice ? 'ویرایش صدا' : 'افزودن صدای جدید'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="بستن"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium text-[var(--text-secondary)]">نام نمایشی صدا:</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثلاً: سهراب (روایت آرام)"
                  required
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium text-[var(--text-secondary)]">صدای فنی موتور (Engine Voice):</span>
                <select
                  value={engineVoice}
                  onChange={(e) => setEngineVoice(e.target.value)}
                  required
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {CONFIG.ENGINE_VOICES.map((ev) => (
                    <option key={ev.engineVoice} value={ev.engineVoice} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                      {ev.name} ({ev.engineVoice})
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium text-[var(--text-secondary)]">
                  تگ‌ها (با اینتر یا کامای فارسی «،» اضافه کنید):
                </span>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  list="tag-suggestions-list"
                  placeholder="تایپ کنید و اینتر بزنید..."
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
                <datalist id="tag-suggestions-list">
                  {allTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>

                <div className="mt-1 flex min-h-[28px] flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                        aria-label="حذف تگ"
                        className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-studio-secondary min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="btn-gold min-h-[40px] rounded-xl px-5 py-2 text-xs transition-all duration-200"
                >
                  ذخیره صدا
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export const SplitTextModal = React.memo(function SplitTextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { autoSplitText, showToast } = useTts();
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const handleApply = () => {
    if (!text.trim()) {
      showToast('لطفاً متنی برای تقسیم خودکار وارد کنید.', 'warning');
      return;
    }
    autoSplitText(text);
    onClose();
    showToast('متن با موفقیت به پاراگراف‌ها تقسیم شد.', 'success');
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-[var(--backdrop-modal)] p-3 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="split-modal-title"
            className="glass-card max-h-[90dvh] w-full max-w-lg overflow-y-auto bg-[var(--bg-elevated)] p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 id="split-modal-title" className="text-base font-bold text-[var(--text-primary)]">
                تقسیم خودکار متن به پاراگراف‌ها
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="بستن"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <p className="text-xs font-normal leading-relaxed text-[var(--text-secondary)]">
                متن بلند خود را در کادر زیر وارد کنید. متن بر اساس خط‌های خالی (Double Enter) به پاراگراف‌های مجزا تقسیم خواهد شد:
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                placeholder="متن بلند خود را اینجا پیست کنید..."
                className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-studio-secondary min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium transition-colors"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="btn-gold min-h-[40px] rounded-xl px-5 py-2 text-xs transition-all duration-200"
              >
                اعمال و تقسیم متن
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export const DictionaryModal = React.memo(function DictionaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dictionary, addDictionaryEntry, deleteDictionaryEntry, showToast } = useTts();
  const [phrase, setPhrase] = useState('');
  const [replacement, setReplacement] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phrase.trim()) {
      showToast('کلمه یا عبارت مبدأ الزامی است.', 'warning');
      return;
    }
    addDictionaryEntry(phrase, replacement);
    showToast(`مدخل «${phrase.trim()}» به دیکشنری افزوده شد.`, 'success');
    setPhrase('');
    setReplacement('');
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-[var(--backdrop-modal)] p-3 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dict-modal-title"
            className="glass-card max-h-[90dvh] w-full max-w-xl overflow-y-auto bg-[var(--bg-elevated)] p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 id="dict-modal-title" className="text-base font-bold text-[var(--text-primary)]">
                دیکشنری تلفظ کلمات و اختصارات
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="بستن"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs font-normal leading-relaxed text-[var(--text-secondary)]">
              کلمات، اختصارات یا اصطلاحاتی که می‌خواهید قبل از ارسال به موتور تبدیل گفتار تغییر کنند را اینجا تعریف کنید.
            </p>

            <form onSubmit={handleAdd} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="عبارت مبدأ (مثلاً TTS)"
                required
                className="min-w-[140px] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
              <span className="hidden text-xs text-[var(--text-muted)] sm:inline">←</span>
              <input
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="تلفظ جایگزین (مثلاً تی‌تی‌اس)"
                required
                className="min-w-[140px] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
              <button
                type="submit"
                className="btn-gold min-h-[38px] rounded-xl px-4 py-2 text-xs transition-all duration-200 whitespace-nowrap shrink-0"
              >
                + افزودن
              </button>
            </form>

            <div className="mt-4 max-h-60 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2">
              {dictionary.length === 0 ? (
                <p className="py-5 text-center text-xs text-[var(--text-muted)]">
                  هنوز مدخلی در دیکشنری ثبت نشده است.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {dictionary.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs"
                    >
                      <strong className="flex-1 text-[var(--text-primary)]">{entry.phrase}</strong>
                      <span className="text-[var(--text-muted)]">←</span>
                      <span className="flex-1 font-medium text-[var(--text-primary)]">{entry.replacement}</span>
                      <button
                        type="button"
                        onClick={() => deleteDictionaryEntry(entry.id)}
                        title="حذف مدخل"
                        aria-label="حذف مدخل"
                        className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end border-t border-[var(--border-subtle)] pt-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-studio-secondary min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium transition-colors"
              >
                بستن
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
