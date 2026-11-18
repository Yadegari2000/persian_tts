import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Download,
  MoreVertical,
  Redo2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CONFIG } from '../config/config';
import { useTts } from '../context/TtsContext';

interface HeaderProps {
  onScrollToVoices: () => void;
  onOpenDict: () => void;
}

export const Header = React.memo(function Header({ onScrollToVoices, onOpenDict }: HeaderProps) {
  const {
    batch,
    canUndo,
    canRedo,
    undo,
    redo,
    exportProjectJSON,
    importProjectJSON,
    showConfirm,
    showToast,
  } = useTts();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [mobileMenuOpen]);

  const handleUndo = () => {
    if (undo()) {
      showToast('عملیات به حالت قبل بازگردانده شد (Undo).', 'info');
    }
  };

  const handleRedo = () => {
    if (redo()) {
      showToast('عملیات مجدداً اعمال شد (Redo).', 'info');
    }
  };

  const handleExport = () => {
    setMobileMenuOpen(false);
    try {
      const jsonStr = exportProjectJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `persian-tts-project-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('پروژه با موفقیت به صورت JSON صادر شد.', 'success');
    } catch (err: unknown) {
      showToast(`خطا در صادرات پروژه: ${(err as Error).message}`, 'error');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setMobileMenuOpen(false);
    const file = e.target.files?.[0];
    if (!file) return;

    const ok = await showConfirm({
      title: 'بازیابی پروژه (Import)',
      message:
        'بارگذاری این فایل، تمام داده‌های فعلی را جایگزین خواهد کرد. فایل‌های صوتی محلی با داده‌های پروژه بازیابی می‌شوند. آیا ادامه می‌دهید؟',
      confirmText: 'جایگزینی و بارگذاری',
      danger: true,
    });

    if (!ok) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const res = importProjectJSON(String(event.target?.result || ''));
        showToast(
          `پروژه (نسخه ${res.version}) با ${res.segmentCount} پاراگراف و ${res.clipCount} کلیپ بازیابی شد.`,
          'success'
        );
      } catch (err: unknown) {
        showToast(`خطا در بازیابی پروژه: ${(err as Error).message}`, 'error');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 min-[900px]:px-8">
        {/* Brand & Mobile Voice Bank Scroll Trigger */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onScrollToVoices}
            className="btn-studio-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ease-out min-[900px]:hidden"
            aria-label="نمایش بانک گویندگان"
          >
            <Users className="h-4 w-4" />
          </button>

          {/* Studio Emblem */}
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)]">
            <div className="flex h-4 items-end gap-[2.5px]" aria-hidden="true">
              <span
                className={`w-[2.5px] rounded-full bg-[var(--ui-accent)] ${
                  batch.active ? 'h-4 animate-eq-1' : 'h-2.5'
                }`}
              />
              <span
                className={`w-[2.5px] rounded-full bg-[var(--text-primary)] ${
                  batch.active ? 'h-4 animate-eq-2' : 'h-4'
                }`}
              />
              <span
                className={`w-[2.5px] rounded-full bg-[var(--text-muted)] ${
                  batch.active ? 'h-4 animate-eq-3' : 'h-3'
                }`}
              />
            </div>
          </div>

          <div className="min-w-0 text-right">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-[2.5px] shrink-0 rounded-full bg-[var(--ui-accent)]"
              />
              <h1 className="truncate text-base font-bold tracking-tight text-[var(--text-primary)] sm:text-lg">
                استودیو تبدیل متن به گفتار فارسی چندصدایی
              </h1>
            </div>
            <div className="hidden items-center gap-2 text-xs font-normal text-[var(--text-secondary)] sm:flex">
              <span>پیش‌پردازش هوشمند و ادغام چندصدایی</span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    CONFIG.MOCK ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'
                  }`}
                />
                <span className={CONFIG.MOCK ? 'text-[var(--warning)]' : 'text-[var(--success)]'}>
                  {CONFIG.MOCK ? 'شبیه‌ساز MOCK فعال' : 'متصل به سرور Backend'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Top Toolbar Buttons (Transparent, Icon + Small Text, 8px Gap) */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="واگرد تغییرات پاراگراف‌ها (Ctrl+Z)"
            aria-label="واگرد"
            className="btn-studio-secondary inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-medium transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="انجام مجدد تغییرات پاراگراف‌ها (Ctrl+Y)"
            aria-label="انجام مجدد"
            className="btn-studio-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">مجدد</span>
          </button>

          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={onOpenDict}
              title="مدیریت دیکشنری تلفظ اختصاصی"
              className="btn-studio-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out whitespace-nowrap shrink-0"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>دیکشنری تلفظ</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              title="صادرات تمام داده‌ها به صورت فایل JSON"
              className="btn-studio-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>پشتیبان‌گیری</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="بارگذاری پروژه از فایل JSON"
              className="btn-studio-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all duration-200 ease-out whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>بازیابی</span>
            </button>
          </div>

          {/* Mobile Overflow Tools Menu (< sm) */}
          <div ref={menuRef} className="relative sm:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="ابزارهای بیشتر"
              aria-expanded={mobileMenuOpen}
              className="btn-studio-secondary inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <MoreVertical className="h-4 w-4" />}
            </button>

            <AnimatePresence>
              {mobileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="glass-card absolute left-0 top-12 z-50 w-56 origin-top-left bg-[var(--bg-elevated)] p-2 shadow-2xl"
                >
                  <div className="mb-1.5 flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        CONFIG.MOCK ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'
                      }`}
                    />
                    <span>{CONFIG.MOCK ? 'شبیه‌ساز MOCK فعال' : 'متصل به سرور Backend'}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenDict();
                    }}
                    className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 text-right text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <BookOpen className="h-4 w-4" />
                    <span>دیکشنری تلفظ</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExport}
                    className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 text-right text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <Download className="h-4 w-4" />
                    <span>پشتیبان‌گیری JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 text-right text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <Upload className="h-4 w-4" />
                    <span>بازیابی پروژه</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>
    </header>
  );
});
