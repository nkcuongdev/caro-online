import type { AccountStore } from '../accounts/accountStore.js';
import { getAvatarFrame, isSecretFrame } from '../cosmetics/avatarFrames.js';
import { getNameStyle } from '../cosmetics/nameStyles.js';
import { getTitle, isSecretTitle, isTitleId, toPublicTitle, type PublicTitle, type TitleId } from '../titles/titles.js';

/**
 * Everything a player can be given, as data. Achievements list these in their
 * definition; granting them is this module's job alone, so a new kind of
 * reward (avatar frame, board theme, piece skin, …) is one union member here
 * plus one case in `RewardService.grant`, and every source gets it for free.
 */
export type Reward =
  /** Soft currency, added to the balance. */
  | { type: 'coins'; amount: number }
  /** A cosmetic title (titles/titles.ts). Owned at most once. */
  | { type: 'title'; titleId: TitleId }
  /** A name style (cosmetics/nameStyles.ts). Owned at most once. */
  | { type: 'nameStyle'; nameStyleId: string }
  /** An avatar frame (cosmetics/avatarFrames.ts). Owned at most once. */
  | { type: 'avatarFrame'; avatarFrameId: string };

export type RewardType = Reward['type'];

/** Where a reward came from. Stored with owned items, so later sources (events, seasons, gifts) stay traceable. */
export interface RewardSource {
  type: 'achievement';
  id: string;
}

export interface GrantResult {
  reward: Reward;
  /** False when the player already owned it (a title granted twice), or the reward was invalid. */
  granted: boolean;
}

/** A name style as a reward shows it. */
export interface PublicNameStyleReward {
  id: string;
  name: string;
  rarity: string;
}

/** An avatar frame as a reward shows it. */
export interface PublicAvatarFrameReward {
  id: string;
  name: string;
  rarity: string;
}

/**
 * A reward as clients see it. `title: null` / `nameStyle: null` = a secret one
 * the viewer doesn't own yet.
 */
export type PublicReward =
  | { type: 'coins'; amount: number }
  | { type: 'title'; title: PublicTitle | null }
  | { type: 'nameStyle'; nameStyle: PublicNameStyleReward | null }
  | { type: 'avatarFrame'; avatarFrame: PublicAvatarFrameReward | null };

export const coins = (amount: number): Reward => ({ type: 'coins', amount });
export const title = (titleId: TitleId): Reward => ({ type: 'title', titleId });
export const nameStyle = (nameStyleId: string): Reward => ({ type: 'nameStyle', nameStyleId });
export const avatarFrame = (avatarFrameId: string): Reward => ({ type: 'avatarFrame', avatarFrameId });

export type OwnableReward = Extract<Reward, { type: 'title' | 'nameStyle' | 'avatarFrame' }>;

/** Rewards that are "owned" (titles, name styles, …): granting them again is a no-op, so they can be re-granted safely. */
export const isOwnable = (r: Reward): r is OwnableReward => r.type === 'title' || r.type === 'nameStyle' || r.type === 'avatarFrame';

/** Hidden until owned: secret-rarity or `hidden` name styles. */
const isSecretNameStyle = (id: string) => {
  const s = getNameStyle(id);
  return !s || s.rarity === 'secret' || !!s.hidden;
};

export const coinsIn = (rewards: readonly Reward[] | undefined) =>
  (rewards ?? []).reduce((sum, r) => sum + (r.type === 'coins' ? Math.max(0, Math.floor(r.amount)) : 0), 0);

/**
 * `ownedTitles`: what the viewer owns, so secret titles they haven't earned stay masked.
 * Pass `null` to reveal everything (the viewer just received these rewards).
 */
export function toPublicReward(
  r: Reward,
  ownedTitles: ReadonlySet<string> | null,
  ownedNameStyles: ReadonlySet<string> | null = ownedTitles === null ? null : new Set<string>(),
  ownedAvatarFrames: ReadonlySet<string> | null = ownedTitles === null ? null : new Set<string>(),
): PublicReward {
  switch (r.type) {
    case 'coins':
      return { type: 'coins', amount: r.amount };
    case 'title': {
      const t = getTitle(r.titleId);
      const masked = !t || (isSecretTitle(t) && ownedTitles !== null && !ownedTitles.has(t.id));
      return { type: 'title', title: masked || !t ? null : toPublicTitle(t) };
    }
    case 'nameStyle': {
      const s = getNameStyle(r.nameStyleId);
      const masked = !s || (isSecretNameStyle(s.id) && ownedNameStyles !== null && !ownedNameStyles.has(s.id));
      return { type: 'nameStyle', nameStyle: masked || !s ? null : { id: s.id, name: s.name, rarity: s.rarity } };
    }
    case 'avatarFrame': {
      const f = getAvatarFrame(r.avatarFrameId);
      const masked = !f || (isSecretFrame(f) && ownedAvatarFrames !== null && !ownedAvatarFrames.has(f.id));
      return { type: 'avatarFrame', avatarFrame: masked || !f ? null : { id: f.id, name: f.name, rarity: f.rarity } };
    }
  }
}

/**
 * The single place rewards are handed out.
 *
 * Idempotency is layered: a source pays out once (an achievement unlock is a
 * primary-key insert, and callers grant only for rows they inserted), and
 * ownable rewards are themselves one-per-user in the database, so even a
 * repeated grant can't duplicate a title. Run grants inside
 * `store.transaction` together with whatever made them due.
 */
export class RewardService {
  constructor(private readonly store: AccountStore) {}

  grantAll(userId: string, rewards: readonly Reward[] | undefined, source: RewardSource): GrantResult[] {
    return (rewards ?? []).map((r) => this.grant(userId, r, source));
  }

  grant(userId: string, reward: Reward, source: RewardSource): GrantResult {
    switch (reward.type) {
      case 'coins': {
        const amount = Math.max(0, Math.floor(reward.amount));
        if (amount > 0) this.store.addCoins(userId, amount);
        return { reward, granted: amount > 0 };
      }
      case 'title': {
        // The catalogue is checked at startup by the tests; a stale id is skipped rather than stored.
        if (!isTitleId(reward.titleId)) {
          console.warn(`[rewards] unknown title "${reward.titleId}" from ${source.type}:${source.id}`);
          return { reward, granted: false };
        }
        return { reward, granted: this.store.grantTitle(userId, reward.titleId, source) };
      }
      case 'nameStyle': {
        if (!getNameStyle(reward.nameStyleId)) {
          console.warn(`[rewards] unknown name style "${reward.nameStyleId}" from ${source.type}:${source.id}`);
          return { reward, granted: false };
        }
        return { reward, granted: this.store.grantCosmetic(userId, 'name_style', reward.nameStyleId, source) };
      }
      case 'avatarFrame': {
        if (!getAvatarFrame(reward.avatarFrameId)) {
          console.warn(`[rewards] unknown avatar frame "${reward.avatarFrameId}" from ${source.type}:${source.id}`);
          return { reward, granted: false };
        }
        return { reward, granted: this.store.grantCosmetic(userId, 'avatar_frame', reward.avatarFrameId, source) };
      }
      default: {
        const unknown: never = reward;
        throw new Error(`unhandled reward ${JSON.stringify(unknown)}`);
      }
    }
  }

  /** Ownable rewards from `rewards` the player doesn't have yet (for backfilling sources completed before the reward existed). */
  missing(userId: string, rewards: readonly Reward[]): OwnableReward[] {
    const ownable = rewards.filter(isOwnable);
    if (!ownable.length) return [];
    // Only read the inventories this batch can touch.
    const titles = ownable.some((r) => r.type === 'title') ? new Set(this.store.listTitles(userId).map((t) => t.titleId)) : new Set<string>();
    const styles = ownable.some((r) => r.type === 'nameStyle')
      ? new Set(this.store.listCosmetics(userId, 'name_style').map((c) => c.itemId))
      : new Set<string>();
    const frames = ownable.some((r) => r.type === 'avatarFrame')
      ? new Set(this.store.listCosmetics(userId, 'avatar_frame').map((c) => c.itemId))
      : new Set<string>();
    const seen = new Set<string>();
    return ownable.filter((r) => {
      const key = r.type === 'title' ? `title:${r.titleId}` : r.type === 'nameStyle' ? `nameStyle:${r.nameStyleId}` : `avatarFrame:${r.avatarFrameId}`;
      const have =
        r.type === 'title'
          ? titles.has(r.titleId) || !isTitleId(r.titleId)
          : r.type === 'nameStyle'
            ? styles.has(r.nameStyleId) || !getNameStyle(r.nameStyleId)
            : frames.has(r.avatarFrameId) || !getAvatarFrame(r.avatarFrameId);
      if (have || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
