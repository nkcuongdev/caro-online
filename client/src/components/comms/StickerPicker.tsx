import { useState } from 'react';
import { cx } from '../../lib/cx';
import { STICKER_PACKS, STICKERS, stickerById, type StickerPack } from '../../lib/stickers';
import { CaroSticker } from './CaroSticker';

/** Renders any sticker by id. Unknown ids (e.g. from a newer client) render nothing. */
export function StickerArt({ id, className }: { id: string; className?: string }) {
  const s = stickerById(id);
  if (!s) return null;
  if (s.pack === 'caro') return <CaroSticker slug={id.slice('caro:'.length)} className={className} />;
  return <img src={s.src} alt={s.label} title={s.label} draggable={false} loading="lazy" decoding="async" className={cx('object-contain select-none', className)} />;
}

const TAB_KEY = 'caro:sticker-tab';

function loadTab(): StickerPack {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'noto' || v === 'fluent' || v === 'caro' ? v : 'noto';
  } catch {
    return 'noto';
  }
}

interface StickerPickerProps {
  onPick: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Sticker tray shown between the message list and the input, like a keyboard panel. */
export function StickerPicker({ onPick, disabled, className }: StickerPickerProps) {
  const [tab, setTab] = useState<StickerPack>(loadTab);
  const pick = (next: StickerPack) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const pack = STICKER_PACKS.find((p) => p.pack === tab)!;

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div role="tablist" aria-label="Bộ sticker" className="flex shrink-0 gap-1 px-1 pb-1.5">
        {STICKER_PACKS.map((p) => (
          <button
            key={p.pack}
            type="button"
            role="tab"
            aria-selected={tab === p.pack}
            onClick={() => pick(p.pack)}
            className={cx(
              'rounded-full px-3 py-1 font-display text-xs font-bold transition-colors',
              tab === p.pack ? 'bg-brand-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-brand-50 hover:text-brand-600',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={`Sticker ${pack.label}`}
        className={cx('board-scroll grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] content-start gap-1 overflow-y-auto px-1', disabled && 'opacity-50')}
      >
        {STICKERS.filter((s) => s.pack === tab).map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.id)}
            aria-label={`Gửi sticker ${s.label}`}
            title={s.label}
            className="grid aspect-square place-items-center rounded-2xl p-1 transition-transform duration-150 enabled:hover:scale-110 enabled:hover:bg-brand-50 enabled:active:scale-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed"
          >
            <StickerArt id={s.id} className="h-full w-full" />
          </button>
        ))}
      </div>
      {pack.credit && <p className="shrink-0 px-1 pt-1 text-right text-[10px] font-semibold text-slate-300">{pack.credit}</p>}
    </div>
  );
}
