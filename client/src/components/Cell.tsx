import { memo } from 'react';
import { cx } from '../lib/cx';
import type { Mark } from '../lib/protocol';
import { Piece } from './Pieces';

export interface CellProps {
  index: number;
  row: number;
  col: number;
  value: Mark | null;
  size: number;
  isWin: boolean;
  isLast: boolean;
  /** Mark shown as hover preview (and as the optimistic piece while a move is in flight). */
  ghost: Mark | null;
  pending: boolean;
  focusable: boolean;
}

/**
 * One board square. Memoized with primitive props so a move re-renders only
 * the handful of cells whose state actually changed.
 */
export const Cell = memo(function Cell({ index, row, col, value, size, isWin, isLast, ghost, pending, focusable }: CellProps) {
  const playable = !value && ghost !== null && !pending;
  return (
    <button
      type="button"
      data-index={index}
      tabIndex={focusable ? 0 : -1}
      aria-label={`Hàng ${row + 1}, cột ${col + 1}${value ? `, ${value}` : ''}${isLast ? ', nước vừa đánh' : ''}`}
      aria-disabled={!playable}
      className={cx(
        'group relative flex items-center justify-center outline-none transition-colors duration-150',
        'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset',
        playable ? 'cursor-pointer hover:bg-brand-50 active:bg-brand-100' : 'cursor-default',
        isLast && !isWin ? 'bg-amber-50' : 'bg-paper',
        isWin && 'animate-win-cell',
      )}
      style={{ width: size, height: size }}
    >
      {value && (
        <Piece
          mark={value}
          animate={isLast}
          className={cx('h-[80%] w-[80%] transition-transform duration-300', isWin && 'scale-110', isLast && 'animate-pop-in')}
        />
      )}
      {!value && pending && ghost && <Piece mark={ghost} className="h-[80%] w-[80%] animate-pop-in opacity-50" />}
      {playable && <Piece mark={ghost} className="h-[70%] w-[70%] opacity-0 transition-opacity duration-150 group-hover:opacity-25" />}
      {isLast && !isWin && <span className="absolute top-[3px] right-[3px] h-1.5 w-1.5 rounded-full bg-amber-400" />}
    </button>
  );
});
