import type { Rarity } from './rarity';

/**
 * Name styles, client side.
 *
 * The catalogue (names, rarity, prices, unlock rules) lives on the server
 * (server/src/cosmetics/nameStyles.ts) and reaches the client through
 * `/api/me/name-styles`; ownership and the equipped style are decided there
 * too. This file only knows how each style *looks*: its CSS class
 * (styles/nameStyles.css). Players and participants carry a style id, and
 * `<PlayerName>` turns it into the class.
 */

export const DEFAULT_NAME_STYLE = 'default';

/** id → CSS class. `default` has none: the name keeps the colour of wherever it's shown. */
const NAME_STYLE_CLASS: ReadonlyMap<string, string> = new Map([
  ['default', ''],
  ['ocean_blue', 'ns ns-ocean-blue'],
  ['emerald', 'ns ns-emerald'],
  ['rose', 'ns ns-rose'],
  ['mystic_gradient', 'ns ns-mystic'],
  ['sunset_gradient', 'ns ns-sunset'],
  ['ice_glow', 'ns ns-ice'],
  ['neon_cyan', 'ns ns-neon-cyan'],
  ['purple_shimmer', 'ns ns-purple-shimmer'],
  ['golden_shimmer', 'ns ns-golden-shimmer'],
  ['rainbow', 'ns ns-rainbow'],
  ['galaxy', 'ns ns-galaxy'],
  ['royal_gold', 'ns ns-royal-gold'],
  ['void', 'ns ns-void'],
]);

/** A style id safe to render: unknown, missing or retired ids fall back to `default`. */
export function resolveNameStyleId(id: string | null | undefined): string {
  return id && NAME_STYLE_CLASS.has(id) ? id : DEFAULT_NAME_STYLE;
}

/** The class for a style id (a Map lookup, so an id can never inject other classes). */
export const nameStyleClass = (id: string | null | undefined) => NAME_STYLE_CLASS.get(resolveNameStyleId(id)) ?? '';

// ─── API shapes (server/src/cosmetics/nameStyleService.ts) ────────────────────

export type NameStyleUnlock = 'default' | 'coin' | 'achievement' | 'event' | 'secret';

/** One card of the name style collection. Secret styles the player doesn't own come masked. */
export interface NameStyleView {
  id: string;
  /** "???" while secret. */
  name: string;
  description: string;
  rarity: Rarity;
  type: string;
  unlock: NameStyleUnlock;
  /** Coins; null when it can't be bought. */
  price: number | null;
  /** The achievement that grants it (never set for secret ones). */
  achievement: { id: string; name: string } | null;
  /** True while the details are withheld (hidden and not owned). */
  secret: boolean;
  owned: boolean;
  equipped: boolean;
}

export interface NameStyleOverview {
  styles: NameStyleView[];
  equipped: string;
  coins: number;
}

export type NameStyleErrorCode =
  | 'STYLE_NOT_FOUND'
  | 'STYLE_NOT_OWNED'
  | 'ALREADY_OWNED'
  | 'NOT_ENOUGH_COIN'
  | 'STYLE_LOCKED'
  | 'ACHIEVEMENT_REQUIRED'
  | 'INVALID_STYLE';
