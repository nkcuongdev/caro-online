import { useEffect, useRef } from 'react';
import { useServerNow } from '../lib/clock';
import { cx } from '../lib/cx';
import { formatClock } from '../lib/game';
import { sfx } from '../lib/sound';
import { TimerIcon } from './icons';

interface GameTimerProps {
  /** Server deadline for the current turn; null when this timer isn't running. */
  deadline: number | null;
  /** Time left on a frozen clock (the player on turn is offline); overrides `deadline`. */
  pausedMs?: number | null;
  turnMs: number;
  /** Play tick sounds in the final seconds (only for the local player's own clock). */
  tickSound?: boolean;
  className?: string;
}

/**
 * Pure view of the server deadline: remaining = deadline − estimated server
 * time. There is no local countdown state, so both players see the same value
 * (within network latency) and editing it in DevTools changes nothing.
 */
export function GameTimer({ deadline, pausedMs = null, turnMs, tickSound, className }: GameTimerProps) {
  const paused = pausedMs !== null;
  const active = deadline !== null && !paused;
  const now = useServerNow(200, active);
  const remaining = paused
    ? Math.max(0, Math.min(turnMs, pausedMs))
    : active
      ? Math.max(0, Math.min(turnMs, deadline - now))
      : turnMs;
  const secs = Math.ceil(remaining / 1000);
  const level = paused ? 'paused' : !active ? 'idle' : secs <= 5 ? 'critical' : secs <= 10 ? 'warn' : 'normal';

  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !tickSound || secs > 5 || secs <= 0) return;
    if (lastTick.current === secs) return;
    lastTick.current = secs;
    sfx.tick(secs <= 3);
  }, [active, tickSound, secs]);

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl px-3 py-2 transition-colors duration-300',
        level === 'idle' && 'bg-slate-100/80 text-slate-400',
        level === 'paused' && 'bg-amber-50 text-amber-600',
        level === 'normal' && 'bg-sky-100 text-sky-700',
        level === 'warn' && 'bg-orange-100 text-orange-600',
        level === 'critical' && 'bg-red-100 text-red-600',
        className,
      )}
      role="timer"
      aria-live={level === 'critical' ? 'assertive' : 'off'}
      aria-label={paused ? `Đồng hồ tạm dừng, còn ${secs} giây` : active ? `Còn ${secs} giây` : 'Đồng hồ đang dừng'}
      title={paused ? 'Tạm dừng trong lúc người chơi mất kết nối' : undefined}
    >
      <div
        className={cx(
          'flex items-center justify-center gap-1.5',
          level === 'warn' && 'animate-pulse-soft',
          level === 'critical' && 'animate-pulse-strong rounded-xl',
        )}
      >
        <TimerIcon size={16} className="shrink-0 opacity-70" />
        <span className="tabular font-display text-xl font-bold leading-none lg:text-3xl">{formatClock(remaining)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-200 ease-linear',
            level === 'idle' && 'bg-slate-300',
            level === 'paused' && 'bg-amber-300',
            level === 'normal' && 'bg-sky-400',
            level === 'warn' && 'bg-orange-400',
            level === 'critical' && 'bg-red-500',
          )}
          style={{ width: `${(remaining / turnMs) * 100}%` }}
        />
      </div>
    </div>
  );
}
