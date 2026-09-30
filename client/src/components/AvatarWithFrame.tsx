import { memo, useState } from 'react';
import { avatarFrameAssetSrc, avatarFrameVisual, type AvatarFrameVisual } from '../lib/avatarFrames';
import { cx } from '../lib/cx';
import { AvatarImage } from './Avatar';

/** Preset sizes; any other size comes through `className` as before. */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 rounded-lg text-[10px]',
  sm: 'h-8 w-8 rounded-[10px] text-xs',
  md: 'h-12 w-12 rounded-2xl text-lg',
  lg: 'h-16 w-16 rounded-2xl text-xl',
  xl: 'h-24 w-24 rounded-[28px] text-3xl',
};

interface AvatarWithFrameProps {
  avatar: string | null | undefined;
  /** An avatar frame id from the server (`PublicPlayer.avatarFrame`, …). Unknown / missing = no frame. */
  frameId?: string | null;
  seed: string;
  name: string;
  size?: AvatarSize;
  /** Size, shape and background, like AvatarImage. Wins over `size`. */
  className?: string;
  /** False keeps the frame still: for dense lists (bracket, chat) where many avatars share the screen. */
  animated?: boolean;
}

/**
 * The avatar every screen uses: AvatarImage plus, when the player wears one,
 * an AvatarFrameLayer on top. The frame is purely decorative (inside the
 * avatar's aria-hidden box), overhangs the avatar by a fixed share of its
 * size, and never changes its crop or layout. `frame_default` (and guests,
 * bots, old servers) renders exactly the plain avatar.
 */
export const AvatarWithFrame = memo(function AvatarWithFrame({ avatar, frameId, seed, name, size, className, animated = true }: AvatarWithFrameProps) {
  const visual = avatarFrameVisual(frameId);
  return (
    <AvatarImage avatar={avatar} seed={seed} name={name} className={cx(size && SIZE[size], className)}>
      {visual && <AvatarFrameLayer visual={visual} animated={animated} />}
    </AvatarImage>
  );
});

/** The frame alone. `mystery` draws the placeholder for a secret frame the viewer hasn't unlocked. */
export function AvatarFrameLayer({ visual, animated = true }: { visual: AvatarFrameVisual | 'mystery'; animated?: boolean }) {
  const [asset, setAsset] = useState<'loading' | 'ok' | 'failed'>('loading');
  if (visual === 'mystery') {
    return (
      <span className="af af--mystery af-static">
        <span className="af-ring" />
      </span>
    );
  }
  const src = asset !== 'failed' ? avatarFrameAssetSrc(visual) : null;
  return (
    <span className={cx('af', `af--${visual.rarity}`, `af--${visual.variant}`, !animated && 'af-static', src && asset === 'ok' && 'af-has-asset')}>
      <span className="af-glow" />
      <span className="af-ring">{(visual.rarity === 'legendary' || visual.rarity === 'secret') && <span className="af-sheen" />}</span>
      {visual.ornament === 'stars' && (
        <span className="af-stars">
          <i />
          <i />
          <i />
        </span>
      )}
      {visual.ornament === 'crown' && <CrownOrnament />}
      {src && (
        // A broken file must never take the avatar with it: it just falls back to the CSS frame.
        <img src={src} alt="" draggable={false} decoding="async" className="af-asset" onLoad={() => setAsset('ok')} onError={() => setAsset('failed')} />
      )}
    </span>
  );
}

function CrownOrnament() {
  return (
    <svg className="af-crown" viewBox="0 0 64 40" aria-hidden="true">
      <defs>
        <linearGradient id="af-crown-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <path d="M4 34 L8 8 L22 22 L32 4 L42 22 L56 8 L60 34 Z" fill="url(#af-crown-gold)" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" />
      <rect x="4" y="32" width="56" height="6" rx="2" fill="#b45309" />
      <circle cx="32" cy="20" r="3.5" fill="#f43f5e" />
      <circle cx="17" cy="25" r="2.5" fill="#38bdf8" />
      <circle cx="47" cy="25" r="2.5" fill="#38bdf8" />
    </svg>
  );
}
