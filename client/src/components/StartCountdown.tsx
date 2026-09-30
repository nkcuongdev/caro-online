import { useEffect, useRef } from 'react';
import { useServerNow } from '../lib/clock';
import { sfx } from '../lib/sound';

/** 3 → 2 → 1 → Start, derived from the server's `startAt` so both players see it in sync. */
export function StartCountdown({ startAt, onDone }: { startAt: number; onDone?: () => void }) {
  const now = useServerNow(80);
  const left = startAt - now;
  const showStart = left <= 0 && left > -800;
  const n = Math.ceil(left / 1000);

  const lastShown = useRef<string | null>(null);
  const label = left > 0 ? String(n) : showStart ? 'Bắt đầu!' : null;

  useEffect(() => {
    if (!label || lastShown.current === label) return;
    lastShown.current = label;
    sfx.countdown(label === 'Bắt đầu!');
  }, [label]);

  useEffect(() => {
    if (!label) onDone?.();
  }, [label, onDone]);

  if (!label) return null;
  return (
    <div className="pointer-events-none flex flex-col items-center" aria-live="assertive">
      <div className="mb-3 rounded-full bg-white/90 px-4 py-1 font-display text-sm font-semibold text-slate-500 shadow-soft">
        Chuẩn bị!
      </div>
      <div
        key={label}
        className={
          'animate-count-pop font-display font-bold drop-shadow-[0_6px_18px_rgb(37_99_235/0.25)] ' +
          (label === 'Bắt đầu!' ? 'text-6xl text-emerald-500 sm:text-7xl' : 'text-8xl text-brand-500 sm:text-9xl')
        }
      >
        {label}
      </div>
    </div>
  );
}
