import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { AccountStore, type MatchRecord, type MatchResult } from '../src/accounts/accountStore.js';
import { AchievementManager } from '../src/achievements/achievementManager.js';
import { ACHIEVEMENTS, type AchievementDefinition } from '../src/achievements/definitions.js';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { coins, RewardService, title, type Reward } from '../src/rewards/rewardService.js';
import { TitleService } from '../src/titles/titleService.js';
import { TITLE_EFFECTS, TITLE_LIST, TITLE_RARITIES, TITLES, isSecretTitle } from '../src/titles/titles.js';

/* Titles: granted only as achievement rewards, owned once, equipped with a server-side ownership check, shown live in rooms. */

let seq = 0;
function game(result: MatchResult, extra: Partial<MatchRecord> = {}): MatchRecord {
  seq += 1;
  const at = 1_700_000_000_000 + seq * 60_000;
  return {
    roomId: `troom${seq}`,
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

const titleRewards = (d: AchievementDefinition) => (d.rewards ?? []).filter((r): r is Extract<Reward, { type: 'title' }> => r.type === 'title');

describe('title catalogue', () => {
  it('has 15–20 well-formed titles, each granted by exactly one achievement', () => {
    assert.ok(TITLE_LIST.length >= 15 && TITLE_LIST.length <= 20);
    for (const t of TITLE_LIST) {
      assert.ok(t.name && t.description && t.icon, t.id);
      assert.ok(TITLE_RARITIES.includes(t.rarity), t.id);
      assert.ok(TITLE_EFFECTS.includes(t.effect), t.id);
      const sources = ACHIEVEMENTS.filter((d) => titleRewards(d).some((r) => r.titleId === t.id));
      assert.equal(sources.length, 1, `${t.id} has one source achievement`);
      // A secret title comes from an achievement that is itself secret, so its condition stays hidden too.
      if (isSecretTitle(t)) assert.equal(sources[0].hidden, true, t.id);
    }
    for (const r of ['common', 'rare', 'epic', 'legendary', 'secret'] as const) assert.ok(TITLE_LIST.some((t) => t.rarity === r), r);
    // Not every achievement gives a title.
    assert.ok(ACHIEVEMENTS.some((d) => !titleRewards(d).length));
  });
});

describe('achievement → reward → title', () => {
  let store: AccountStore;
  let achievements: AchievementManager;
  let titles: TitleService;
  let userId: string;

  beforeEach(() => {
    store = new AccountStore(':memory:');
    achievements = new AchievementManager(store);
    titles = new TitleService(store, achievements);
    userId = store.createUser({ email: 't@example.com', passwordHash: 'x', nickname: 'T', avatar: null })!.id;
  });
  afterEach(() => store.close());

  const owned = () => store.listTitles(userId).map((t) => t.titleId).sort();
  const play = (...records: MatchRecord[]) => {
    for (const r of records) store.recordMatch(userId, r);
    return achievements.evaluate(userId);
  };

  it('no completed achievement, no title', () => {
    assert.deepEqual(achievements.evaluate(userId).unlocked, []);
    assert.deepEqual(owned(), []);
    const c = titles.collection(userId);
    assert.equal(c.summary.owned, 0);
    assert.equal(c.equippedTitleId, null);
    assert.ok(c.titles.every((t) => !t.owned && !t.equipped));
  });

  it('completing an achievement grants its title and coins together, and reports both', () => {
    const { unlocked } = play(game('loss'));
    assert.deepEqual(unlocked.map((a) => a.id), ['games-1']);
    assert.deepEqual(unlocked[0].rewards, [
      { type: 'coins', amount: 20 },
      { type: 'title', title: { id: 'tan-binh', name: 'Tân Binh', description: TITLES['tan-binh'].description, icon: '🌱', rarity: 'common', effect: 'none' } },
    ]);
    assert.deepEqual(owned(), ['tan-binh']);
    assert.equal(store.coins(userId), 20);
    const row = store.listTitles(userId)[0];
    assert.equal(row.sourceType, 'achievement');
    assert.equal(row.sourceId, 'games-1');
  });

  it('processing the same result again never duplicates a title or coins', () => {
    const g = game('win');
    play(g);
    const before = { titles: owned(), coins: store.coins(userId) };
    play(g); // the same game recorded twice
    achievements.evaluate(userId);
    achievements.evaluate(userId);
    assert.deepEqual(owned(), before.titles);
    assert.equal(store.coins(userId), before.coins);
    // Even a direct second grant is a no-op in the database.
    assert.equal(store.grantTitle(userId, 'tan-binh', { type: 'achievement', id: 'games-1' }), false);
    assert.equal(store.listTitles(userId).filter((t) => t.titleId === 'tan-binh').length, 1);
  });

  it('an achievement with several rewards grants all of them; one without a title grants none', () => {
    const custom: AchievementDefinition[] = [
      { id: 'multi', name: 'm', description: 'm', icon: 'x', category: 'special', rarity: 'epic', stat: 'gamesPlayed', target: 1, rewards: [coins(10), title('bat-bai'), title('cao-thu'), coins(5)] },
      { id: 'plain', name: 'p', description: 'p', icon: 'x', category: 'special', rarity: 'common', stat: 'gamesPlayed', target: 1, rewards: [coins(7)] },
      { id: 'none', name: 'n', description: 'n', icon: 'x', category: 'special', rarity: 'common', stat: 'gamesPlayed', target: 1 },
    ];
    const manager = new AchievementManager(store, custom);
    store.recordMatch(userId, game('win'));
    const { unlocked } = manager.evaluate(userId);
    assert.deepEqual(unlocked.map((a) => a.id), ['multi', 'plain', 'none']);
    assert.deepEqual(owned(), ['bat-bai', 'cao-thu']);
    assert.equal(store.coins(userId), 22);
    assert.deepEqual(unlocked[2].rewards, []);
  });

  it('an unknown title id in a reward is skipped, never stored', () => {
    const rewards = new RewardService(store);
    const res = rewards.grant(userId, { type: 'title', titleId: 'not-a-title' as never }, { type: 'achievement', id: 'x' });
    assert.equal(res.granted, false);
    assert.deepEqual(owned(), []);
  });

  it('equip: only owned titles; switching replaces; unequip clears', () => {
    assert.deepEqual(titles.equip(userId, 'tan-binh'), { ok: false, error: 'TITLE_LOCKED' });
    assert.deepEqual(titles.equip(userId, 'made-up'), { ok: false, error: 'TITLE_NOT_FOUND' });
    assert.deepEqual(titles.equip(userId, '__proto__'), { ok: false, error: 'TITLE_NOT_FOUND' });
    assert.equal(store.equippedTitleId(userId), null);

    for (let i = 0; i < 3; i++) store.recordMatch(userId, game('win'));
    achievements.evaluate(userId);
    assert.deepEqual(owned(), ['phong-do-cao', 'tan-binh']);

    const a = titles.equip(userId, 'tan-binh');
    assert.equal(a.ok && a.title?.name, 'Tân Binh');
    assert.equal(store.equippedTitleId(userId), 'tan-binh');
    titles.equip(userId, 'phong-do-cao');
    assert.equal(store.equippedTitleId(userId), 'phong-do-cao');
    const view = titles.collection(userId).titles;
    assert.deepEqual(view.filter((t) => t.equipped).map((t) => t.key), ['phong-do-cao'], 'only one at a time');
    // Still can't equip one they don't own, and a failed attempt keeps the current one.
    assert.equal(titles.equip(userId, 'huyen-thoai').ok, false);
    assert.equal(store.equippedTitleId(userId), 'phong-do-cao');
    assert.deepEqual(titles.equip(userId, null), { ok: true, titleId: null, title: null });
    assert.equal(store.equippedTitleId(userId), null);
  });

  it('notifies equip listeners (the realtime hook) only on success', () => {
    const seen: (string | null)[] = [];
    titles.onEquipped((_u, id) => seen.push(id));
    titles.equip(userId, 'tan-binh');
    play(game('loss'));
    titles.equip(userId, 'tan-binh');
    titles.equip(userId, null);
    assert.deepEqual(seen, ['tan-binh', null]);
  });

  it('secret titles stay masked until owned, then show in full', () => {
    const secret = () => titles.collection(userId).titles.find((t) => t.rarity === 'secret')!;
    let v = secret();
    assert.equal(v.title, null);
    assert.equal(v.source, null, 'no condition, no achievement name');
    assert.ok(!v.key.includes('tu-than'), 'the key does not give the id away');
    assert.ok(!JSON.stringify(titles.catalog()).includes('Tử Thần'));
    assert.ok(!JSON.stringify(titles.collection(userId)).includes('Tử Thần'));
    const perfect = achievements.overview(userId).achievements.find((a) => a.id === 'perfect-five')!;
    assert.deepEqual(perfect.rewards, [{ type: 'title', title: null }, { type: 'nameStyle', nameStyle: null }]);

    // X wins with its 5th move.
    play(game('win', { reason: 'five', moves: Array.from({ length: 9 }, (_, i) => i), winLine: [0, 2, 4, 6, 8] }));
    v = secret();
    assert.equal(v.owned, true);
    assert.equal(v.title?.name, 'Tử Thần Caro');
    assert.equal(v.title?.effect, 'glitch');
    assert.equal(v.source?.secret, false);
    assert.equal(titles.equip(userId, 'tu-than').ok, true);
  });

  it('shows the source achievement and its progress for locked titles', () => {
    for (let i = 0; i < 4; i++) store.recordMatch(userId, game('win'));
    const v = titles.collection(userId).titles.find((t) => t.key === 'ke-chien-thang')!;
    assert.equal(v.owned, false);
    assert.equal(v.title?.name, 'Kẻ Chiến Thắng');
    assert.deepEqual(v.source && [v.source.achievementId, v.source.percentage, v.source.unlocked], ['wins-10', 40, false]);
  });

  it('new stats back the new title achievements: draws, wins as O, wins by five, distinct opponents', () => {
    for (let i = 0; i < 5; i++) store.recordMatch(userId, game('draw'));
    for (let i = 0; i < 10; i++) store.recordMatch(userId, game('win', { opponentUserId: `rival${i % 5}` }));
    const s = store.stats(userId);
    assert.equal(s.overall.draws, 5);
    assert.equal(s.distinctOpponentsBeaten, 5, 'the same account beaten twice counts once');
    store.recordMatch(userId, game('win', { myMark: 'O', reason: 'five', moves: Array.from({ length: 20 }, (_, i) => i) }));
    const t = store.stats(userId);
    assert.equal(t.winsAsO, 1);
    assert.equal(t.winsByFive, 1);
    achievements.evaluate(userId);
    assert.ok(owned().includes('hoa-binh'));
    assert.ok(!owned().includes('ke-thach-dau'));
  });
});

describe('existing players: migration and backfill', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caro-titles-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('an account from before titles migrates cleanly and gets the titles of achievements it already had, once', () => {
    const path = join(dir, 'caro.db');
    // Build a schema-2 database the way it looked before titles: achievements unlocked, coins paid.
    let store = new AccountStore(path);
    const userId = store.createUser({ email: 'old@example.com', passwordHash: 'x', nickname: 'Old', avatar: null })!.id;
    for (let i = 0; i < 10; i++) store.recordMatch(userId, game('win'));
    store.transaction(() => {
      for (const id of ['games-1', 'games-10', 'wins-1', 'wins-10', 'streak-3', 'streak-5', 'streak-10', 'pvp-1']) store.insertAchievementUnlock(userId, id, 0);
      store.addCoins(userId, 1234);
    });
    store.close();
    const raw = new DatabaseSync(path);
    raw.exec('ALTER TABLE users DROP COLUMN avatar_frame_id; DROP TABLE user_cosmetics; ALTER TABLE users DROP COLUMN name_style_id; DROP TABLE user_titles; ALTER TABLE users DROP COLUMN equipped_title_id; PRAGMA user_version = 2;');
    raw.close();

    // Reopening runs migration 3.
    store = new AccountStore(path);
    const user = store.getUser(userId)!;
    assert.equal(user.equippedTitleId, null);
    assert.equal(user.coins, 1234);
    assert.deepEqual(store.listTitles(userId), []);
    assert.equal(store.listAchievements(userId).length, 8, 'old achievements are intact');

    const achievements = new AchievementManager(store);
    const first = achievements.evaluate(userId);
    assert.deepEqual(first.unlocked, [], 'nothing new to unlock');
    const expected = ['bat-bai', 'chien-binh', 'ke-chien-thang', 'ke-huy-diet', 'phong-do-cao', 'tan-binh'];
    assert.deepEqual(first.restoredTitles.map((t) => t.id).sort(), expected);
    assert.deepEqual(store.listTitles(userId).map((t) => t.titleId).sort(), expected);
    assert.equal(store.coins(userId), 1234, 'backfill never pays coins again');

    // Running the backfill again (or through the collection) changes nothing.
    assert.deepEqual(achievements.evaluate(userId).restoredTitles, []);
    const titles = new TitleService(store, achievements);
    assert.deepEqual(titles.collection(userId).restoredTitles, []);
    assert.equal(store.listTitles(userId).length, expected.length);

    // Equipping persists across a restart.
    assert.equal(titles.equip(userId, 'ke-huy-diet').ok, true);
    store.close();
    store = new AccountStore(path);
    assert.equal(store.getUser(userId)!.equippedTitleId, 'ke-huy-diet');
    assert.equal(new TitleService(store, new AchievementManager(store)).collection(userId).titles.find((t) => t.equipped)?.key, 'ke-huy-diet');
    store.close();
  });

  it('equipping a title that is due but not yet backfilled works on the first try', () => {
    const store = new AccountStore(':memory:');
    const userId = store.createUser({ email: 'x@example.com', passwordHash: 'x', nickname: 'X', avatar: null })!.id;
    store.recordMatch(userId, game('loss'));
    store.insertAchievementUnlock(userId, 'games-1', 20);
    const titles = new TitleService(store, new AchievementManager(store));
    assert.equal(titles.equip(userId, 'tan-binh').ok, true);
    store.close();
  });
});

describe('titles over the network', () => {
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
    const cfg: AppConfig = { ...base, turnMs: 5_000, startCountdownMs: 80, accounts: { ...base.accounts, databasePath: ':memory:' } };
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
  const next = <T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 4_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
      const handler = (payload: T) => {
        if (!pred(payload)) return;
        clearTimeout(timer);
        s.off(event, handler);
        resolve(payload);
      };
      s.on(event, handler);
    });

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  /** A registered player who has played (and so earned "Tân Binh"). */
  async function veteran(email: string) {
    const reg = await api('POST', '/api/auth/register', { email, password: 'correct horse', nickname: email.split('@')[0] });
    const token = reg.body.token as string;
    server!.accounts.recordMatch(reg.body.user.id, game('loss'));
    return { token, id: reg.body.user.id as string };
  }

  it('equip / unequip over HTTP: validated server-side, persisted, reflected in /api/me', async () => {
    await boot();
    const { token } = await veteran('eq@example.com');

    assert.equal((await api('GET', '/api/me/titles')).status, 401);
    assert.equal((await api('PATCH', '/api/me/title', { titleId: 'tan-binh' })).status, 401);

    const list = await api('GET', '/api/me/titles', undefined, token);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.newlyUnlocked.map((a: { id: string }) => a.id), ['games-1'], 'backfilled on read, reported once');
    assert.equal(list.body.summary.owned, 1);
    assert.equal(list.body.titles.find((t: { key: string }) => t.key === 'tan-binh').owned, true);

    const fake = await api('PATCH', '/api/me/title', { titleId: 'no-such-title' }, token);
    assert.deepEqual([fake.status, fake.body.error], [404, 'TITLE_NOT_FOUND']);
    const locked = await api('PATCH', '/api/me/title', { titleId: 'huyen-thoai' }, token);
    assert.deepEqual([locked.status, locked.body.error], [403, 'TITLE_LOCKED']);
    const secret = await api('PATCH', '/api/me/title', { titleId: 'tu-than' }, token);
    assert.equal(secret.status, 403);
    for (const bad of [{}, { titleId: 5 }, { titleId: '' }, { titleId: 'x'.repeat(100) }]) {
      assert.equal((await api('PATCH', '/api/me/title', bad, token)).status, 400, JSON.stringify(bad));
    }

    const ok = await api('PATCH', '/api/me/title', { titleId: 'tan-binh' }, token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title.name, 'Tân Binh');
    assert.equal(ok.body.user.title.id, 'tan-binh');
    // A fresh session (refresh, another device) sees the same.
    const login = await api('POST', '/api/auth/login', { email: 'eq@example.com', password: 'correct horse' });
    assert.equal(login.body.user.title.id, 'tan-binh');
    assert.equal((await api('GET', '/api/me', undefined, login.body.token)).body.user.title.id, 'tan-binh');

    const off = await api('PATCH', '/api/me/title', { titleId: null }, token);
    assert.equal(off.body.titleId, null);
    assert.equal((await api('GET', '/api/me', undefined, token)).body.user.title, null);
  });

  it('there is no way for a client to unlock a title or fake an achievement', async () => {
    await boot();
    const reg = await api('POST', '/api/auth/register', { email: 'cheat@example.com', password: 'correct horse' });
    const token = reg.body.token as string;
    for (const [method, path] of [
      ['POST', '/api/me/titles'],
      ['POST', '/api/titles/unlock'],
      ['POST', '/api/unlock-title'],
      ['POST', '/api/me/title'],
      ['PUT', '/api/me/titles/huyen-thoai'],
      ['POST', '/api/me/achievements'],
    ] as const) {
      const res = await api(method, path, { titleId: 'huyen-thoai', achievementId: 'wins-500', unlocked: true }, token);
      assert.equal(res.status, 404, `${method} ${path}`);
    }
    // Profile updates ignore anything but nickname / avatar.
    await api('PATCH', '/api/me', { nickname: 'Cheat', title: 'huyen-thoai', equippedTitleId: 'huyen-thoai', coins: 999 }, token);
    const me = await api('GET', '/api/me', undefined, token);
    assert.equal(me.body.user.title, null);
    assert.equal(me.body.user.coins, 0);
    const list = await api('GET', '/api/me/titles', undefined, token);
    assert.equal(list.body.summary.owned, 0);
  });

  it('the public catalogue needs no login and hides secret titles', async () => {
    await boot();
    const res = await api('GET', '/api/titles');
    assert.equal(res.status, 200);
    assert.equal(res.body.titles.length, TITLE_LIST.length);
    const secret = res.body.titles.filter((t: { rarity: string }) => t.rarity === 'secret');
    assert.ok(secret.length >= 1 && secret.every((t: { title: unknown; source: unknown }) => t.title === null && t.source === null));
    assert.equal(res.body.titles.find((t: { key: string }) => t.key === 'bat-bai').source.achievementId, 'streak-5');
  });

  it('room seats carry the equipped title, and a change reaches everyone in the room live', async () => {
    await boot();
    const alice = await veteran('alice@example.com');
    await api('GET', '/api/me/titles', undefined, alice.token); // unlock + grant
    await api('PATCH', '/api/me/title', { titleId: 'tan-binh' }, alice.token);

    const a = await client(alice.token);
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const seatA = () => joined.state.players.find((p: { id: string }) => p.id === created.playerId);
    assert.equal(seatA().title.id, 'tan-binh');
    assert.equal(joined.state.players.find((p: { id: string }) => p.id === joined.playerId).title, null, 'guests have none');

    const pushedToMe = next(a, 'title:equipped');
    const seenByOpponent = next(b, 'room:state', (s: any) => s.players.find((p: { id: string }) => p.id === created.playerId)?.title === null);
    await api('PATCH', '/api/me/title', { titleId: null }, alice.token);
    await seenByOpponent;
    assert.equal((await pushedToMe).titleId, null);

    // A failed equip broadcasts nothing.
    let broadcasts = 0;
    b.on('room:state', () => broadcasts++);
    await api('PATCH', '/api/me/title', { titleId: 'huyen-thoai' }, alice.token);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(broadcasts, 0);

    // Signing in mid-room picks the title up too.
    await api('PATCH', '/api/me/title', { titleId: 'tan-binh' }, alice.token);
    const c = await client();
    const other = await call(c, 'room:create', { name: 'Guest' });
    const signedIn = next(c, 'room:state', (s: any) => s.players.find((p: { id: string }) => p.id === other.playerId)?.title?.id === 'tan-binh');
    await call(c, 'auth:identify', { token: alice.token });
    await signedIn;
  });

  it('tournaments: participants show their title in the lobby and follow an equip live', async () => {
    await boot();
    const host = await veteran('host@example.com');
    await api('GET', '/api/me/titles', undefined, host.token);
    await api('PATCH', '/api/me/title', { titleId: 'tan-binh' }, host.token);

    const h = await client(host.token);
    const guest = await client();
    const created = await call(h, 'tournament:create', { name: 'Cup', playerName: 'Host', size: 4 });
    assert.equal(created.state.participants[0].title.id, 'tan-binh');
    const joined = await call(guest, 'tournament:join', { tournamentId: created.tournamentId, name: 'Guest' });
    assert.equal(joined.state.participants.find((p: any) => p.name === 'Guest').title, null, 'guests have none');

    const off = next(guest, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Host' && p.title === null));
    await api('PATCH', '/api/me/title', { titleId: null }, host.token);
    await off;
    const on = next(guest, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Host' && p.title?.id === 'tan-binh'));
    await api('PATCH', '/api/me/title', { titleId: 'tan-binh' }, host.token);
    await on;

    // Signing in inside the lobby picks the account's title up.
    const signedIn = next(guest, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Guest' && p.title?.id === 'tan-binh'));
    await call(guest, 'auth:identify', { token: host.token });
    await signedIn;
  });

  it('a game that completes an achievement pushes its title reward; gameplay is unaffected', async () => {
    await boot();
    const reg = await api('POST', '/api/auth/register', { email: 'push@example.com', password: 'correct horse' });
    const a = await client(reg.body.token);
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const started = next(a, 'game:started');
    for (const s of [a, b]) await call(s, 'room:ready', { roomId: created.roomId });
    await started;
    const pushed = next<any>(a, 'achievement:unlocked');
    const finished = next<any>(b, 'game:finished');
    await call(b, 'game:resign', { roomId: created.roomId });
    assert.equal((await finished).reason, 'resign');
    const event = await pushed;
    const first = event.achievements.find((x: { id: string }) => x.id === 'games-1');
    assert.deepEqual(first.rewards.map((r: { type: string }) => r.type), ['coins', 'title']);
    assert.equal(first.rewards[1].title.id, 'tan-binh');
    assert.deepEqual(event.restoredTitles, []);
    const list = await api('GET', '/api/me/titles', undefined, reg.body.token);
    assert.equal(list.body.titles.find((t: { key: string }) => t.key === 'tan-binh').owned, true);
    assert.deepEqual(list.body.newlyUnlocked, [], 'already reported by the push');
  });
});
