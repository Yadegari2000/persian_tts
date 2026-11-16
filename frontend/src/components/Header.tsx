import React, { useRef } from 'react';
import { BookOpen, Download, Menu, Mic2, Redo2, Undo2, Upload } from 'lucide-react';
import { useTts } from '../context/TtsContext';

interface HeaderProps {
  onToggleDrawer: () => void;
  onOpenDict: () => void;
}

export function Header({ onToggleDrawer, onOpenDict }: HeaderProps) {
  const { canUndo, canRedo, undo, redo, exportProjectJSON, importProjectJSON, showConfirm, showToast } = useTts();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        showToast(`پروژه (نسخه ${res.version}) با ${res.segmentCount} پاراگراف و ${res.clipCount} کلیپ بازیابی شد.`, 'success');
      } catch (err: unknown) {
        showToast(`خطا در بازیابی پروژه: ${(err as Error).message}`, 'error');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#182338] bg-[#0b111e]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-3 px-4 py-3.5 sm:px-6">
        {/* Top Row: Brand Lockup */}
        <div className="flex w-full items-center justify-between gap-4 lg:justify-center">
          <button
            type="button"
            onClick={onToggleDrawer}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#223254] bg-[#131d35] text-slate-200 hover:border-sky-400 lg:hidden"
            aria-label="نمایش بانک گویندگان"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 to-sky-600/20 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.18)]">
              <Mic2 className="h-5 w-5" />
            </div>
            <div className="text-right">
              <h1 className="text-base font-extrabold tracking-tight text-slate-50 sm:text-lg">
                استودیو تبدیل متن به گفتار فارسی چندصدایی
              </h1>
              <p className="text-xs text-slate-400">
                ترکیب گویندگان هوشمند، پیش‌پردازش متن، حالت دیالوگ و ادغام حرفه‌ای صدا
              </p>
            </div>
          </div>

          <div className="w-10 lg:hidden" />
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="واگرد تغییرات پاراگراف‌ها (Ctrl+Z)"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131c31] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#1a2642] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Undo2 className="h-3.5 w-3.5 text-slate-400" />
            <span>واگرد (Ctrl+Z)</span>
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="انجام مجدد تغییرات پاراگراف‌ها (Ctrl+Y)"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131c31] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#1a2642] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Redo2 className="h-3.5 w-3.5 text-slate-400" />
            <span>مجدد (Ctrl+Y)</span>
          </button>

          <button
            type="button"
            onClick={onOpenDict}
            title="مدیریت دیکشنری تلفظ اختصاصی"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131c31] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#1a2642] whitespace-nowrap shrink-0"
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-400" />
            <span>دیکشنری تلفظ</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            title="صادرات تمام داده‌ها به صورت فایل JSON"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131c31] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/60 hover:bg-[#1a2642] whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" />
            <span>پشتیبان‌گیری</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="بارگذاری پروژه از فایل JSON"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#223254] bg-[#131c31] px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-emerald-400/60 hover:bg-[#1a2642] whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5 text-emerald-400" />
            <span>بازیابی</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />

          <span className="inline-flex h-7 items-center rounded-full border border-[#223254] bg-[#131c31] px-3 text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0">
            شبیه‌ساز MOCK فعال
          </span>
        </div>
      </div>
    </header>
  );
}
