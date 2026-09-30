import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccountStore } from '../src/accounts/accountStore.js';
import { verifyPassword } from '../src/accounts/password.js';
import { seedTestAccount } from '../src/accounts/testAccount.js';
import { ACHIEVEMENTS } from '../src/achievements/definitions.js';
import { loadConfig } from '../src/config.js';
import { AVATAR_FRAMES } from '../src/cosmetics/avatarFrames.js';
import { NAME_STYLE_LIST } from '../src/cosmetics/nameStyles.js';
import { TITLE_LIST } from '../src/titles/titles.js';

/* The boot-time test account: owns everything, safe to seed at every start. */

const cfg = { email: 'Tester@Example.test', password: 'correct horse battery', nickname: 'Tester', startingCoins: 1_000 };

describe('test account seed', () => {
  it('creates an account that owns every achievement, title, name style and avatar frame', async () => {
    const store = new AccountStore(':memory:');
    const first = await seedTestAccount(store, cfg);
    assert.equal(first.created, true);
    const user = await store.findUserByEmail('tester@example.test');
    assert.equal(user?.id, first.userId);
    assert.equal((await store.listAchievements(first.userId)).length, ACHIEVEMENTS.length);
    assert.equal((await store.listTitles(first.userId)).length, TITLE_LIST.length);
    // The default style and frame are owned implicitly, not stored.
    assert.equal((await store.listCosmetics(first.userId, 'name_style')).length, NAME_STYLE_LIST.length - 1);
    assert.equal((await store.listCosmetics(first.userId, 'avatar_frame')).length, AVATAR_FRAMES.length - 1);
    await store.close();
  });

  it('adds nothing and pays nothing twice when run again, and follows a changed password', async () => {
    const store = new AccountStore(':memory:');
    const first = await seedTestAccount(store, cfg);
    const coins = await store.coins(first.userId);
    const again = await seedTestAccount(store, { ...cfg, password: 'a brand new passphrase' });
    assert.equal(again.created, false);
    assert.equal(again.userId, first.userId);
    assert.deepEqual(again.added, { achievements: 0, titles: 0, nameStyles: 0, avatarFrames: 0 });
    assert.equal(await store.coins(first.userId), coins);
    const user = await store.findUserByEmail(cfg.email.toLowerCase());
    assert.equal(await verifyPassword('a brand new passphrase', user!.passwordHash), true);
    await store.close();
  });

  it('is off unless both variables are set to something usable', () => {
    assert.equal(loadConfig({}).accounts.testAccount, null);
    assert.equal(loadConfig({ TEST_ACCOUNT_EMAIL: 'a@b.test' }).accounts.testAccount, null);
    assert.equal(loadConfig({ TEST_ACCOUNT_EMAIL: 'a@b.test', TEST_ACCOUNT_PASSWORD: 'short' }).accounts.testAccount, null);
    assert.equal(loadConfig({ TEST_ACCOUNT_EMAIL: 'a@b.test', TEST_ACCOUNT_PASSWORD: 'long enough' }).accounts.testAccount?.email, 'a@b.test');
  });
});
