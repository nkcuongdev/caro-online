import type { AccountStore, PlayerStats, UserAchievementRow } from '../accounts/accountStore.js';
import { coinsIn, RewardService, toPublicReward, type PublicReward, type Reward } from '../rewards/rewardService.js';
import { getTitle, toPublicTitle, type PublicTitle } from '../titles/titles.js';
import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementDefinition,
  type AchievementStats,
  type Progress,
  type Rarity,
} from './definitions.js';

/**
 * Game → match history → PlayerStats → AchievementManager → unlock → RewardService.
 *
 * The match history is the only source of truth: stats are computed from it
 * (so a game recorded twice is still counted once, and players who played
 * before achievements existed are backfilled), unlocks live in
 * `user_achievements`, and rewards (coins, titles, …) are granted by the
 * reward service in the same transaction as the unlock. Clients never tell the
 * server what they unlocked; they only read.
 *
 * One check costs one stats computation, one read of the unlocked ids, one read
 * of the owned titles (for the reward backfill) and, only when something is
 * due, one write transaction. Definitions are evaluated in memory.
 */

/** Flattens the profile stats into the numbers achievement conditions refer to. */
export function toAchievementStats(s: PlayerStats): AchievementStats {
  return {
    gamesPlayed: s.overall.games,
    totalWins: s.overall.wins,
    totalLosses: s.overall.losses,
    totalDraws: s.overall.draws,
    winsVsPlayer: (s.byMode.pvp?.wins ?? 0) + (s.byMode.tournament?.wins ?? 0),
    winsVsBot: s.byMode.bot?.wins ?? 0,
    winsVsHardBot: s.botWins.hard,
    // Same rule as the profile: a loss or a draw ends a win streak.
    currentWinStreak: s.currentStreak.result === 'win' ? s.currentStreak.count : 0,
    maxWinStreak: s.bestWinStreak,
    fastestWinMoves: s.fastestWinMoves ?? 0,
    totalMovesPlayed: s.movesPlayed,
    longestGameMoves: s.longestGameMoves,
    tournamentTitles: s.tournamentTitles,
    winsByFive: s.winsByFive,
    winsAsO: s.winsAsO,
    distinctOpponentsBeaten: s.distinctOpponentsBeaten,
  };
}

export function progressOf(def: AchievementDefinition, stats: AchievementStats): Progress {
  if (def.custom) return def.custom(stats);
  if (!def.stat || !def.target) return { current: 0, target: 1, done: false };
  const current = stats[def.stat];
  if (def.comparison === 'lte') return { current, target: def.target, done: current > 0 && current <= def.target };
  return { current, target: def.target, done: current >= def.target };
}

/** 0–1. Lower-is-better goals move closer as the best value drops towards the target. */
export function progressRatio(def: AchievementDefinition, p: Progress): number {
  if (p.done) return 1;
  if (p.target <= 0) return 0;
  if (def.comparison === 'lte') return p.current > 0 ? Math.min(p.target / p.current, 1) : 0;
  return Math.min(Math.max(p.current / p.target, 0), 1);
}

/** Definitions whose condition holds now but that the player doesn't own yet. */
export function findNewUnlocks(defs: readonly AchievementDefinition[], stats: AchievementStats, owned: ReadonlySet<string>) {
  return defs.filter((d) => !owned.has(d.id) && progressOf(d, stats).done);
}

/** What the client needs to show the "new achievement" popup. */
export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  rarity: Rarity;
  rewards: PublicReward[];
  unlockedAt: number;
}

/** One row of the achievements page. Secret, still-locked achievements come masked. */
export interface AchievementView {
  id: string;
  /** "???" while a hidden achievement is locked. */
  name: string;
  description: string;
  /** null while a hidden achievement is locked. */
  icon: string | null;
  category: AchievementCategory;
  rarity: Rarity;
  hidden: boolean;
  /** True while the details are withheld (hidden and not unlocked). */
  secret: boolean;
  /**
   * While secret, only the title rewards show, as `title: null` ("a secret title").
   * A secret title stays masked until owned, even on a visible achievement.
   */
  rewards: PublicReward[];
  comparison: 'gte' | 'lte';
  /** null while secret: the condition isn't revealed. */
  current: number | null;
  target: number | null;
  /** 0–1, never above 1. 0 while secret. */
  progress: number;
  /** 0–100, rounded down so 99.9% doesn't read as done. */
  percentage: number;
  unlocked: boolean;
  unlockedAt: number | null;
}

export interface AchievementOverview {
  achievements: AchievementView[];
  summary: { unlocked: number; total: number; percentage: number };
  coins: number;
  /** Unlocked by the check this request ran (e.g. backfilled from old games). */
  newlyUnlocked: UnlockedAchievement[];
  /** Titles granted by this check for achievements completed before they carried the title. */
  restoredTitles: PublicTitle[];
}

export interface EvaluateResult {
  unlocked: UnlockedAchievement[];
  /** See `AchievementOverview.restoredTitles`. */
  restoredTitles: PublicTitle[];
  rows: UserAchievementRow[];
}

const SECRET_NAME = '???';
const SECRET_DESCRIPTION = 'Thành tích bí mật';

export class AchievementManager {
  private readonly byId: Map<string, AchievementDefinition>;

  constructor(
    private readonly store: AccountStore,
    private readonly defs: readonly AchievementDefinition[] = ACHIEVEMENTS,
    private readonly rewards: RewardService = new RewardService(store),
  ) {
    this.byId = new Map(defs.map((d) => [d.id, d]));
  }

  get definitions() {
    return this.defs;
  }

  /**
   * Unlocks whatever the player now qualifies for and grants the rewards, then
   * re-grants any ownable reward (a title) missing from achievements unlocked
   * earlier: that is the backfill for players who completed an achievement
   * before it carried the reward. Safe to call any number of times: an
   * achievement is unlocked (and paid) once, and a title is owned once.
   * Pass `stats` when the caller already computed them.
   */
  async evaluate(userId: string, knownStats?: PlayerStats): Promise<EvaluateResult> {
    const stats = knownStats ?? (await this.store.stats(userId));
    const rows = await this.store.listAchievements(userId);
    const owned = new Set(rows.map((r) => r.achievementId));
    const due = findNewUnlocks(this.defs, toAchievementStats(stats), owned);
    const earlier = rows.flatMap((r) => (this.byId.get(r.achievementId)?.rewards ?? []).map((reward) => ({ reward, source: r.achievementId })));
    const missing = await this.rewards.missing(userId, earlier.map((e) => e.reward));
    if (!due.length && !missing.length) return { unlocked: [], restoredTitles: [], rows };

    const { added, restored } = await this.store.transaction(async () => {
      const added: AchievementDefinition[] = [];
      for (const def of due) {
        if (!(await this.store.insertAchievementUnlock(userId, def.id, coinsIn(def.rewards)))) continue; // a racing check got it first
        await this.rewards.grantAll(userId, def.rewards, { type: 'achievement', id: def.id });
        added.push(def);
      }
      const restored: string[] = [];
      for (const reward of missing) {
        const source = earlier.find((e) => e.reward === reward)!.source;
        // Restored name styles need no announcement: the collection page shows them as owned.
        if ((await this.rewards.grant(userId, reward, { type: 'achievement', id: source })).granted && reward.type === 'title') restored.push(reward.titleId);
      }
      return { added, restored };
    });

    // Re-read so the caller sees the stored unlock times.
    const fresh = added.length ? await this.store.listAchievements(userId) : rows;
    const at = new Map(fresh.map((r) => [r.achievementId, r.unlockedAt]));
    const unlocked = added.map(
      (def): UnlockedAchievement => ({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        category: def.category,
        rarity: def.rarity,
        // The player owns these now: nothing to mask.
        rewards: (def.rewards ?? []).map((r) => toPublicReward(r, null)),
        unlockedAt: at.get(def.id) ?? Date.now(),
      }),
    );
    const restoredTitles = restored.map((id) => getTitle(id)).filter((t) => t !== null).map(toPublicTitle);
    return { unlocked, restoredTitles, rows: fresh };
  }

  /** Every achievement with the player's progress. Runs a check first, so it doubles as the backfill. */
  async overview(userId: string): Promise<AchievementOverview> {
    const stats = await this.store.stats(userId);
    const { unlocked: newlyUnlocked, restoredTitles, rows } = await this.evaluate(userId, stats);
    const values = toAchievementStats(stats);
    const unlockedAt = new Map(rows.map((r) => [r.achievementId, r.unlockedAt]));
    const [titleRows, styleRows, frameRows, coins] = await Promise.all([
      this.store.listTitles(userId),
      this.store.listCosmetics(userId, 'name_style'),
      this.store.listCosmetics(userId, 'avatar_frame'),
      this.store.coins(userId),
    ]);
    const ownedTitles = new Set(titleRows.map((t) => t.titleId));
    const ownedNameStyles = new Set(styleRows.map((c) => c.itemId));
    const ownedAvatarFrames = new Set(frameRows.map((c) => c.itemId));

    const achievements = this.defs.map((def): AchievementView => {
      const at = unlockedAt.get(def.id) ?? null;
      const unlocked = at !== null;
      const p = progressOf(def, values);
      // Once unlocked it stays full, even if a stat it tracked (the current streak) drops later.
      const secret = !!def.hidden && !unlocked;
      // A secret's progress would hint at its condition, so it reads 0 until unlocked.
      const ratio = unlocked ? 1 : secret ? 0 : progressRatio(def, p);
      return {
        id: def.id,
        name: secret ? SECRET_NAME : def.name,
        description: secret ? SECRET_DESCRIPTION : def.description,
        icon: secret ? null : def.icon,
        category: def.category,
        rarity: def.rarity,
        hidden: !!def.hidden,
        secret,
        rewards: secret ? secretRewards(def.rewards) : (def.rewards ?? []).map((r) => toPublicReward(r, ownedTitles, ownedNameStyles, ownedAvatarFrames)),
        comparison: def.comparison ?? 'gte',
        current: secret ? null : p.current,
        target: secret ? null : p.target,
        progress: ratio,
        percentage: Math.floor(ratio * 100),
        unlocked,
        unlockedAt: at,
      };
    });

    const done = achievements.filter((a) => a.unlocked).length;
    return {
      achievements,
      summary: { unlocked: done, total: achievements.length, percentage: achievements.length ? Math.floor((done / achievements.length) * 100) : 0 },
      coins,
      newlyUnlocked,
      restoredTitles,
    };
  }
}

/** A secret achievement only says that it grants a title / a name style / an avatar frame, never which. */
const secretRewards = (rewards: readonly Reward[] | undefined): PublicReward[] =>
  (rewards ?? []).flatMap((r): PublicReward[] => {
    switch (r.type) {
      case 'title':
        return [{ type: 'title', title: null }];
      case 'nameStyle':
        return [{ type: 'nameStyle', nameStyle: null }];
      case 'avatarFrame':
        return [{ type: 'avatarFrame', avatarFrame: null }];
      default:
        return [];
    }
  });
