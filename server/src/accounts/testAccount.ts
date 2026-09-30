import { ACHIEVEMENTS } from '../achievements/definitions.js';
import { AVATAR_FRAMES, isDefaultFrame } from '../cosmetics/avatarFrames.js';
import { NAME_STYLE_LIST } from '../cosmetics/nameStyles.js';
import { coinsIn, RewardService } from '../rewards/rewardService.js';
import { TITLE_LIST } from '../titles/titles.js';
import type { AccountStore } from './accountStore.js';
import { normalizeEmail } from './authService.js';
import { hashPassword, verifyPassword } from './password.js';

/** A login that owns everything, for checking cosmetics and achievements by hand. */
export interface TestAccountConfig {
  email: string;
  password: string;
  nickname: string;
  /** Added once, when the account is created, so the shop can be tried too. */
  startingCoins: number;
}

export interface TestAccountResult {
  userId: string;
  created: boolean;
  /** Items this run added (0 everywhere once the account is complete). */
  added: { achievements: number; titles: number; nameStyles: number; avatarFrames: number };
}

/**
 * Creates the test account if it's missing, then unlocks every achievement
 * (paying its rewards) and grants every title, name style and avatar frame it
 * doesn't own yet. Idempotent: unlocks and owned items are one-per-user, so
 * running it at every boot only adds what the catalogues gained since. The
 * password is reset to `cfg.password` when it no longer matches, so rotating
 * it is a matter of changing the variable.
 */
export async function seedTestAccount(store: AccountStore, cfg: TestAccountConfig): Promise<TestAccountResult> {
  const email = normalizeEmail(cfg.email);
  let user = await store.findUserByEmail(email);
  const created = !user;
  if (user) {
    if (!(await verifyPassword(cfg.password, user.passwordHash))) await store.setPasswordHash(user.id, await hashPassword(cfg.password));
  } else {
    user = await store.createUser({ email, passwordHash: await hashPassword(cfg.password), nickname: cfg.nickname, avatar: null });
    if (!user) throw new Error('could not create the test account');
  }
  const userId = user.id;
  const rewards = new RewardService(store);
  const source = { type: 'achievement' as const, id: 'test-account' };

  const added = await store.transaction(async () => {
    let achievements = 0;
    for (const def of ACHIEVEMENTS) {
      if (!(await store.insertAchievementUnlock(userId, def.id, coinsIn(def.rewards)))) continue;
      await rewards.grantAll(userId, def.rewards, { type: 'achievement', id: def.id });
      achievements++;
    }
    let titles = 0;
    for (const t of TITLE_LIST) if (await store.grantTitle(userId, t.id, source)) titles++;
    let nameStyles = 0;
    for (const s of NAME_STYLE_LIST) if (s.unlock !== 'default' && (await store.grantCosmetic(userId, 'name_style', s.id, source))) nameStyles++;
    let avatarFrames = 0;
    for (const f of AVATAR_FRAMES) if (!isDefaultFrame(f) && (await store.grantCosmetic(userId, 'avatar_frame', f.id, source))) avatarFrames++;
    if (created && cfg.startingCoins > 0) await store.addCoins(userId, cfg.startingCoins);
    return { achievements, titles, nameStyles, avatarFrames };
  });
  return { userId, created, added };
}
