import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';

/**
 * Bottom sheet for chat / voice / reactions on phones and tablets. It covers
 * the lower part of the screen only, so the player cards (and the reactions
 * popping over them) stay visible above it.
 */
export function CommsDrawer({ open, onClose, children, title = 'Giao lưu' }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="comms-title">
      <div className="animate-fade-in absolute inset-0 bg-slate-900/15" onClick={onClose} />
      <div className="animate-sheet-up absolute inset-x-0 bottom-0 mx-auto flex h-[68dvh] max-w-xl flex-col gap-2.5 rounded-t-[28px] bg-slate-50 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lift ring-1 ring-slate-200">
        <div className="mx-auto h-1.5 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between px-1">
          <h2 id="comms-title" className="font-display text-lg font-bold text-slate-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-600"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
