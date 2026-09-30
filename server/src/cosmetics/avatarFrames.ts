import type { Rarity } from './rarity.js';

/**
 * The avatar frame catalogue: plain data, the only place a frame's name,
 * rarity, price and unlock rule live. A frame is a decorative layer drawn
 * around a player's avatar; the look itself is CSS (or an optional image) on
 * the client, keyed by id (client/src/lib/avatarFrames.ts). Clients only ever
 * send a frame id; nothing else about a frame is accepted from them.
 *
 * Ids are stored in the database (`users.avatar_frame_id`, `user_cosmetics`
 * with kind `avatar_frame`) and sent over the wire: never rename or reuse one.
 * Removing a frame is safe: anyone wearing it falls back to `frame_default`.
 *
 * Frames granted by an achievement are linked from the achievement's side
 * (`rewards: [avatarFrame('frame_crystal')]` in achievements/definitions.ts),
 * so the link is written down once.
 */

export type AvatarFrameUnlock =
  /** Everyone owns it, guests included, without a database row. */
  | { type: 'default' }
  /** Bought with coins. The price is read from here, never from a request. */
  | { type: 'coin'; price: number }
  /** Granted, once, by the achievement whose rewards name it. */
  | { type: 'achievement' }
  /** Granted by an event (a season, a holiday…). Can't be bought; nothing grants these yet. */
  | { type: 'event'; eventId: string }
  /** Like `achievement`, but the frame and its condition stay hidden until owned. */
  | { type: 'secret' };

export type AvatarFrameUnlockType = AvatarFrameUnlock['type'];

export interface AvatarFrameDefinition {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /**
   * Optional artwork: a file name in client/public/avatar-frames/ (256×256,
   * transparent WebP/PNG), mirrored in the client catalogue. Without it the
   * client draws the frame in CSS. Never built from user input.
   */
  asset?: string;
  unlock: AvatarFrameUnlock;
}

export const DEFAULT_AVATAR_FRAME = 'frame_default';

/** Seed prices in coins, in one place so they are easy to tune. */
export const AVATAR_FRAME_PRICES = {
  frame_wood: 500,
  frame_ocean: 1_500,
  frame_neon: 2_000,
  frame_fire: 3_000,
} as const;

export const AVATAR_FRAMES: readonly AvatarFrameDefinition[] = [
  { id: DEFAULT_AVATAR_FRAME, name: 'Mặc định', description: 'Avatar nguyên bản, không viền trang trí.', rarity: 'common', unlock: { type: 'default' } },
  { id: 'frame_wood', name: 'Gỗ Mộc', description: 'Viền gỗ mộc mạc, giản dị mà chắc chắn.', rarity: 'common', unlock: { type: 'coin', price: AVATAR_FRAME_PRICES.frame_wood } },
  { id: 'frame_ocean', name: 'Đại Dương', description: 'Sóng biển xanh mát ôm trọn avatar.', rarity: 'rare', unlock: { type: 'coin', price: AVATAR_FRAME_PRICES.frame_ocean } },
  { id: 'frame_neon', name: 'Neon', description: 'Ánh đèn neon rực rỡ của phố đêm.', rarity: 'rare', unlock: { type: 'coin', price: AVATAR_FRAME_PRICES.frame_neon } },
  { id: 'frame_fire', name: 'Hỏa Diệm', description: 'Khung avatar rực cháy dành cho những kỳ thủ nổi bật.', rarity: 'epic', unlock: { type: 'coin', price: AVATAR_FRAME_PRICES.frame_fire } },
  { id: 'frame_crystal', name: 'Pha Lê', description: 'Pha lê tím lấp lánh, phần thưởng cho bậc thầy Caro.', rarity: 'epic', unlock: { type: 'achievement' } },
  { id: 'frame_champion', name: 'Hào Quang', description: 'Hào quang vàng của huyền thoại năm trăm chiến thắng.', rarity: 'legendary', unlock: { type: 'achievement' } },
  { id: 'frame_crown', name: 'Vương Miện', description: 'Dành riêng cho người đã đăng quang một giải đấu.', rarity: 'legendary', unlock: { type: 'achievement' } },
  { id: 'frame_nebula', name: 'Tinh Vân', description: 'Một mảnh vũ trụ trôi quanh avatar. Chỉ những ván cờ dài bất tận mới gọi được nó.', rarity: 'secret', unlock: { type: 'secret' } },
];

/** A Map, not an object: an id like `constructor` or `__proto__` must never resolve to something. */
const BY_ID: ReadonlyMap<string, AvatarFrameDefinition> = new Map(AVATAR_FRAMES.map((f) => [f.id, f]));

/** The frame with this id, or null (unknown id, wrong type, a path, markup…). */
export function getAvatarFrame(id: unknown): AvatarFrameDefinition | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** A frame id that is safe to show: the given one if it exists, else `frame_default`. */
export function resolveAvatarFrameId(id: unknown): string {
  return getAvatarFrame(id)?.id ?? DEFAULT_AVATAR_FRAME;
}

/** Owned by everyone without a database row. */
export const isDefaultFrame = (f: AvatarFrameDefinition) => f.unlock.type === 'default';

/** Details withheld until owned. */
export const isSecretFrame = (f: AvatarFrameDefinition) => f.rarity === 'secret' || f.unlock.type === 'secret';

/** Coin price when the frame can be bought, else null. Secret frames never are. */
export function framePrice(f: AvatarFrameDefinition): number | null {
  if (f.unlock.type !== 'coin' || isSecretFrame(f)) return null;
  return Number.isInteger(f.unlock.price) && f.unlock.price > 0 ? f.unlock.price : null;
}
