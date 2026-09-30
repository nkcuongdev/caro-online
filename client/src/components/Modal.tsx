import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';
import { Button } from './ui';

export function Modal({ open, onClose, children, className, labelledBy }: { open: boolean; onClose?: () => void; children: ReactNode; className?: string; labelledBy?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current?.();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="animate-fade-in absolute inset-0 bg-slate-900/25 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={panelRef} className={cx('animate-pop-in relative w-full max-w-sm rounded-[28px] bg-white p-6 shadow-lift ring-1 ring-slate-200/70', className)}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title" className="font-display text-xl font-bold text-slate-800">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel} data-autofocus>
          Hủy
        </Button>
        <Button
          variant="primary"
          className={tone === 'danger' ? 'from-coral-400! to-coral-600! shadow-[0_6px_16px_-6px_rgb(226_82_58/0.55)]!' : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
