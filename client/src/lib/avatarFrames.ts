import { useSyncExternalStore } from 'react';
import type { Rarity } from './rarity';

/**
 * Avatar frames, client side.
 *
 * The catalogue (names, rarity, prices, unlock rules) lives on the server
 * (server/src/cosmetics/avatarFrames.ts) and reaches the client through
 * `/api/me/avatar-frames`; ownership and the equipped frame are decided there
 * too. This file only knows how each frame *looks*. Players and participants
 * carry a frame id (`avatarFrame`), and `<AvatarWithFrame>` turns it into a
 * decorative layer (styles/avatarFrames.css).
 */

export const DEFAULT_AVATAR_FRAME = 'frame_default';

export interface AvatarFrameVisual {
  /** Drives how much the frame moves (common: still … legendary / secret: animated). */
  rarity: Rarity;
  /** CSS modifier: `af--<variant>` in styles/avatarFrames.css. */
  variant: string;
  /** Extra decoration drawn above the ring. */
  ornament?: 'crown' | 'stars';
  /**
   * Artwork in public/avatar-frames/ (256×256, transparent WebP/PNG). When
   * set, it is drawn over the CSS frame, which stays as the fallback if the
   * file fails to load. None are bundled yet: every frame is CSS-only for now.
   */
  asset?: string;
}

/**
 * id → look. `frame_default` has none: the avatar shows exactly as before.
 * Unknown ids (a newer server) also render without a frame.
 */
const VISUALS: ReadonlyMap<string, AvatarFrameVisual | null> = new Map<string, AvatarFrameVisual | null>([
  [DEFAULT_AVATAR_FRAME, null],
  ['frame_wood', { rarity: 'common', variant: 'wood' }],
  ['frame_ocean', { rarity: 'rare', variant: 'ocean' }],
  ['frame_neon', { rarity: 'rare', variant: 'neon' }],
  ['frame_fire', { rarity: 'epic', variant: 'fire' }],
  ['frame_crystal', { rarity: 'epic', variant: 'crystal', ornament: 'stars' }],
  ['frame_champion', { rarity: 'legendary', variant: 'champion' }],
  ['frame_crown', { rarity: 'legendary', variant: 'crown', ornament: 'crown' }],
  ['frame_nebula', { rarity: 'secret', variant: 'nebula', ornament: 'stars' }],
]);

/** A frame id safe to render: unknown, missing or retired ids fall back to the default. */
export function resolveAvatarFrameId(id: string | null | undefined): string {
  return id && VISUALS.has(id) ? id : DEFAULT_AVATAR_FRAME;
}

/** The look of a frame id, or null for "no frame" (a Map lookup: an id can never inject a class or a path). */
export const avatarFrameVisual = (id: string | null | undefined): AvatarFrameVisual | null => VISUALS.get(resolveAvatarFrameId(id)) ?? null;

/** Asset URL, built only from the catalogue above, never from a player-supplied id. */
export const avatarFrameAssetSrc = (v: AvatarFrameVisual) => (v.asset ? `${import.meta.env.BASE_URL}avatar-frames/${v.asset}` : null);

// ─── API shapes (server/src/cosmetics/avatarFrameService.ts) ──────────────────

export type AvatarFrameUnlock = 'default' | 'coin' | 'achievement' | 'event' | 'secret';

/** One card of the collection. Secret frames the player doesn't own come masked. */
export interface AvatarFrameView {
  id: string;
  /** "???" while secret. */
  name: string;
  description: string;
  rarity: Rarity;
  asset: string | null;
  unlock: AvatarFrameUnlock;
  /** Coins; null when it can't be bought. */
  price: number | null;
  /** The achievement that grants it (never set while secret, or for a hidden achievement). */
  achievement: { id: string; name: string } | null;
  secret: boolean;
  owned: boolean;
  equipped: boolean;
}

export interface AvatarFrameState {
  ownedAvatarFrames: string[];
  equippedAvatarFrame: string;
  coins: number;
}

export interface AvatarFrameOverview extends AvatarFrameState {
  frames: AvatarFrameView[];
}

// ─── Motion preference ───────────────────────────────────────────────────────

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeMotion(fn: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
const reducedNow = () => typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED).matches;

/** True when the player asked the OS for less motion (the CSS also honours it on its own). */
export const useReducedMotion = () => useSyncExternalStore(subscribeMotion, reducedNow, () => false);
