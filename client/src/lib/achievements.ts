import { useSyncExternalStore } from 'react';
import { RARITY_RANK, type Rarity } from './rarity';
import type { PublicTitle } from './titles';

/**
 * Achievements as the server reports them (server/src/achievements/). The
 * catalogue, the conditions, the unlocks and the rewards all live on the
 * server; this file only holds the response types and the queue of
 * "new achievement" popups.
 *
 * Kept free of lib/account.ts imports: the account store feeds this queue.
 */

export type AchievementCategory = 'progress' | 'battle' | 'skill' | 'bot' | 'collection' | 'special';
export type { Rarity } from './rarity';

/** A name style as a reward names it (its look comes from lib/nameStyles.ts). */
export interface RewardNameStyle {
  id: string;
  name: string;
  rarity: Rarity;
}

/** One reward of an achievement. `title: null` / `nameStyle: null` = a secret one (not revealed yet). */
export type AchievementReward =
  | { type: 'coins'; amount: number }
  | { type: 'title'; title: PublicTitle | null }
  | { type: 'nameStyle'; nameStyle: RewardNameStyle | null };

export const rewardCoins = (rewards: readonly AchievementReward[]) => rewards.reduce((sum, r) => sum + (r.type === 'coins' ? r.amount : 0), 0);
export const rewardTitles = (rewards: readonly AchievementReward[]) =>
  rewards.flatMap((r) => (r.type === 'title' && r.title ? [r.title] : []));
export const rewardNameStyles = (rewards: readonly AchievementReward[]) =>
  rewards.flatMap((r) => (r.type === 'nameStyle' && r.nameStyle ? [r.nameStyle] : []));

/** Just unlocked: what the popup shows. */
export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  rarity: Rarity;
  rewards: AchievementReward[];
  unlockedAt: number;
}

/** One card of the achievements page. `secret` ones come with their details withheld. */
export interface AchievementView {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  category: AchievementCategory;
  rarity: Rarity;
  hidden: boolean;
  secret: boolean;
  rewards: AchievementReward[];
  comparison: 'gte' | 'lte';
  current: number | null;
  target: number | null;
  progress: number;
  percentage: number;
  unlocked: boolean;
  unlockedAt: number | null;
}

export interface AchievementOverview {
  achievements: AchievementView[];
  summary: { unlocked: number; total: number; percentage: number };
  coins: number;
  newlyUnlocked: UnlockedAchievement[];
  /** Titles granted for achievements completed before they carried one. */
  restoredTitles?: PublicTitle[];
}

// ─── Popup queue ─────────────────────────────────────────────────────────────

/**
 * A single achievement; "and N more" when a lot unlock at once (e.g. the first
 * check of an old account); or titles handed out for achievements completed
 * before titles existed.
 */
export type UnlockPopup =
  | { key: number; kind: 'one'; achievement: UnlockedAchievement }
  | { key: number; kind: 'more'; count: number; coins: number; titles: PublicTitle[] }
  | { key: number; kind: 'titles'; titles: PublicTitle[] };

/** Shown one by one; past this many waiting, the rest fold into one "and N more" popup. */
const MAX_POPUPS = 4;
/** Achievements that bring a new title are worth their own popup before others of the same rarity. */
const rank = (a: UnlockedAchievement) => RARITY_RANK[a.rarity] * 2 + (rewardTitles(a.rewards).length ? 1 : 0);

let queue: UnlockPopup[] = [];
let nextKey = 1;
/** Bumped on every unlock, so an open achievements / titles page knows to refetch. */
let version = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

const seen = new Set<string>();
const seenTitles = new Set<string>();

/**
 * Queues popups for what the server just unlocked. Each achievement / title is
 * shown once per page load, and never more than a few popups pile up.
 */
export function enqueueUnlocks(list: readonly UnlockedAchievement[] | undefined, restored?: readonly PublicTitle[]) {
  const fresh = (list ?? []).filter((a) => !seen.has(a.id));
  const titles = (restored ?? []).filter((t) => !seenTitles.has(t.id));
  if (!fresh.length && !titles.length) return;
  fresh.forEach((a) => seen.add(a.id));
  fresh.forEach((a) => rewardTitles(a.rewards).forEach((t) => seenTitles.add(t.id)));
  titles.forEach((t) => seenTitles.add(t.id));
  version++;

  // The first popup may already be on screen: only regroup what's still waiting.
  const [showing, ...waiting] = queue;
  const singles = [...waiting.filter((p) => p.kind === 'one').map((p) => p.achievement), ...fresh].sort((a, b) => rank(b) - rank(a));
  const folded = waiting.find((p) => p.kind === 'more');
  let more = folded?.kind === 'more' ? { count: folded.count, coins: folded.coins, titles: folded.titles } : null;
  const restoredPopup = waiting.find((p) => p.kind === 'titles');
  const allRestored = [...(restoredPopup?.kind === 'titles' ? restoredPopup.titles : []), ...titles];
  const room = MAX_POPUPS - (showing ? 1 : 0) - (allRestored.length ? 1 : 0);
  // Keep the most notable as their own popups; an "and N more" popup takes the last slot.
  const keep = singles.length > room || more ? singles.slice(0, Math.max(0, room - 1)) : singles;
  for (const a of singles.slice(keep.length)) {
    more = { count: (more?.count ?? 0) + 1, coins: (more?.coins ?? 0) + rewardCoins(a.rewards), titles: [...(more?.titles ?? []), ...rewardTitles(a.rewards)] };
  }

  queue = [
    ...(showing ? [showing] : []),
    ...keep.map((achievement): UnlockPopup => ({ key: nextKey++, kind: 'one', achievement })),
    ...(more ? [{ key: nextKey++, kind: 'more' as const, ...more }] : []),
    ...(allRestored.length ? [{ key: restoredPopup?.key ?? nextKey++, kind: 'titles' as const, titles: allRestored }] : []),
  ];
  emit();
}

/** Closes the popup on screen; the next one (if any) follows. */
export function dismissUnlockPopup(key: number) {
  if (queue[0]?.key !== key) return;
  queue = queue.slice(1);
  emit();
}

/** Forgets queued popups, e.g. on sign-out or when another account signs in. */
export function clearUnlockPopups() {
  queue = [];
  seen.clear();
  seenTitles.clear();
  emit();
}

export const useUnlockPopup = () => useSyncExternalStore(subscribe, () => queue[0] ?? null);
export const useAchievementsVersion = () => useSyncExternalStore(subscribe, () => version);
