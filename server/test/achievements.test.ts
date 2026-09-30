import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { AccountStore, type MatchRecord, type MatchResult } from '../src/accounts/accountStore.js';
import { AchievementManager, progressOf, progressRatio, toAchievementStats } from '../src/achievements/achievementManager.js';
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, RARITIES, STAT_KEYS, type AchievementDefinition } from '../src/achievements/definitions.js';
import { coinsIn } from '../src/rewards/rewardService.js';
import { isTitleId } from '../src/titles/titles.js';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';

/* Achievements: stats from the match history, unlock rules, one-shot rewards, and the live push after a game. */

const def = (id: string) => ACHIEVEMENTS.find((d) => d.id === id)!;
const coinsFor = (...ids: string[]) => ids.reduce((sum, id) => sum + coinsIn(def(id).rewards), 0);

let seq = 0;
/** A finished game from `result`'s point of view. Each call is a distinct game unless `same` is reused. */
function game(result: MatchResult, extra: Partial<MatchRecord> = {}): MatchRecord {
  seq += 1;
  const at = 1_700_000_000_000 + seq * 60_000;
  return {
    roomId: `room${seq}`,
    round: 1,
    mode: 'pvp',
    result,
    reason: result === 'draw' ? 'draw' : 'resign',
    myMark: 'X',
    myName: 'Me',
    myAvatar: null,
    opponentName: 'Them',
    opponentAvatar: null,
    opponentIsBot: false,
    opponentUserId: null,
    botDifficulty: null,
    boardSize: 20,
    turnMs: 30_000,
    moves: [],
    winLine: null,
    startedAt: at,
    finishedAt: at + 30_000,
    tournamentId: null,
    tournamentName: null,
    tournamentRound: null,
    tournamentTotalRounds: null,
    ...extra,
  };
}

const moves = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('achievement definitions', () => {
  it('are well-formed: unique ids, known stats, categories, rarities and titles', () => {
    const ids = new Set<string>();
    for (const d of ACHIEVEMENTS) {
      assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
      ids.add(d.id);
      assert.ok(d.name && d.description && d.icon, d.id);
      assert.ok(ACHIEVEMENT_CATEGORIES.includes(d.category), d.id);
      assert.ok(RARITIES.includes(d.rarity), d.id);
      if (!d.custom) {
        assert.ok(d.stat && STAT_KEYS.includes(d.stat), `${d.id} names a known stat`);
        assert.ok(d.target && d.target > 0, `${d.id} has a positive target`);
      }
      for (const r of d.rewards ?? []) if (r.type === 'title') assert.ok(isTitleId(r.titleId), `${d.id} title exists`);
    }
    assert.ok(ACHIEVEMENTS.length >= 20 && ACHIEVEMENTS.length <= 40);
    assert.ok(ACHIEVEMENTS.some((d) => d.hidden));
  });

  it('supports custom conditions and lower-is-better goals', async () => {
    const empty = new AccountStore(':memory:');
    const stats = { ...toAchievementStats(await empty.stats('nobody')), totalWins: 3, totalDraws: 2 };
    await empty.close();
    const custom: AchievementDefinition = {
      id: 'x',
      name: 'x',
      description: 'x',
      icon: 'x',
      category: 'special',
      rarity: 'common',
      custom: (s) => ({ current: s.totalWins + s.totalDraws, target: 5, done: s.totalWins + s.totalDraws >= 5 }),
    };
    assert.equal(progressOf(custom, stats).done, true);

    const fast = def('fast-win');
    assert.equal(progressOf(fast, { ...stats, fastestWinMoves: 0 }).done, false, '0 = no five-in-a-row win yet');
    assert.equal(progressOf(fast, { ...stats, fastestWinMoves: 12 }).done, false);
    assert.equal(progressOf(fast, { ...stats, fastestWinMoves: 9 }).done, true);
    assert.equal(progressRatio(fast, progressOf(fast, { ...stats, fastestWinMoves: 18 })), 0.5);
  });
});

describe('player stats and achievements', () => {
  let store: AccountStore;
  let manager: AchievementManager;
  let userId: string;

  beforeEach(async () => {
    store = new AccountStore(':memory:');
    manager = new AchievementManager(store);
    userId = (await store.createUser({ email: 'p@example.com', passwordHash: 'x', nickname: 'P', avatar: null }))!.id;
  });
  afterEach(async () => {
    await store.close();
  });

  const play = async (...records: MatchRecord[]) => {
    for (const r of records) await store.recordMatch(userId, r);
    return (await manager.evaluate(userId)).unlocked.map((a) => a.id);
  };
  const statsNow = async () => toAchievementStats(await store.stats(userId));

  it('first win: counts the game and the win, starts a streak, unlocks and pays the first achievements', async () => {
    const unlocked = await play(game('win'));
    const s = await statsNow();
    assert.equal(s.gamesPlayed, 1);
    assert.equal(s.totalWins, 1);
    assert.equal(s.currentWinStreak, 1);
    assert.equal(s.maxWinStreak, 1);
    assert.equal(s.winsVsPlayer, 1);
    assert.equal(s.winsVsBot, 0);
    assert.deepEqual(unlocked.sort(), ['games-1', 'pvp-1', 'wins-1']);
    assert.equal(await store.coins(userId), coinsFor('games-1', 'pvp-1', 'wins-1'));
    assert.equal((await store.getUser(userId))!.coins, await store.coins(userId));
  });

  it('a loss counts the game and resets the current streak; a draw counts as a draw', async () => {
    await play(game('win'), game('win'), game('loss'));
    let s = await statsNow();
    assert.equal(s.gamesPlayed, 3);
    assert.equal(s.totalLosses, 1);
    assert.equal(s.currentWinStreak, 0);
    assert.equal(s.maxWinStreak, 2, 'the best streak is kept');

    await play(game('draw'));
    s = await statsNow();
    assert.equal(s.gamesPlayed, 4);
    assert.equal(s.totalDraws, 1);
    assert.equal(s.totalWins, 2);
  });

  it('win streaks grow, reset on a loss, and the best streak never drops', async () => {
    assert.ok((await play(game('win'), game('win'), game('win'))).includes('streak-3'));
    assert.equal((await statsNow()).currentWinStreak, 3);
    await play(game('loss'));
    assert.equal((await statsNow()).currentWinStreak, 0);
    assert.equal((await statsNow()).maxWinStreak, 3);
    await play(game('win'));
    assert.equal((await statsNow()).currentWinStreak, 1);
    assert.equal((await statsNow()).maxWinStreak, 3);
    // The streak achievement stays unlocked and full after the streak ended.
    const view = (await manager.overview(userId)).achievements.find((a) => a.id === 'streak-3')!;
    assert.equal(view.unlocked, true);
    assert.equal(view.percentage, 100);
  });

  it('bot wins count separately from wins against people, per difficulty', async () => {
    const unlocked = await play(game('win', { mode: 'bot', opponentIsBot: true, botDifficulty: 'hard' }), game('win', { mode: 'tournament' }));
    const s = await statsNow();
    assert.equal(s.winsVsBot, 1);
    assert.equal(s.winsVsHardBot, 1);
    assert.equal(s.winsVsPlayer, 1, 'tournament wins are wins against people');
    assert.ok(unlocked.includes('bot-1') && unlocked.includes('bot-hard-1') && unlocked.includes('pvp-1'));
  });

  it('unlocks exactly at the target, not before', async () => {
    for (let i = 0; i < 9; i++) assert.ok(!(await play(game('loss'))).includes('games-10'));
    const view = (await manager.overview(userId)).achievements.find((a) => a.id === 'games-10')!;
    assert.deepEqual([view.current, view.target, view.percentage, view.unlocked], [9, 10, 90, false]);
    assert.deepEqual(await play(game('loss')), ['games-10']);
  });

  it('never unlocks or pays twice, and the same game recorded twice counts once', async () => {
    const g = game('win');
    await play(g);
    const coins = await store.coins(userId);
    assert.deepEqual(await play(g), [], 'duplicate game');
    assert.deepEqual((await manager.evaluate(userId)).unlocked, []);
    assert.equal((await statsNow()).gamesPlayed, 1);
    assert.equal(await store.coins(userId), coins);

    // Even a direct second unlock attempt is ignored by the store.
    assert.equal(await store.insertAchievementUnlock(userId, 'wins-1', 999), false);
    assert.equal(await store.coins(userId), coins);
    assert.equal((await store.listAchievements(userId)).filter((r) => r.achievementId === 'wins-1').length, 1);
  });

  it('one game can unlock several achievements at once', async () => {
    for (let i = 0; i < 9; i++) await store.recordMatch(userId, game('win'));
    await manager.evaluate(userId);
    const unlocked = await play(game('win'));
    // The 10th straight win: 10 games, 10 wins and a 10-game streak together.
    assert.deepEqual(unlocked.sort(), ['games-10', 'streak-10', 'wins-10']);
    const coins = await store.coins(userId);
    assert.equal(coins, coinsFor('games-1', 'wins-1', 'pvp-1', 'streak-3', 'streak-5', 'games-10', 'wins-10', 'streak-10'));
  });

  it('backfills from games played before achievements existed', async () => {
    for (let i = 0; i < 53; i++) await store.recordMatch(userId, game('win'));
    const overview = await manager.overview(userId);
    const got = new Set(overview.newlyUnlocked.map((a) => a.id));
    for (const id of ['wins-1', 'wins-10', 'wins-50', 'games-50', 'streak-20', 'pvp-25']) assert.ok(got.has(id), id);
    assert.ok(!got.has('wins-100'));
    assert.equal(overview.summary.unlocked, got.size);
    assert.equal(overview.coins, [...got].reduce((sum, id) => sum + coinsFor(id), 0));
    assert.deepEqual((await manager.overview(userId)).newlyUnlocked, [], 'reported once');
  });

  it('keeps hidden achievements secret until unlocked', async () => {
    const secret = async () => (await manager.overview(userId)).achievements.find((a) => a.id === 'perfect-five')!;
    let v = await secret();
    assert.equal(v.secret, true);
    assert.equal(v.name, '???');
    assert.equal(v.description, 'Thành tích bí mật');
    assert.equal(v.icon, null);
    assert.deepEqual(v.rewards, [{ type: 'title', title: null }, { type: 'nameStyle', nameStyle: null }], 'only says a secret title and a secret name style are part of it');
    assert.equal(v.current, null);
    assert.equal(v.target, null);
    assert.equal(v.percentage, 0, 'progress would hint at the condition');

    // X wins with its 5th move: 9 moves on the board, 5 of them X's.
    await play(game('win', { reason: 'five', moves: moves(9), winLine: [0, 2, 4, 6, 8] }));
    v = await secret();
    assert.equal(v.unlocked, true);
    assert.equal(v.secret, false);
    assert.equal(v.name, def('perfect-five').name);
    assert.ok(v.unlockedAt);
    assert.equal((await statsNow()).fastestWinMoves, 5);
  });

  it('counts moves: your own, and the longest game', async () => {
    await play(game('loss', { myMark: 'O', moves: moves(101) }), game('win', { myMark: 'X', moves: moves(11) }));
    const s = await statsNow();
    assert.equal(s.totalMovesPlayed, 50 + 6);
    assert.equal(s.longestGameMoves, 101);
    assert.ok((await manager.overview(userId)).achievements.find((a) => a.id === 'long-game')!.unlocked);
  });

  it('progress never goes past 100%', async () => {
    for (let i = 0; i < 12; i++) await store.recordMatch(userId, game('win'));
    for (const a of (await manager.overview(userId)).achievements) {
      assert.ok(a.progress >= 0 && a.progress <= 1, a.id);
      assert.ok(a.percentage >= 0 && a.percentage <= 100, a.id);
    }
    const first = (await manager.overview(userId)).achievements.find((a) => a.id === 'wins-1')!;
    assert.equal(first.current, 12);
    assert.equal(first.percentage, 100);
  });
});

describe('achievements over the network', () => {
  let server: CaroServer | null = null;
  let clients: Socket[] = [];
  let baseUrl = '';

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients = [];
    await server?.close();
    server = null;
  });

  async function boot() {
    const base = loadConfig({});
    const cfg: AppConfig = {
      ...base,
      turnMs: 5_000,
      startCountdownMs: 80,
      disconnectForfeitMs: 5_000,
      botMinDelayMs: 30,
      botMaxDelayMs: 60,
      accounts: { ...base.accounts, databasePath: ':memory:' },
    };
    server = createCaroServer(cfg, undefined, undefined, undefined, new AccountStore(':memory:'));
    await new Promise<void>((resolve) => server!.httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
  }

  async function client(token?: string) {
    const s = connectClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false, auth: token ? { token } : {} });
    clients.push(s);
    await new Promise<void>((resolve) => s.once('connect', () => resolve()));
    return s;
  }

  const call = (s: Socket, event: string, data: unknown): Promise<any> => s.timeout(2_000).emitWithAck(event, data);
  const next = <T = any>(s: Socket, event: string, ms = 4_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
      s.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  it('a win pushes the unlocks after game:finished, pays coins, and every device sees the same list', async () => {
    await boot();
    const reg = await api('POST', '/api/auth/register', { email: 'win@example.com', password: 'correct horse' });
    const token = reg.body.token as string;
    assert.equal(reg.body.user.coins, 0);
    assert.deepEqual(reg.body.achievements, []);

    const a = await client(token);
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const started = next(a, 'game:started');
    for (const s of [a, b]) await call(s, 'room:ready', { roomId: created.roomId });
    await started;

    const order: string[] = [];
    a.on('game:finished', () => order.push('finished'));
    const pushed = next<{ achievements: { id: string; reward: { coins: number } }[]; coins: number }>(a, 'achievement:unlocked');
    a.on('achievement:unlocked', () => order.push('achievement'));
    await call(b, 'game:resign', { roomId: created.roomId });
    const event = await pushed;
    assert.deepEqual(order, ['finished', 'achievement']);
    assert.deepEqual(event.achievements.map((x) => x.id).sort(), ['games-1', 'pvp-1', 'wins-1']);
    assert.equal(event.coins, coinsFor('games-1', 'pvp-1', 'wins-1'));

    // The guest opponent gets nothing.
    let guestGot = false;
    b.on('achievement:unlocked', () => (guestGot = true));

    const list = await api('GET', '/api/me/achievements', undefined, token);
    assert.equal(list.status, 200);
    assert.equal(list.body.summary.unlocked, 3);
    assert.equal(list.body.summary.total, ACHIEVEMENTS.length);
    assert.equal(list.body.coins, event.coins);
    assert.deepEqual(list.body.newlyUnlocked, [], 'already reported by the push');
    const first = list.body.achievements.find((x: { id: string }) => x.id === 'wins-1');
    assert.equal(first.unlocked, true);
    assert.equal(typeof first.unlockedAt, 'number');

    // Logging in elsewhere (a new session) sees the same achievements and balance.
    const login = await api('POST', '/api/auth/login', { email: 'win@example.com', password: 'correct horse' });
    assert.equal(login.body.user.coins, event.coins);
    assert.deepEqual(login.body.achievements, []);
    const again = await api('GET', '/api/me/achievements', undefined, login.body.token);
    assert.deepEqual(
      again.body.achievements.filter((x: { unlocked: boolean }) => x.unlocked).map((x: { id: string }) => x.id),
      list.body.achievements.filter((x: { unlocked: boolean }) => x.unlocked).map((x: { id: string }) => x.id),
    );
    const me = await api('GET', '/api/me', undefined, token);
    assert.equal(me.body.user.coins, event.coins);
    assert.deepEqual(me.body.newAchievements, []);
    assert.equal(guestGot, false);
  });

  it('games claimed at sign-up unlock in the sign-up response; clients cannot unlock anything themselves', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const started = next(a, 'game:started');
    for (const s of [a, b]) await call(s, 'room:ready', { roomId: created.roomId });
    await started;
    const done = next(a, 'game:finished');
    await call(a, 'game:resign', { roomId: created.roomId });
    await done;

    const reg = await api('POST', '/api/auth/register', { email: 'bob@example.com', password: 'correct horse', guestTokens: [joined.token] });
    assert.equal(reg.body.claimed, 1);
    assert.deepEqual(reg.body.achievements.map((x: { id: string }) => x.id).sort(), ['games-1', 'pvp-1', 'wins-1']);
    assert.equal(reg.body.user.coins, coinsFor('games-1', 'pvp-1', 'wins-1'));

    const token = reg.body.token as string;
    for (const path of ['/api/me/achievements', '/api/me/achievements/games-500', '/api/me/achievements/unlock']) {
      const res = await api('POST', path, { achievementId: 'games-500' }, token);
      assert.ok(res.status === 404, `${path} is not writable`);
    }
    assert.equal((await api('GET', '/api/me/achievements', undefined, token)).body.summary.unlocked, 3);
    assert.equal((await api('GET', '/api/me/achievements')).status, 401);
  });
});
