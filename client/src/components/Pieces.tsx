import type { Mark } from '../lib/protocol';
import { cx } from '../lib/cx';

interface PieceProps {
  className?: string;
  /** Play the draw-on animation (only for the newest move). */
  animate?: boolean;
  strokeWidth?: number;
}

export function XPiece({ className, animate, strokeWidth = 5.5 }: PieceProps) {
  return (
    <svg viewBox="0 0 40 40" className={cx('text-coral-500', animate && 'piece-draw', className)} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" style={{ ['--len' as string]: 26 }}>
        <path d="M11 11 29 29" />
        <path d="M29 11 11 29" />
      </g>
    </svg>
  );
}

export function OPiece({ className, animate, strokeWidth = 5 }: PieceProps) {
  return (
    <svg viewBox="0 0 40 40" className={cx('text-brand-500', animate && 'piece-draw', className)} aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
        style={{ ['--len' as string]: 66 }}
      />
    </svg>
  );
}

export function Piece({ mark, ...rest }: PieceProps & { mark: Mark }) {
  return mark === 'X' ? <XPiece {...rest} /> : <OPiece {...rest} />;
}

/** Small colored chip showing X or O. */
export function MarkBadge({ mark, className }: { mark: Mark | null; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center justify-center rounded-full font-display font-bold leading-none',
        mark === 'X' && 'bg-coral-100 text-coral-600',
        mark === 'O' && 'bg-brand-100 text-brand-600',
        !mark && 'bg-slate-100 text-slate-400',
        className,
      )}
    >
      {mark ?? '?'}
    </span>
  );
}
