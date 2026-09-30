import { cx } from '../../lib/cx';
import type { Mark, PublicPlayer } from '../../lib/protocol';

interface CheerBarProps {
  seats: Record<Mark, PublicPlayer | null>;
  cheers: Record<string, number>;
  /** Spectators: who they cheer for, and how to change it. Players only see the bar. */
  supports?: string | null;
  onCheer?: (playerId: string | null) => void;
  disabled?: boolean;
  className?: string;
}

/** Fans in the stands for each side, X (coral, left) against O (blue, right). */
export function CheerBar({ seats, cheers, supports, onCheer, disabled, className }: CheerBarProps) {
  const x = seats.X;
  const o = seats.O;
  if (!x || !o) return null;
  const fx = cheers[x.id] ?? 0;
  const fo = cheers[o.id] ?? 0;
  const total = fx + fo;
  const share = total ? Math.round((fx / total) * 100) : 50;

  const side = (p: PublicPlayer, fans: number, mark: Mark) => {
    const mine = supports === p.id;
    const label = (
      <>
        <span className="truncate">{onCheer ? (mine ? `Đang cổ vũ ${p.name}` : `Cổ vũ ${p.name}`) : p.name}</span>
        <span className="tabular shrink-0 opacity-80">· {fans}</span>
      </>
    );
    const tone = mark === 'X' ? 'text-coral-600' : 'text-brand-600';
    if (!onCheer) return <span className={cx('flex min-w-0 items-center gap-1', tone, mark === 'O' && 'flex-row-reverse')}>{label}</span>;
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={mine}
        onClick={() => onCheer(mine ? null : p.id)}
        className={cx(
          'flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 transition-all disabled:opacity-60',
          mark === 'O' && 'flex-row-reverse',
          mine
            ? mark === 'X'
              ? 'bg-coral-500 text-white shadow-sm'
              : 'bg-brand-500 text-white shadow-sm'
            : cx('bg-white ring-1 hover:-translate-y-0.5', mark === 'X' ? 'text-coral-600 ring-coral-200' : 'text-brand-600 ring-brand-200'),
        )}
      >
        {mine && <span aria-hidden="true">📣</span>}
        {label}
      </button>
    );
  };

  return (
    <div className={cx('flex w-full max-w-xl items-center gap-2 text-xs font-bold', className)} aria-label={`Khán giả cổ vũ: ${x.name} ${fx}, ${o.name} ${fo}`}>
      <div className="min-w-0 flex-1">{side(x, fx, 'X')}</div>
      <div className="relative h-2 w-20 shrink-0 overflow-hidden rounded-full bg-brand-400 sm:w-32" aria-hidden="true">
        <div className="h-full rounded-full bg-coral-400 transition-[width] duration-500 ease-out" style={{ width: `${share}%` }} />
      </div>
      <div className="flex min-w-0 flex-1 justify-end">{side(o, fo, 'O')}</div>
    </div>
  );
}
