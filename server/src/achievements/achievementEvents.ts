import type { Server } from 'socket.io';
import type { MatchRecorder } from '../accounts/matchRecorder.js';
import { userChannel } from '../socket/socketSink.js';
import type { PublicTitle } from '../titles/titles.js';
import type { AchievementManager, UnlockedAchievement } from './achievementManager.js';

/**
 * Server → client push after a game unlocked something. `coins` is the new balance.
 * `restoredTitles`: titles backfilled for achievements completed before they carried them.
 */
export interface AchievementUnlockedEvent {
  achievements: UnlockedAchievement[];
  restoredTitles: PublicTitle[];
  coins: number;
}

/**
 * Checks achievements after every game recorded for an account, and pushes the
 * new unlocks (with the rewards they granted) to that account's sockets. Runs
 * after `game:finished` has been broadcast (finish listeners are flushed after
 * the room's own events).
 *
 * Unlocks that happen over HTTP instead (games claimed at sign-up, backfill of
 * old history) are returned in those responses, so each unlock is reported once.
 */
export function registerAchievementHooks(io: Server, recorder: MatchRecorder, achievements: AchievementManager, coinsOf: (userId: string) => number) {
  recorder.onMatchRecorded((userId) => {
    const { unlocked, restoredTitles } = achievements.evaluate(userId);
    if (!unlocked.length && !restoredTitles.length) return;
    const event: AchievementUnlockedEvent = { achievements: unlocked, restoredTitles, coins: coinsOf(userId) };
    io.to(userChannel(userId)).emit('achievement:unlocked', event);
  });
}
