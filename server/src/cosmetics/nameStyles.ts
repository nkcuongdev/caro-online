import type { Rarity } from './rarity.js';

/**
 * The name style catalogue: plain data, the only place a style's name, rarity,
 * price and unlock rule live. The server resolves everything from here; clients
 * only ever send a style id. The look itself is a CSS class on the client
 * (client/src/lib/nameStyles.ts maps each id to it), so no CSS is ever stored
 * or accepted from anyone.
 *
 * Ids are stored in the database (`users.name_style_id`, `user_cosmetics`):
 * never rename or reuse one. Removing a style is safe: anyone who had it
 * equipped falls back to `default`.
 *
 * Styles unlocked by an achievement are linked from the achievement's side
 * (`reward.nameStyleId` in achievements/definitions.ts), so the link is
 * written down once.
 */

export type NameStyleType = 'solid' | 'gradient' | 'animated-gradient' | 'glow' | 'shimmer' | 'special';

/**
 * - `default`: everyone owns it, always.
 * - `coin`: bought with coins for `price`.
 * - `achievement`: granted by the achievement whose reward names it.
 * - `event`: granted by hand / a future event; can't be bought.
 * - `secret`: like `achievement`, but the style and its condition stay hidden until owned.
 */
export type NameStyleUnlock = 'default' | 'coin' | 'achievement' | 'event' | 'secret';

export interface NameStyleDefinition {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  type: NameStyleType;
  unlock: NameStyleUnlock;
  /** Coins, for `unlock: 'coin'` only. */
  price?: number;
  /** Masked (name, description, unlock) for players who don't own it. */
  hidden?: boolean;
}

export const DEFAULT_NAME_STYLE = 'default';

export const NAME_STYLE_LIST: readonly NameStyleDefinition[] = [
  // ─── Common: one flat colour ───────────────────────────────────────────────
  { id: 'default', name: 'Mặc định', description: 'Tên hiển thị như bình thường.', rarity: 'common', type: 'solid', unlock: 'default' },
  { id: 'ocean_blue', name: 'Xanh Đại Dương', description: 'Xanh biển sâu, gọn gàng dễ đọc.', rarity: 'common', type: 'solid', unlock: 'coin', price: 500 },
  { id: 'emerald', name: 'Ngọc Lục Bảo', description: 'Xanh ngọc tươi mát.', rarity: 'common', type: 'solid', unlock: 'coin', price: 500 },
  { id: 'rose', name: 'Hồng Nhung', description: 'Đỏ hồng nổi bật mà vẫn nhẹ nhàng.', rarity: 'common', type: 'solid', unlock: 'coin', price: 500 },

  // ─── Rare: static gradients, a soft glow ───────────────────────────────────
  { id: 'mystic_gradient', name: 'Huyền Bí', description: 'Chuyển sắc tím sang hồng.', rarity: 'rare', type: 'gradient', unlock: 'coin', price: 1500 },
  { id: 'sunset_gradient', name: 'Hoàng Hôn', description: 'Cam, đỏ và tím của buổi chiều tà.', rarity: 'rare', type: 'gradient', unlock: 'coin', price: 1500 },
  { id: 'ice_glow', name: 'Băng Giá', description: 'Xanh băng với ánh sáng lạnh nhè nhẹ.', rarity: 'rare', type: 'glow', unlock: 'achievement' },

  // ─── Epic: slow motion, shimmer, neon ──────────────────────────────────────
  { id: 'neon_cyan', name: 'Neon Cyan', description: 'Đèn neon xanh, sáng lên rồi dịu xuống.', rarity: 'epic', type: 'glow', unlock: 'coin', price: 3000 },
  { id: 'purple_shimmer', name: 'Ánh Tím', description: 'Một vệt sáng lướt qua tên vài giây một lần.', rarity: 'epic', type: 'shimmer', unlock: 'coin', price: 3500 },
  { id: 'golden_shimmer', name: 'Ánh Kim', description: 'Ánh vàng của nhà vô địch.', rarity: 'epic', type: 'shimmer', unlock: 'achievement' },

  // ─── Legendary: special effects, still easy to read ────────────────────────
  { id: 'rainbow', name: 'Cầu Vồng', description: 'Bảy sắc cầu vồng trôi chậm qua tên.', rarity: 'legendary', type: 'animated-gradient', unlock: 'achievement' },
  { id: 'galaxy', name: 'Thiên Hà', description: 'Tinh vân chuyển động, lấp lánh ánh sao.', rarity: 'legendary', type: 'special', unlock: 'achievement' },
  { id: 'royal_gold', name: 'Hoàng Kim', description: 'Vàng ròng hoàng gia với ánh sáng lướt qua.', rarity: 'legendary', type: 'special', unlock: 'coin', price: 5000 },

  // ─── Secret ────────────────────────────────────────────────────────────────
  { id: 'void', name: 'Hư Không', description: 'Bóng tối nuốt trọn ánh sáng. Chỉ dành cho những ai đã chạm tới giới hạn.', rarity: 'secret', type: 'special', unlock: 'secret', hidden: true },
];

/** A Map, not an object: an id like `constructor` or `__proto__` must never resolve to something. */
const BY_ID: ReadonlyMap<string, NameStyleDefinition> = new Map(NAME_STYLE_LIST.map((s) => [s.id, s]));

/** The style with this id, or null (unknown id, wrong type). */
export function getNameStyle(id: unknown): NameStyleDefinition | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** A style id that is safe to show: the given one if it exists, else `default`. */
export function resolveNameStyleId(id: unknown): string {
  return getNameStyle(id)?.id ?? DEFAULT_NAME_STYLE;
}

/** Can be bought with coins (and has a price). Secret styles never are. */
export const isPurchasable = (s: NameStyleDefinition) => s.unlock === 'coin' && typeof s.price === 'number' && s.price > 0 && s.rarity !== 'secret';
