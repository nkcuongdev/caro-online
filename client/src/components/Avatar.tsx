import { useState, type ReactNode } from 'react';
import { avatarSrc, defaultAvatarFor } from '../lib/avatar';
import { cx } from '../lib/cx';
import { initials } from '../lib/game';

interface AvatarImageProps {
  avatar: string | null | undefined;
  /** Picks the fallback preset (usually the player id), so it's the same on every screen. */
  seed: string;
  name: string;
  /** Size, shape and background. */
  className?: string;
  /**
   * Layers drawn over the avatar and allowed to overhang it (the avatar frame,
   * see AvatarWithFrame). The picture itself stays clipped to the avatar's shape.
   */
  children?: ReactNode;
}

/**
 * A player's avatar. Falls back to their default preset when the image is
 * missing or fails to load (deleted upload, storage offline…), and to their
 * initials if even that fails.
 */
export function AvatarImage({ avatar, seed, name, className, children }: AvatarImageProps) {
  const [broken, setBroken] = useState<string[]>([]);
  const candidates = [avatarSrc(avatar), defaultAvatarFor(seed).src].filter((s): s is string => !!s && !broken.includes(s));
  const src = candidates[0] ?? null;

  const face = src ? (
    <img
      key={src}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken((b) => [...b, src])}
      className="h-full w-full object-cover"
    />
  ) : (
    <span className="grid h-full w-full place-items-center bg-gradient-to-br from-brand-300 to-brand-500 font-display font-bold text-white">{initials(name)}</span>
  );

  if (!children) {
    return (
      // Decorative: the name is always shown next to it.
      <span aria-hidden="true" className={cx('relative block shrink-0 overflow-hidden bg-slate-100 select-none', className)}>
        {face}
      </span>
    );
  }
  // With an overlay the clip moves one level in, so the overlay can reach past the edge.
  return (
    <span aria-hidden="true" className={cx('relative block shrink-0 bg-slate-100 select-none', className)}>
      <span className="block h-full w-full overflow-hidden rounded-[inherit]">{face}</span>
      {children}
    </span>
  );
}
