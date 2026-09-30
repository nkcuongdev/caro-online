import type { FloatingHype } from '../../hooks/useStands';
import { cx } from '../../lib/cx';
import type { Mark } from '../../lib/protocol';
import { StickerArt } from './StickerPicker';

/** Where a float rises: fans of X on the left (X's card side), fans of O on the right, neutrals in between. */
const LANES: Record<Mark | 'none', [number, number]> = { X: [6, 30], O: [70, 26], none: [38, 24] };

interface HypeLayerProps {
  items: FloatingHype[];
  /** Which side a player sits on, to float fans' reactions from their player's side. */
  sideOf?: (playerId: string) => Mark | null;
  className?: string;
}

/**
 * Emoji and stickers from the stands rising over the board, like hearts on a
 * live stream. Purely decorative: it never takes clicks, so it can't get in
 * the way of a move.
 */
export function HypeLayer({ items, sideOf, className }: HypeLayerProps) {
  if (!items.length) return null;
  return (
    <div className={cx('pointer-events-none absolute inset-0 z-20 overflow-hidden', className)} aria-hidden="true">
      {items.map((h) => {
        const side = (h.supports && sideOf?.(h.supports)) || null;
        const [from, span] = LANES[side ?? 'none'];
        return (
          <div
            key={h.id}
            className="hype-item absolute bottom-10 flex flex-col items-center"
            style={{ left: `${from + h.lane * span}%`, animationDelay: `${Math.round(h.lane * 120)}ms` }}
          >
            {h.sticker ? (
              <StickerArt id={h.sticker} className="h-14 w-14 drop-shadow-[0_6px_10px_rgb(15_23_42/0.18)] sm:h-16 sm:w-16" />
            ) : (
              <span className="text-3xl drop-shadow-[0_4px_6px_rgb(15_23_42/0.15)] sm:text-4xl">{h.emoji}</span>
            )}
            <span
              className={cx(
                'mt-0.5 max-w-24 truncate rounded-full px-1.5 py-px text-[10px] font-bold shadow-sm',
                h.mine
                  ? 'bg-slate-800 text-white'
                  : side === 'X'
                    ? 'bg-coral-500 text-white'
                    : side === 'O'
                      ? 'bg-brand-500 text-white'
                      : 'bg-white/90 text-slate-500',
              )}
            >
              {h.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
