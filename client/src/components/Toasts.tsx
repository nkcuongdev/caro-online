import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';

type Tone = 'info' | 'success' | 'warning' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const toneClass: Record<Tone, string> = {
  info: 'bg-white text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-orange-50 text-orange-700 ring-orange-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
};
const dotClass: Record<Tone, string> = {
  info: 'bg-brand-400',
  success: 'bg-emerald-500',
  warning: 'bg-orange-400',
  error: 'bg-red-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId.current++;
    // Collapse identical consecutive messages (e.g. repeated errors from spam clicks).
    setToasts((list) => [...list.filter((t) => t.message !== message), { id, message, tone }].slice(-3));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2800);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'animate-fade-up flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-soft ring-1',
              toneClass[t.tone],
            )}
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full', dotClass[t.tone])} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
