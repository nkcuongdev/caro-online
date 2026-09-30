import type { AccountStore } from '../accounts/accountStore.js';
import type { AchievementDefinition } from '../achievements/definitions.js';
import { DEFAULT_NAME_STYLE, getNameStyle, isPurchasable, NAME_STYLE_LIST, resolveNameStyleId, type NameStyleDefinition, type NameStyleUnlock } from './nameStyles.js';
import type { Rarity } from './rarity.js';

/**
 * Name styles for accounts: what exists (the catalogue), what a player owns
 * (`user_cosmetics`, kind `name_style`), and what they wear
 * (`users.name_style_id`). Every rule is checked here, on the server; a client
 * only ever names a style id, never a price, a rarity or an ownership claim.
 *
 *   exists (nameStyles.ts) → owned (bought / granted) → equipped (one at a time)
 *
 * `default` is owned by everyone without a row. Guests always wear `default`.
 */

export type NameStyleErrorCode =
  | 'STYLE_NOT_FOUND'
  | 'STYLE_NOT_OWNED'
  | 'ALREADY_OWNED'
  | 'NOT_ENOUGH_COIN'
  | 'STYLE_LOCKED'
  | 'ACHIEVEMENT_REQUIRED'
  | 'INVALID_STYLE';

export const NAME_STYLE_ERROR_MESSAGES: Record<NameStyleErrorCode, string> = {
  STYLE_NOT_FOUND: 'Hiệu ứng tên này không tồn tại.',
  STYLE_NOT_OWNED: 'Bạn chưa sở hữu hiệu ứng tên này.',
  ALREADY_OWNED: 'Bạn đã sở hữu hiệu ứng tên này rồi.',
  NOT_ENOUGH_COIN: 'Bạn chưa đủ coin để mua hiệu ứng tên này.',
  STYLE_LOCKED: 'Hiệu ứng tên này chưa thể mở khóa.',
  ACHIEVEMENT_REQUIRED: 'Hoàn thành thành tích tương ứng để mở khóa hiệu ứng tên này.',
  INVALID_STYLE: 'Mã hiệu ứng tên không hợp lệ.',
};

export class NameStyleError extends Error {
  constructor(
    readonly code: NameStyleErrorCode,
    message = NAME_STYLE_ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = 'NameStyleError';
  }
}

/** The achievement that grants a style (derived from the achievement rewards, see app.ts). */
export interface NameStyleAchievementLink {
  id: string;
  name: string;
  /** A hidden achievement: its name is a secret too. */
  hidden: boolean;
}

/** One card of the collection, as the player sees it. Secret styles they don't own come masked. */
export interface NameStyleView {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  type: string;
  unlock: NameStyleUnlock;
  /** Coins; null when it can't be bought. */
  price: number | null;
  /** The achievement that grants it, when it may be named. */
  achievement: { id: string; name: string } | null;
  /** True while the details are withheld. */
  secret: boolean;
  owned: boolean;
  equipped: boolean;
}

export interface NameStyleOverview {
  styles: NameStyleView[];
  equipped: string;
  coins: number;
}

/** Called after a player equipped a style, so rooms and tournaments can show it live. */
export type NameStyleEquippedListener = (userId: string, nameStyle: string) => void;

/**
 * style id → the achievement whose rewards grant it. Achievements are the one
 * place the link is written (`rewards: [nameStyle('galaxy')]`).
 */
export function nameStyleLinks(defs: readonly AchievementDefinition[]): Map<string, NameStyleAchievementLink> {
  const links = new Map<string, NameStyleAchievementLink>();
  for (const def of defs) {
    for (const r of def.rewards ?? []) {
      if (r.type === 'nameStyle' && !links.has(r.nameStyleId)) links.set(r.nameStyleId, { id: def.id, name: def.name, hidden: !!def.hidden });
    }
  }
  return links;
}

const SECRET_NAME = '???';
const SECRET_DESCRIPTION = 'Một hiệu ứng tên bí ẩn. Chưa ai biết cách mở khóa.';

type Store = Pick<AccountStore, 'getUser' | 'coins' | 'listCosmetics' | 'purchaseCosmetic' | 'setNameStyle'>;

export class NameStyleService {
  private readonly equippedListeners: NameStyleEquippedListener[] = [];

  constructor(
    private readonly store: Store,
    /** style id → the achievement granting it. */
    private readonly links: ReadonlyMap<string, NameStyleAchievementLink> = new Map(),
    private readonly styles: readonly NameStyleDefinition[] = NAME_STYLE_LIST,
  ) {}

  onEquipped(listener: NameStyleEquippedListener) {
    this.equippedListeners.push(listener);
  }

  /**
   * The style to show for a seat. Guests, unknown accounts, retired ids and
   * anything not owned all come out as `default` (the stored id is only
   * trusted when the ownership row exists, see AccountStore).
   */
  async equippedFor(userId: string | null | undefined): Promise<string> {
    if (!userId) return DEFAULT_NAME_STYLE;
    return resolveNameStyleId((await this.store.getUser(userId))?.nameStyleId);
  }

  /** Style ids the player owns, `default` included. Retired ids are dropped. */
  async ownedIds(userId: string): Promise<Set<string>> {
    const owned = new Set([DEFAULT_NAME_STYLE]);
    for (const row of await this.store.listCosmetics(userId, 'name_style')) if (getNameStyle(row.itemId)) owned.add(row.itemId);
    return owned;
  }

  async overview(userId: string): Promise<NameStyleOverview> {
    const [owned, equipped, coins] = await Promise.all([this.ownedIds(userId), this.equippedFor(userId), this.store.coins(userId)]);
    return {
      styles: this.styles.map((s) => this.view(s, owned.has(s.id), s.id === equipped)),
      equipped,
      coins,
    };
  }

  /** The catalogue without a viewer (nothing owned): secret styles masked. */
  catalogue(): NameStyleView[] {
    return this.styles.map((s) => this.view(s, s.unlock === 'default', false));
  }

  /**
   * Buys a style with coins. Price and eligibility come from the catalogue;
   * the store deducts and grants in one transaction that refuses a second
   * purchase and a balance below the price, so racing requests can't buy
   * twice or go negative.
   */
  async buy(userId: string, rawId: unknown): Promise<{ style: NameStyleView; coins: number }> {
    const style = this.require(rawId);
    const owned = await this.ownedIds(userId);
    if (owned.has(style.id)) throw new NameStyleError('ALREADY_OWNED');
    if (!isPurchasable(style)) throw new NameStyleError(this.lockedReason(style));
    const outcome = await this.store.purchaseCosmetic(userId, 'name_style', style.id, style.price!);
    if (outcome !== 'OK') throw new NameStyleError(outcome);
    return { style: this.view(style, true, false), coins: await this.store.coins(userId) };
  }

  /** Wears an owned style (`default` to take a style off). Notifies listeners only on a real change. */
  async equip(userId: string, rawId: unknown): Promise<{ equipped: string }> {
    const style = this.require(rawId);
    if (!(await this.ownedIds(userId)).has(style.id)) throw new NameStyleError(this.lockedReason(style));
    const before = await this.equippedFor(userId);
    // `default` is stored as NULL: old accounts and new ones look the same.
    await this.store.setNameStyle(userId, style.id === DEFAULT_NAME_STYLE ? null : style.id);
    if (before !== style.id) {
      for (const listener of this.equippedListeners) {
        try {
          listener(userId, style.id);
        } catch (err) {
          console.error('[name-styles] equipped listener failed', err);
        }
      }
    }
    return { equipped: style.id };
  }

  private require(rawId: unknown): NameStyleDefinition {
    if (typeof rawId !== 'string' || !/^[a-z0-9_]{1,40}$/.test(rawId)) throw new NameStyleError('INVALID_STYLE');
    const style = this.styles.find((s) => s.id === rawId);
    if (!style) throw new NameStyleError('STYLE_NOT_FOUND');
    return style;
  }

  /** Why a style the player doesn't own can't be worn / bought. Never names a secret condition. */
  private lockedReason(style: NameStyleDefinition): NameStyleErrorCode {
    switch (style.unlock) {
      case 'coin':
        return 'STYLE_NOT_OWNED';
      case 'achievement':
        return 'ACHIEVEMENT_REQUIRED';
      default:
        return 'STYLE_LOCKED';
    }
  }

  private view(s: NameStyleDefinition, owned: boolean, equipped: boolean): NameStyleView {
    const secret = (!!s.hidden || s.rarity === 'secret') && !owned;
    const link = this.links.get(s.id);
    return {
      id: s.id,
      name: secret ? SECRET_NAME : s.name,
      description: secret ? SECRET_DESCRIPTION : s.description,
      rarity: s.rarity,
      type: secret ? 'secret' : s.type,
      // A secret style's unlock stays "secret" whatever grants it.
      unlock: secret ? 'secret' : s.unlock,
      price: !secret && isPurchasable(s) ? s.price! : null,
      // A hidden achievement isn't named before it's done: that would give its condition away.
      achievement: !secret && link && (!link.hidden || owned) ? { id: link.id, name: link.name } : null,
      secret,
      owned,
      equipped,
    };
  }
}
