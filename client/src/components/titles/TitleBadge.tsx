import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cx } from '../../lib/cx';
import { RARITY_STYLE } from '../achievements/rarity';
import { TITLE_RARITY_LABEL, type PublicTitle, type TitleRarity } from '../../lib/titles';
import { titleSkin, type TitleSkin } from './titleSkins';
import './titles.css';

export type TitleBadgeSize = 'sm' | 'md' | 'lg';
/** `on`: always animated. `hover`: only while it (or a `.tb-hover-host` ancestor) is hovered or focused. `off`: static. */
export type TitleMotion = 'on' | 'hover' | 'off';

/**
 * A title next to a player's name. Handles the icon, the rarity palette, the
 * effect, truncation and motion (see titles.css); every screen uses this, so
 * a title looks the same everywhere.
 *
 * A title with artwork (titleSkins.ts) draws its plate instead of the pill:
 * static base, animated overlay on top, the name above both.
 *
 * `title: null` draws the masked "secret title" badge. Lists of many badges
 * should pass `motion="hover"` so only the one being looked at moves.
 */
export function TitleBadge({
  title,
  size = 'sm',
  motion = 'on',
  locked = false,
  className,
}: {
  title: PublicTitle | null;
  size?: TitleBadgeSize;
  motion?: TitleMotion;
  /** Not owned yet: drained colours. */
  locked?: boolean;
  className?: string;
}) {
  const rarity: TitleRarity = title?.rarity ?? 'secret';
  const name = title?.name ?? '???';
  const label = `Danh hiệu ${TITLE_RARITY_LABEL[rarity]}: ${title ? name : 'bí mật'}`;
  const tooltip = title ? `${name} · ${TITLE_RARITY_LABEL[rarity]}${title.description ? ` — ${title.description}` : ''}` : 'Danh hiệu bí mật';
  const skin = titleSkin(title?.id);
  // A missing or broken file falls back to the pill rather than an empty frame.
  const [broken, setBroken] = useState<string | null>(null);

  if (title && skin && broken !== skin.base) {
    return (
      <ArtTitleBadge
        skin={skin}
        name={name}
        size={size}
        motion={motion}
        locked={locked}
        className={className}
        tooltip={tooltip}
        label={label}
        onBroken={() => setBroken(skin.base)}
      />
    );
  }
  return (
    <span
      className={cx('title-badge', `tb-${size}`, `tb-${rarity}`, title && `tb-fx-${title.effect}`, locked && 'tb-locked', className)}
      data-motion={title ? motion : 'off'}
      title={tooltip}
      aria-label={label}
      role="img"
    >
      <span className="tb-face">
        <span className="tb-icon" aria-hidden>
          {title?.icon ?? '❓'}
        </span>
        <span className="tb-text">{name}</span>
      </span>
    </span>
  );
}

/**
 * The artwork plate. Both images share one box at the canvas aspect ratio, so
 * the overlay lines up with the base at any size; the name sits in the safe
 * zone on top. The overlay only exists while the badge may move (see
 * titles.css), otherwise the base alone is the still picture.
 */
function ArtTitleBadge({
  skin,
  name,
  size,
  motion,
  locked,
  className,
  tooltip,
  label,
  onBroken,
}: {
  skin: TitleSkin;
  name: string;
  size: TitleBadgeSize;
  motion: TitleMotion;
  locked: boolean;
  className?: string;
  tooltip: string;
  label: string;
  onBroken: () => void;
}) {
  const text = useRef<HTMLSpanElement>(null);
  useFitText(text, name);
  // The overlay is only light and glow: on its own (base still decoding) it reads as a washed-out plate.
  // "Loaded" is not "painted" with async decoding, so wait for the decode itself.
  const [baseReady, setBaseReady] = useState<string | null>(null);
  const whenDecoded = useCallback(
    (img: HTMLImageElement) => {
      const src = skin.base;
      void img
        .decode()
        .catch(() => {})
        .then(() => setBaseReady(src));
    },
    [skin.base],
  );
  const base = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) whenDecoded(img);
    },
    [whenDecoded],
  );
  const style = {
    '--tb-aspect': skin.aspect,
    '--tb-zx': `${skin.zone.x * 100}%`,
    '--tb-zy': `${skin.zone.y * 100}%`,
    '--tb-zw': `${skin.zone.w * 100}%`,
    '--tb-zh': `${skin.zone.h * 100}%`,
    ...(skin.textColor ? { '--tb-art-fg': skin.textColor } : {}),
    ...(skin.textShadow ? { '--tb-art-shadow': skin.textShadow } : {}),
  } as CSSProperties;
  return (
    <span className={cx('title-badge tb-art', `tb-${size}`, locked && 'tb-locked', className)} data-motion={motion} style={style} title={tooltip} aria-label={label} role="img">
      <img ref={base} className="tb-art-base" src={skin.base} alt="" draggable={false} decoding="async" onLoad={(e) => whenDecoded(e.currentTarget)} onError={onBroken} />
      {skin.overlay && baseReady === skin.base && (
        <img
          className="tb-art-overlay"
          src={skin.overlay}
          alt=""
          draggable={false}
          decoding="async"
          style={skin.blend ? { mixBlendMode: skin.blend as CSSProperties['mixBlendMode'] } : undefined}
        />
      )}
      <span ref={text} className="tb-art-text" aria-hidden>
        <span>{name}</span>
      </span>
    </span>
  );
}

/**
 * Sets the largest font size at which `text` fits its box, on one line or,
 * when that would be much smaller, two. Re-fits when the box resizes or the
 * web font arrives.
 */
function useFitText(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = () => el.scrollWidth <= el.clientWidth + 0.5 && el.scrollHeight <= el.clientHeight + 0.5;
    const largest = (max: number) => {
      let lo = 4;
      let hi = max;
      el.style.fontSize = `${hi}px`;
      if (fits()) return hi;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const fit = () => {
      const h = el.clientHeight;
      if (!h) return;
      el.dataset.wrap = '0';
      const single = largest(h * 0.8);
      el.dataset.wrap = '1';
      const wrapped = largest(h * 0.46);
      const oneLine = single >= wrapped * 0.85;
      el.dataset.wrap = oneLine ? '0' : '1';
      el.style.fontSize = `${oneLine ? single : wrapped}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [ref, text]);
}

/** "EPIC", "SECRET", … in the rarity's colours. `suffix` e.g. "danh hiệu". */
export function TitleRarityChip({ rarity, suffix, className }: { rarity: TitleRarity; suffix?: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-extrabold tracking-wide uppercase ring-1', RARITY_STYLE[rarity].chip, className)}>
      {TITLE_RARITY_LABEL[rarity]}
      {suffix && <span className="ml-1 opacity-70">{suffix}</span>}
    </span>
  );
}
