import type { AccountStore } from '../accounts/accountStore.js';
import type { AchievementDefinition } from '../achievements/definitions.js';
import {
  AVATAR_FRAMES,
  DEFAULT_AVATAR_FRAME,
  framePrice,
  isDefaultFrame,
  isSecretFrame,
  resolveAvatarFrameId,
  type AvatarFrameDefinition,
  type AvatarFrameUnlockType,
} from './avatarFrames.js';
import type { Rarity } from './rarity.js';

/**
 * Avatar frames for accounts: what exists (the catalogue), what a player owns
 * (`user_cosmetics`, kind `avatar_frame`), and what they wear
 * (`users.avatar_frame_id`). Every rule is checked here, on the server; a
 * client only ever names a frame id, never a price, a rarity or an ownership
 * claim.
 *
 *   exists (avatarFrames.ts) → owned (default / bought / granted) → equipped (one at a time)
 *
 * `frame_default` is owned by everyone without a row. Guests always wear it.
 */

export type AvatarFrameErrorCode =
  | 'FRAME_NOT_FOUND'
  | 'FRAME_NOT_OWNED'
  | 'ALREADY_OWNED'
  | 'NOT_ENOUGH_COIN'
  | 'FRAME_NOT_PURCHASABLE'
  | 'ACHIEVEMENT_REQUIRED'
  | 'INVALID_FRAME';

export const AVATAR_FRAME_ERROR_MESSAGES: Record<AvatarFrameErrorCode, string> = {
  FRAME_NOT_FOUND: 'Khung avatar không tồn tại.',
  FRAME_NOT_OWNED: 'Bạn chưa sở hữu khung này.',
  ALREADY_OWNED: 'Bạn đã sở hữu khung này.',
  NOT_ENOUGH_COIN: 'Không đủ Coin.',
  FRAME_NOT_PURCHASABLE: 'Khung này không thể mua bằng Coin.',
  ACHIEVEMENT_REQUIRED: 'Hoàn thành thành tích tương ứng để mở khóa khung này.',
  INVALID_FRAME: 'Mã khung avatar không hợp lệ.',
};

export class AvatarFrameError extends Error {
  constructor(
    readonly code: AvatarFrameErrorCode,
    message = AVATAR_FRAME_ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = 'AvatarFrameError';
  }
}

/** The achievement that grants a frame (derived from the achievement rewards, see app.ts). */
export interface AvatarFrameAchievementLink {
  id: string;
  name: string;
  /** A hidden achievement: its name is a secret too. */
  hidden: boolean;
}

/** One card of the collection, as the player sees it. Secret frames they don't own come masked. */
export interface AvatarFrameView {
  id: string;
  /** "???" while secret. */
  name: string;
  description: string;
  rarity: Rarity;
  /** Artwork file (client/public/avatar-frames/), null while secret or when the frame is drawn in CSS. */
  asset: string | null;
  /** `secret` while secret, whatever actually grants it. */
  unlock: AvatarFrameUnlockType;
  /** Coins; null when it can't be bought. */
  price: number | null;
  /** The achievement that grants it, when it may be named. */
  achievement: { id: string; name: string } | null;
  /** True while the details are withheld. */
  secret: boolean;
  owned: boolean;
  equipped: boolean;
}

/** Enough for a client to sync after any change. */
export interface AvatarFrameState {
  ownedAvatarFrames: string[];
  equippedAvatarFrame: string;
  coins: number;
}

export interface AvatarFrameOverview extends AvatarFrameState {
  frames: AvatarFrameView[];
}

/** Called after a player equipped a frame, so rooms and tournaments can show it live. */
export type AvatarFrameEquippedListener = (userId: string, avatarFrame: string) => void;

/**
 * frame id → the achievement whose rewards grant it. Achievements are the one
 * place the link is written (`rewards: [avatarFrame('frame_crystal')]`).
 */
export function avatarFrameLinks(defs: readonly AchievementDefinition[]): Map<string, AvatarFrameAchievementLink> {
  const links = new Map<string, AvatarFrameAchievementLink>();
  for (const def of defs) {
    for (const r of def.rewards ?? []) {
      if (r.type === 'avatarFrame' && !links.has(r.avatarFrameId)) links.set(r.avatarFrameId, { id: def.id, name: def.name, hidden: !!def.hidden });
    }
  }
  return links;
}

/** Ids are short catalogue slugs: anything else (paths, markup, huge strings) is refused before any lookup. */
const FRAME_ID = /^[a-z0-9_]{1,40}$/;
const SECRET_NAME = '???';
const SECRET_DESCRIPTION = 'Khung bí mật. Điều kiện mở khóa: ???';

type Store = Pick<AccountStore, 'getUser' | 'coins' | 'listCosmetics' | 'purchaseCosmetic' | 'setAvatarFrame'>;

export class AvatarFrameService {
  private readonly equippedListeners: AvatarFrameEquippedListener[] = [];

  constructor(
    private readonly store: Store,
    /** frame id → the achievement granting it. */
    private readonly links: ReadonlyMap<string, AvatarFrameAchievementLink> = new Map(),
    private readonly frames: readonly AvatarFrameDefinition[] = AVATAR_FRAMES,
  ) {}

  onEquipped(listener: AvatarFrameEquippedListener) {
    this.equippedListeners.push(listener);
  }

  /**
   * The frame to show for a seat. Guests, unknown accounts, retired ids and
   * anything not owned all come out as `frame_default` (the stored id is only
   * trusted while the ownership row exists, see AccountStore).
   */
  equippedFor(userId: string | null | undefined): string {
    if (!userId) return DEFAULT_AVATAR_FRAME;
    const id = resolveAvatarFrameId(this.store.getUser(userId)?.avatarFrameId);
    return this.frames.some((f) => f.id === id) ? id : DEFAULT_AVATAR_FRAME;
  }

  /** Frame ids the player owns, the default ones included. Retired ids are dropped. */
  ownedIds(userId: string): Set<string> {
    const owned = new Set(this.frames.filter(isDefaultFrame).map((f) => f.id));
    for (const row of this.store.listCosmetics(userId, 'avatar_frame')) if (this.find(row.itemId)) owned.add(row.itemId);
    return owned;
  }

  state(userId: string): AvatarFrameState {
    const owned = this.ownedIds(userId);
    return { ownedAvatarFrames: [...owned], equippedAvatarFrame: this.equippedFor(userId), coins: this.store.coins(userId) };
  }

  overview(userId: string): AvatarFrameOverview {
    const owned = this.ownedIds(userId);
    const equipped = this.equippedFor(userId);
    return {
      frames: this.frames.map((f) => this.view(f, owned.has(f.id), f.id === equipped)),
      ownedAvatarFrames: [...owned],
      equippedAvatarFrame: equipped,
      coins: this.store.coins(userId),
    };
  }

  /** The catalogue without a viewer (guests): only the default frames owned, secret frames masked. */
  catalogue(): AvatarFrameView[] {
    return this.frames.map((f) => this.view(f, isDefaultFrame(f), f.id === DEFAULT_AVATAR_FRAME));
  }

  /**
   * Buys a frame with coins. Price and eligibility come from the catalogue;
   * the store deducts and grants in one transaction that refuses a second
   * purchase and a balance below the price, so a double click or racing
   * requests can't buy twice or go negative.
   */
  buy(userId: string, rawId: unknown): AvatarFrameState & { frame: AvatarFrameView } {
    const frame = this.require(rawId);
    if (this.ownedIds(userId).has(frame.id)) throw new AvatarFrameError('ALREADY_OWNED');
    const price = framePrice(frame);
    if (price === null) throw new AvatarFrameError(frame.unlock.type === 'achievement' ? 'ACHIEVEMENT_REQUIRED' : 'FRAME_NOT_PURCHASABLE');
    const outcome = this.store.purchaseCosmetic(userId, 'avatar_frame', frame.id, price);
    if (outcome !== 'OK') throw new AvatarFrameError(outcome);
    const state = this.state(userId);
    return { ...state, frame: this.view(frame, true, state.equippedAvatarFrame === frame.id) };
  }

  /** Wears an owned frame (`frame_default` to take a frame off). Notifies listeners only on a real change. */
  equip(userId: string, rawId: unknown): AvatarFrameState {
    const frame = this.require(rawId);
    if (!this.ownedIds(userId).has(frame.id)) {
      throw new AvatarFrameError(frame.unlock.type === 'achievement' && !isSecretFrame(frame) ? 'ACHIEVEMENT_REQUIRED' : 'FRAME_NOT_OWNED');
    }
    const before = this.equippedFor(userId);
    // `frame_default` is stored as NULL: old accounts and new ones look the same.
    this.store.setAvatarFrame(userId, isDefaultFrame(frame) ? null : frame.id);
    if (before !== frame.id) {
      for (const listener of this.equippedListeners) {
        try {
          listener(userId, frame.id);
        } catch (err) {
          console.error('[avatar-frames] equipped listener failed', err);
        }
      }
    }
    return this.state(userId);
  }

  private find(id: string) {
    return this.frames.find((f) => f.id === id) ?? null;
  }

  private require(rawId: unknown): AvatarFrameDefinition {
    if (typeof rawId !== 'string' || !FRAME_ID.test(rawId)) throw new AvatarFrameError('INVALID_FRAME');
    const frame = this.find(rawId);
    if (!frame) throw new AvatarFrameError('FRAME_NOT_FOUND');
    return frame;
  }

  private view(f: AvatarFrameDefinition, owned: boolean, equipped: boolean): AvatarFrameView {
    const secret = isSecretFrame(f) && !owned;
    const link = this.links.get(f.id);
    return {
      id: f.id,
      name: secret ? SECRET_NAME : f.name,
      description: secret ? SECRET_DESCRIPTION : f.description,
      rarity: f.rarity,
      asset: secret ? null : (f.asset ?? null),
      unlock: secret ? 'secret' : f.unlock.type,
      price: secret ? null : framePrice(f),
      // A hidden achievement isn't named before it's done: that would give its condition away.
      achievement: !secret && link && (!link.hidden || owned) ? { id: link.id, name: link.name } : null,
      secret,
      owned,
      equipped,
    };
  }
}
