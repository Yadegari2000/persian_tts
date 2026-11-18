import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTts } from '../context/TtsContext';
import type { ToastType } from '../types/tts';

const TYPE_STYLES: Record<ToastType, { border: string; icon: typeof Info; color: string }> = {
  info: { border: 'border-[var(--border-strong)]', icon: Info, color: 'text-[var(--ui-accent)]' },
  success: { border: 'border-[var(--success-border)]', icon: CheckCircle2, color: 'text-[var(--success)]' },
  error: { border: 'border-[var(--danger-border)]', icon: XCircle, color: 'text-[var(--danger)]' },
  warning: { border: 'border-[var(--warning-border)]', icon: AlertTriangle, color: 'text-[var(--warning)]' },
};

export const ToastContainer = React.memo(function ToastContainer() {
  const { toasts, dismissToast } = useTts();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-3 top-20 z-[100] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 sm:left-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const cfg = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
          const Icon = cfg.icon;
          return (
            <motion.div
              layout="position"
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              key={toast.id}
              role="alert"
              className={`glass-card pointer-events-auto flex items-start gap-2.5 ${cfg.border} bg-[var(--bg-panel)] px-3.5 py-3 text-sm text-[var(--text-primary)] shadow-2xl`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`} />
              <span className="flex-1 text-xs leading-relaxed sm:text-sm">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="بستن پیام"
                className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
