import type { AccountStore } from '../accounts/accountStore.js';
import type { AchievementManager, AchievementView, UnlockedAchievement } from '../achievements/achievementManager.js';
import type { AchievementDefinition } from '../achievements/definitions.js';
import { getTitle, isSecretTitle, isTitleId, TITLE_LIST, toPublicTitle, type PublicTitle, type TitleDefinition, type TitleRarity } from './titles.js';

/** The achievement that grants a title, as far as the viewer may see it. */
export interface TitleSourceView {
  achievementId: string;
  /** "???" / "Thành tích bí mật" while the achievement is secret. */
  name: string;
  description: string;
  secret: boolean;
  unlocked: boolean;
  /** 0–100. */
  percentage: number;
}

/** One card of the title collection. */
export interface TitleView {
  /** Stable React key. Not the title id for a masked secret title (the id would give it away). */
  key: string;
  /** null while it is a secret title the player doesn't own. */
  title: PublicTitle | null;
  rarity: TitleRarity;
  owned: boolean;
  equipped: boolean;
  unlockedAt: number | null;
  source: TitleSourceView | null;
}

export interface TitleCollection {
  titles: TitleView[];
  equippedTitleId: string | null;
  summary: { owned: number; total: number };
  /** Reported once, like the achievements page: unlocks and backfills this read caused. */
  newlyUnlocked: UnlockedAchievement[];
  restoredTitles: PublicTitle[];
}

/** The public catalogue (no viewer): secret titles masked. */
export interface CatalogEntry {
  key: string;
  title: PublicTitle | null;
  rarity: TitleRarity;
  /** null for a hidden achievement. */
  source: { achievementId: string; name: string; description: string } | null;
}

export type EquipOutcome = { ok: true; titleId: string | null; title: PublicTitle | null } | { ok: false; error: 'TITLE_NOT_FOUND' | 'TITLE_LOCKED' };

export type TitleEquippedListener = (userId: string, titleId: string | null) => void;

/**
 * Reading and equipping titles. Granting is not here: titles only arrive
 * through the reward service (achievements today), never from a client call.
 */
export class TitleService {
  /** title id → the achievement whose rewards include it (first one, if several). */
  private readonly sourceOf = new Map<string, AchievementDefinition>();
  private readonly listeners: TitleEquippedListener[] = [];

  constructor(
    private readonly store: AccountStore,
    private readonly achievements: AchievementManager,
    private readonly catalogue: readonly TitleDefinition[] = TITLE_LIST,
  ) {
    for (const def of achievements.definitions) {
      for (const r of def.rewards ?? []) if (r.type === 'title' && !this.sourceOf.has(r.titleId)) this.sourceOf.set(r.titleId, def);
    }
  }

  onEquipped(listener: TitleEquippedListener) {
    this.listeners.push(listener);
  }

  catalog(): CatalogEntry[] {
    return this.catalogue.map((t, i) => {
      const secret = isSecretTitle(t);
      const def = this.sourceOf.get(t.id);
      return {
        key: secret ? `secret-${i}` : t.id,
        title: secret ? null : toPublicTitle(t),
        rarity: t.rarity,
        source: def && !def.hidden && !secret ? { achievementId: def.id, name: def.name, description: def.description } : null,
      };
    });
  }

  /** Every title with the player's ownership. Runs an achievement check first, so old completions are backfilled. */
  async collection(userId: string): Promise<TitleCollection> {
    const overview = await this.achievements.overview(userId);
    const views = new Map<string, AchievementView>(overview.achievements.map((a) => [a.id, a]));
    const owned = new Map((await this.store.listTitles(userId)).map((t) => [t.titleId, t.unlockedAt]));
    const equippedTitleId = await this.equippedTitleId(userId);

    const titles = this.catalogue.map((t, i): TitleView => {
      const has = owned.has(t.id);
      const masked = isSecretTitle(t) && !has;
      const def = this.sourceOf.get(t.id);
      const view = def && views.get(def.id);
      return {
        key: masked ? `secret-${i}` : t.id,
        title: masked ? null : toPublicTitle(t),
        rarity: t.rarity,
        owned: has,
        equipped: has && equippedTitleId === t.id,
        unlockedAt: owned.get(t.id) ?? null,
        // The achievement view is already masked when it's secret; a masked title hides its source altogether.
        source:
          view && !masked
            ? { achievementId: view.id, name: view.name, description: view.description, secret: view.secret, unlocked: view.unlocked, percentage: view.percentage }
            : null,
      };
    });

    return {
      titles,
      equippedTitleId,
      summary: { owned: titles.filter((t) => t.owned).length, total: titles.length },
      newlyUnlocked: overview.newlyUnlocked,
      restoredTitles: overview.restoredTitles,
    };
  }

  /** The stored equipped title, if it still exists in the catalogue. */
  async equippedTitleId(userId: string): Promise<string | null> {
    const id = await this.store.equippedTitleId(userId);
    return getTitle(id) ? id : null;
  }

  async equippedTitle(userId: string): Promise<PublicTitle | null> {
    const t = getTitle(await this.equippedTitleId(userId));
    return t ? toPublicTitle(t) : null;
  }

  /**
   * Equips an owned title, or unequips with null. Never trusts the client:
   * the id must exist in the catalogue and the ownership check happens in the
   * database write itself.
   */
  async equip(userId: string, titleId: string | null): Promise<EquipOutcome> {
    if (titleId !== null && !isTitleId(titleId)) return { ok: false, error: 'TITLE_NOT_FOUND' };
    let done = await this.store.setEquippedTitle(userId, titleId);
    if (!done && titleId !== null) {
      // Maybe the title is due from an achievement completed before titles existed: backfill, then retry.
      await this.achievements.evaluate(userId);
      done = await this.store.setEquippedTitle(userId, titleId);
    }
    if (!done) return { ok: false, error: 'TITLE_LOCKED' };
    for (const listener of this.listeners) {
      try {
        listener(userId, titleId);
      } catch (err) {
        console.error('[titles] equip listener failed', err);
      }
    }
    const t = getTitle(titleId);
    return { ok: true, titleId, title: t ? toPublicTitle(t) : null };
  }
}
