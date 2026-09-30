import { REACTIONS } from '../../lib/comms';
import { cx } from '../../lib/cx';
import type { ShownReaction } from '../../hooks/useReactions';
import { StickerArt } from './StickerPicker';

/**
 * Emoji floating over a player's avatar; the parent removes it after ~2s.
 * Render with `key={reaction.id}` so a new reaction restarts the animation.
 */
export function ReactionBubble({ reaction, className }: { reaction: ShownReaction; className?: string }) {
  if (reaction.sticker) {
    return (
      <span
        className={cx(
          'reaction-bubble animate-reaction pointer-events-none absolute z-10 drop-shadow-[0_8px_14px_rgb(15_23_42/0.18)]',
          'h-16 w-16 sm:h-20 sm:w-20 lg:h-24 lg:w-24',
          className,
        )}
      >
        <StickerArt id={reaction.sticker} className="h-full w-full" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`Biểu cảm ${reaction.emoji}`}
      className={cx(
        'reaction-bubble animate-reaction pointer-events-none absolute z-10 grid select-none place-items-center rounded-full bg-white shadow-lift ring-1 ring-slate-100',
        'h-11 w-11 text-2xl sm:h-12 sm:w-12 sm:text-[28px] lg:h-16 lg:w-16 lg:text-4xl',
        className,
      )}
    >
      {reaction.emoji}
    </span>
  );
}

interface PickerProps {
  onPick: (emoji: string) => void;
  coolingDown: boolean;
  disabled?: boolean;
  /** `grid`: all emoji in a wrapping grid (desktop panel). `row`: one scrollable line (mobile drawer). */
  variant?: 'grid' | 'row';
  className?: string;
}

export function ReactionPicker({ onPick, coolingDown, disabled, variant = 'grid', className }: PickerProps) {
  const off = disabled || coolingDown;
  return (
    <div className={cx('relative', className)}>
      <div
        className={cx(
          variant === 'grid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1'
            : 'board-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-1',
          off && 'opacity-50',
        )}
        role="group"
        aria-label="Gửi biểu cảm"
      >
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={off}
            onClick={() => onPick(emoji)}
            aria-label={`Gửi ${emoji}`}
            className={cx(
              'grid shrink-0 place-items-center rounded-xl text-xl leading-none transition-transform duration-150',
              'enabled:hover:-translate-y-0.5 enabled:hover:scale-110 enabled:hover:bg-brand-50 enabled:active:scale-90',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed',
              variant === 'grid' ? 'h-9' : 'h-10 w-10',
            )}
          >
            {emoji}
          </button>
        ))}
      </div>
      {/* Cooldown: a bar that drains while reactions are locked. */}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {coolingDown && <div className="animate-cooldown h-full origin-left rounded-full bg-brand-300" />}
      </div>
    </div>
  );
}
