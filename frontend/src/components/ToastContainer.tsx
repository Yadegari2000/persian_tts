import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useTts } from '../context/TtsContext';
import type { ToastType } from '../types/tts';

const TYPE_STYLES: Record<ToastType, { border: string; icon: typeof Info; color: string }> = {
  info: { border: 'border-sky-500/50', icon: Info, color: 'text-sky-400' },
  success: { border: 'border-emerald-500/50', icon: CheckCircle2, color: 'text-emerald-400' },
  error: { border: 'border-rose-500/50', icon: XCircle, color: 'text-rose-400' },
  warning: { border: 'border-amber-500/50', icon: AlertTriangle, color: 'text-amber-400' },
};

export function ToastContainer() {
  const { toasts, dismissToast } = useTts();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed left-4 top-20 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const cfg = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
        const Icon = cfg.icon;
        return (
          <div
            key={toast.id}
            role="alert"
            className={`flex items-start gap-2.5 rounded-xl border ${cfg.border} bg-[#131d35] px-3.5 py-3 text-sm text-slate-100 shadow-xl`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`} />
            <span className="flex-1 text-xs leading-relaxed sm:text-sm">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="بستن پیام"
              className="rounded p-0.5 text-slate-400 hover:bg-[#0b1329] hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
