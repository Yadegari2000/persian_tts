import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { CONFIG } from '../config/config';
import { useTts } from '../context/TtsContext';
import type { Voice } from '../types/tts';

export function ConfirmModal() {
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

  if (!confirmState) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-md rounded-2xl border border-sky-400/50 bg-[#0f172a] p-5 shadow-2xl"
      >
        <h3 id="confirm-modal-title" className="border-b border-[#223254] pb-3 text-base font-bold text-slate-50">
          {confirmState.title || 'تأیید عملیات'}
        </h3>
        <p className="py-4 text-sm leading-relaxed text-slate-300">{confirmState.message}</p>
        <div className="flex justify-end gap-2.5 border-t border-[#223254] pt-3">
          <button
            type="button"
            onClick={() => confirmState.resolve(false)}
            className="rounded-lg border border-[#223254] bg-[#131d35] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400"
          >
            {confirmState.cancelText || 'انصراف'}
          </button>
          <button
            type="button"
            onClick={() => confirmState.resolve(true)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold text-white ${
              confirmState.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            {confirmState.confirmText || 'تأیید'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface VoiceModalProps {
  open: boolean;
  editingVoice: Voice | null;
  onClose: () => void;
}

export function VoiceModal({ open, editingVoice, onClose }: VoiceModalProps) {
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

  if (!open) return null;

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-modal-title"
        className="w-full max-w-lg rounded-2xl border border-sky-400/50 bg-[#0f172a] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#223254] pb-3">
          <h3 id="voice-modal-title" className="text-base font-bold text-slate-50">
            {editingVoice ? 'ویرایش صدا' : 'افزودن صدای جدید'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-[#131d35] hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-slate-300">نام نمایشی صدا:</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً: سهراب (روایت آرام)"
              required
              className="rounded-lg border border-[#223254] bg-[#0b1329] px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-slate-300">صدای فنی موتور (Engine Voice):</span>
            <select
              value={engineVoice}
              onChange={(e) => setEngineVoice(e.target.value)}
              required
              className="rounded-lg border border-[#223254] bg-[#0b1329] px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
            >
              {CONFIG.ENGINE_VOICES.map((ev) => (
                <option key={ev.engineVoice} value={ev.engineVoice}>
                  {ev.name} ({ev.engineVoice})
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-slate-300">تگ‌ها (با اینتر یا کامای فارسی «،» اضافه کنید):</span>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              list="tag-suggestions-list"
              placeholder="تایپ کنید و اینتر بزنید..."
              className="rounded-lg border border-[#223254] bg-[#0b1329] px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
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
                  className="inline-flex items-center gap-1 rounded-md border border-[#223254] bg-[#131d35] px-2.5 py-1 text-xs text-slate-200"
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    aria-label="حذف تگ"
                    className="text-slate-400 hover:text-rose-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 border-t border-[#223254] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#223254] bg-[#131d35] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400"
            >
              انصراف
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
            >
              ذخیره صدا
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SplitTextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { autoSplitText, showToast } = useTts();
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  if (!open) return null;

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-modal-title"
        className="w-full max-w-lg rounded-2xl border border-sky-400/50 bg-[#0f172a] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#223254] pb-3">
          <h3 id="split-modal-title" className="text-base font-bold text-slate-50">
            تقسیم خودکار متن به پاراگراف‌ها
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-[#131d35] hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-slate-400">
            متن بلند خود را در کادر زیر وارد کنید. متن بر اساس خط‌های خالی (Double Enter) به پاراگراف‌های مجزا تقسیم خواهد شد:
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="متن بلند خود را اینجا پیست کنید..."
            className="w-full resize-y rounded-lg border border-[#223254] bg-[#0b1329] p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2.5 border-t border-[#223254] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#223254] bg-[#131d35] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
          >
            اعمال و تقسیم متن
          </button>
        </div>
      </div>
    </div>
  );
}

export function DictionaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dictionary, addDictionaryEntry, deleteDictionaryEntry, showToast } = useTts();
  const [phrase, setPhrase] = useState('');
  const [replacement, setReplacement] = useState('');

  if (!open) return null;

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dict-modal-title"
        className="w-full max-w-xl rounded-2xl border border-sky-400/50 bg-[#0f172a] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#223254] pb-3">
          <h3 id="dict-modal-title" className="text-base font-bold text-slate-50">
            دیکشنری تلفظ کلمات و اختصارات
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-md p-1 text-slate-400 hover:bg-[#131d35] hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          کلمات، اختصارات یا اصطلاحاتی که می‌خواهید قبل از ارسال به موتور تبدیل گفتار تغییر کنند را اینجا تعریف کنید.
        </p>

        <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="عبارت مبدأ (مثلاً TTS)"
            required
            className="min-w-[140px] flex-1 rounded-lg border border-[#223254] bg-[#0b1329] px-3 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
          />
          <span className="text-xs text-slate-500">←</span>
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="تلفظ جایگزین (مثلاً تی‌تی‌اس)"
            required
            className="min-w-[140px] flex-1 rounded-lg border border-[#223254] bg-[#0b1329] px-3 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            + افزودن
          </button>
        </form>

        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-[#223254] bg-[#0b1329] p-2">
          {dictionary.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">هنوز مدخلی در دیکشنری ثبت نشده است.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {dictionary.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#223254] bg-[#131d35] px-3 py-2 text-xs"
                >
                  <strong className="flex-1 text-slate-100">{entry.phrase}</strong>
                  <span className="text-slate-500">←</span>
                  <span className="flex-1 font-semibold text-sky-400">{entry.replacement}</span>
                  <button
                    type="button"
                    onClick={() => deleteDictionaryEntry(entry.id)}
                    title="حذف مدخل"
                    aria-label="حذف مدخل"
                    className="rounded p-1 text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-[#223254] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#223254] bg-[#131d35] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
