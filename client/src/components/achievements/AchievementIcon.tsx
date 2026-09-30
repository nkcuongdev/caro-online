import type { CSSProperties } from 'react';
import type { Rarity } from '../../lib/achievements';
import { cx } from '../../lib/cx';
import { stickerById } from '../../lib/stickers';
import { RARITY_STYLE } from './rarity';

/**
 * An achievement's art: its sticker on a rarity-tinted tile. Locked ones are
 * drained of colour; secret ones show a "?" instead of the art.
 */
export function AchievementIcon({
  icon,
  rarity,
  state,
  glow,
  className,
}: {
  icon: string | null;
  rarity: Rarity;
  state: 'unlocked' | 'locked' | 'secret';
  /** Pulsing halo, for the unlock popup. */
  glow?: boolean;
  className?: string;
}) {
  const style = RARITY_STYLE[rarity];
  const sticker = icon ? stickerById(icon) : undefined;
  return (
    <span
      className={cx(
        'relative isolate grid shrink-0 place-items-center rounded-2xl ring-1',
        state === 'unlocked' ? style.tile : 'bg-slate-50 ring-slate-200',
        state === 'unlocked' && 'ach-halo',
        glow && 'ach-halo-pulse',
        className,
      )}
      style={{ '--ach-glow': style.glow } as CSSProperties}
    >
      {state === 'secret' || !sticker?.src ? (
        <span className="font-display text-2xl font-extrabold text-slate-300 select-none">?</span>
      ) : (
        <img
          src={sticker.src}
          alt=""
          draggable={false}
          // The popup shows at once; the page grid can load as it scrolls.
          loading={glow ? 'eager' : 'lazy'}
          decoding="async"
          className={cx('h-[70%] w-[70%] object-contain select-none', state === 'locked' && 'ach-locked-art')}
        />
      )}
    </span>
  );
}
