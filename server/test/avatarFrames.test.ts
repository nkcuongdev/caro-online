import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { AccountStore, MIGRATIONS, type MatchRecord } from '../src/accounts/accountStore.js';
import { AchievementManager } from '../src/achievements/achievementManager.js';
import { ACHIEVEMENTS } from '../src/achievements/definitions.js';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { AvatarFrameError, AvatarFrameService, avatarFrameLinks } from '../src/cosmetics/avatarFrameService.js';
import { AVATAR_FRAMES, DEFAULT_AVATAR_FRAME, framePrice, getAvatarFrame, isSecretFrame, resolveAvatarFrameId } from '../src/cosmetics/avatarFrames.js';
import { RARITIES } from '../src/cosmetics/rarity.js';

/* Avatar frames: catalogue, ownership, equip, coins, achievement rewards, secrets, migration, and live updates in rooms and tournaments. */

let seq = 0;
function game(extra: Partial<MatchRecord> = {}): MatchRecord {
  seq += 1;
  const at = 1_700_000_000_000 + seq * 60_000;
  return {
    roomId: `af${seq}`,
    round: 1,
    mode: 'pvp',
    result: 'win',
    reason: 'resign',
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

/** A won tournament final: unlocks `champion-1`, which grants `frame_crown`. */
const wonFinal = () => game({ mode: 'tournament', tournamentId: 't1', tournamentName: 'Cup', tournamentRound: 1, tournamentTotalRounds: 2 });
/** A 200-move game: unlocks the hidden `marathon`, which grants the secret `frame_nebula`. */
const marathon = () => game({ result: 'draw', reason: 'draw', moves: Array.from({ length: 200 }, (_, i) => i) });

/** The error code a call throws. */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AvatarFrameError) return err.code;
    throw err;
  }
  return 'NO_ERROR';
}

const links = avatarFrameLinks(ACHIEVEMENTS);

describe('avatar frame catalogue', () => {
  it('is well-formed: unique ids, the shared five rarities, a free default, prices only where sold', () => {
    const ids = new Set<string>();
    for (const f of AVATAR_FRAMES) {
      assert.ok(!ids.has(f.id), `duplicate ${f.id}`);
      ids.add(f.id);
      assert.match(f.id, /^[a-z0-9_]+$/);
      assert.ok(RARITIES.includes(f.rarity), f.id);
      assert.ok(f.name && f.description, f.id);
      if (f.unlock.type === 'coin') assert.ok(framePrice(f)! > 0, `${f.id} has a positive price`);
      else assert.equal(framePrice(f), null, `${f.id} is not sold`);
      if (f.rarity === 'secret') assert.equal(f.unlock.type, 'secret', `${f.id}: secrets are never sold`);
    }
    const def = getAvatarFrame(DEFAULT_AVATAR_FRAME)!;
    assert.deepEqual([def.rarity, def.unlock.type], ['common', 'default']);
    for (const r of RARITIES) assert.ok(AVATAR_FRAMES.some((f) => f.rarity === r), `has a ${r} frame`);
    assert.ok(AVATAR_FRAMES.length >= 8 && AVATAR_FRAMES.length <= 10);
  });

  it('achievement and secret frames are each granted by exactly one achievement, secrets only by hidden ones', () => {
    const granted = ACHIEVEMENTS.flatMap((a) => (a.rewards ?? []).filter((r) => r.type === 'avatarFrame').map((r) => ({ a, id: r.avatarFrameId })));
    for (const { a, id } of granted) {
      const f = getAvatarFrame(id);
      assert.ok(f, `${a.id} rewards a known frame (${id})`);
      assert.ok(f.unlock.type === 'achievement' || f.unlock.type === 'secret', `${id} is an achievement/secret frame`);
      if (isSecretFrame(f)) assert.ok(a.hidden, `${id} comes from a hidden achievement`);
    }
    for (const f of AVATAR_FRAMES.filter((x) => x.unlock.type === 'achievement' || x.unlock.type === 'secret')) {
      assert.equal(granted.filter((g) => g.id === f.id).length, 1, `${f.id} has one source`);
    }
  });

  it('resolves only real ids: paths, markup and unknown ids are the default', () => {
    assert.equal(resolveAvatarFrameId('frame_fire'), 'frame_fire');
    for (const bad of [undefined, null, '', 'frame_nope', '../../something', '<script>', '__proto__', 'constructor', 42, { id: 'frame_fire' }, 'FRAME_FIRE']) {
      assert.equal(resolveAvatarFrameId(bad), DEFAULT_AVATAR_FRAME, String(bad));
      assert.equal(getAvatarFrame(bad), null);
    }
  });
});

describe('avatar frame ownership, coins and achievements', () => {
  let store: AccountStore;
  let frames: AvatarFrameService;
  let achievements: AchievementManager;
  let userId: string;

  beforeEach(async () => {
    store = new AccountStore(':memory:');
    frames = new AvatarFrameService(store, links);
    achievements = new AchievementManager(store);
    userId = (await store.createUser({ email: 'f@example.com', passwordHash: 'x', nickname: 'F', avatar: null }))!.id;
  });
  afterEach(async () => {
    await store.close();
  });

  const view = async (id: string) => (await frames.overview(userId)).frames.find((f) => f.id === id)!;

  it('a new account owns the default frame and wears it; guests too', async () => {
    assert.deepEqual([...(await frames.ownedIds(userId))], [DEFAULT_AVATAR_FRAME]);
    assert.equal(await frames.equippedFor(userId), DEFAULT_AVATAR_FRAME);
    assert.equal((await store.getUser(userId))!.avatarFrameId, null);
    const o = await frames.overview(userId);
    assert.equal(o.equippedAvatarFrame, DEFAULT_AVATAR_FRAME);
    assert.deepEqual(o.ownedAvatarFrames, [DEFAULT_AVATAR_FRAME]);
    assert.deepEqual(o.frames.filter((f) => f.owned).map((f) => f.id), [DEFAULT_AVATAR_FRAME]);
    assert.equal(await frames.equippedFor(null), DEFAULT_AVATAR_FRAME, 'guests');
    assert.deepEqual((await frames.equip(userId, DEFAULT_AVATAR_FRAME)).equippedAvatarFrame, DEFAULT_AVATAR_FRAME, 'always equippable');
  });

  it('refuses to equip unowned, unknown or malformed frames, with the reason', async () => {
    assert.equal(await codeOf(() => frames.equip(userId, 'frame_fire')), 'FRAME_NOT_OWNED');
    assert.equal(await codeOf(() => frames.equip(userId, 'frame_crown')), 'ACHIEVEMENT_REQUIRED');
    assert.equal(await codeOf(() => frames.equip(userId, 'frame_nebula')), 'FRAME_NOT_OWNED', 'a secret never names its condition');
    assert.equal(await codeOf(() => frames.equip(userId, 'frame_nope')), 'FRAME_NOT_FOUND');
    for (const bad of ['../../something', '<script>', '', { id: 'frame_fire' }, 7]) assert.equal(await codeOf(() => frames.equip(userId, bad)), 'INVALID_FRAME');
    assert.equal(await frames.equippedFor(userId), DEFAULT_AVATAR_FRAME);
  });

  it('buys with enough coins (price from the catalogue), then equips and goes back to default', async () => {
    await store.addCoins(userId, 5_000);
    const bought = await frames.buy(userId, 'frame_fire');
    assert.equal(bought.coins, 2_000);
    assert.equal(bought.frame.owned, true);
    assert.deepEqual(bought.ownedAvatarFrames.sort(), [DEFAULT_AVATAR_FRAME, 'frame_fire'].sort());
    assert.equal((await store.listCosmetics(userId, 'avatar_frame'))[0].cost, 3_000);

    const events: [string, string][] = [];
    frames.onEquipped((u, f) => events.push([u, f]));
    assert.equal((await frames.equip(userId, 'frame_fire')).equippedAvatarFrame, 'frame_fire');
    assert.equal(await frames.equippedFor(userId), 'frame_fire');
    assert.equal((await view('frame_fire')).equipped, true);
    await frames.equip(userId, 'frame_fire'); // no change, no event
    await frames.equip(userId, DEFAULT_AVATAR_FRAME);
    assert.equal((await store.getUser(userId))!.avatarFrameId, null, 'default is stored as NULL');
    assert.deepEqual(events, [
      [userId, 'frame_fire'],
      [userId, DEFAULT_AVATAR_FRAME],
    ]);
  });

  it('refuses a purchase without enough coins and changes nothing', async () => {
    await store.addCoins(userId, 499);
    assert.equal(await codeOf(() => frames.buy(userId, 'frame_wood')), 'NOT_ENOUGH_COIN');
    assert.equal(await store.coins(userId), 499);
    assert.equal((await view('frame_wood')).owned, false);
  });

  it('never charges twice: a second purchase is ALREADY_OWNED, and the store refuses a raced one', async () => {
    await store.addCoins(userId, 5_000);
    await frames.buy(userId, 'frame_ocean');
    assert.equal(await codeOf(() => frames.buy(userId, 'frame_ocean')), 'ALREADY_OWNED');
    assert.equal(await store.purchaseCosmetic(userId, 'avatar_frame', 'frame_ocean', 1_500), 'ALREADY_OWNED', 'even past the service check');
    assert.equal(await store.coins(userId), 3_500);
    assert.equal(await codeOf(() => frames.buy(userId, DEFAULT_AVATAR_FRAME)), 'ALREADY_OWNED');
  });

  it('cannot buy achievement, secret or unknown frames with coins, whatever the balance', async () => {
    await store.addCoins(userId, 1_000_000);
    assert.equal(await codeOf(() => frames.buy(userId, 'frame_crown')), 'ACHIEVEMENT_REQUIRED');
    assert.equal(await codeOf(() => frames.buy(userId, 'frame_nebula')), 'FRAME_NOT_PURCHASABLE');
    assert.equal(await codeOf(() => frames.buy(userId, 'frame_free_gold')), 'FRAME_NOT_FOUND');
    assert.equal(await store.coins(userId), 1_000_000);
  });

  it('an achievement grants its frame exactly once, and re-checks never duplicate it', async () => {
    await store.recordMatch(userId, wonFinal());
    const { unlocked } = await achievements.evaluate(userId);
    const champion = unlocked.find((a) => a.id === 'champion-1')!;
    assert.deepEqual(
      champion.rewards.find((r) => r.type === 'avatarFrame'),
      { type: 'avatarFrame', avatarFrame: { id: 'frame_crown', name: getAvatarFrame('frame_crown')!.name, rarity: 'legendary' } },
    );
    assert.equal((await view('frame_crown')).owned, true);
    assert.deepEqual((await view('frame_crown')).achievement, { id: 'champion-1', name: 'Nhà vô địch' });
    for (let i = 0; i < 3; i++) await achievements.evaluate(userId);
    await achievements.overview(userId);
    assert.equal((await store.listCosmetics(userId, 'avatar_frame')).filter((c) => c.itemId === 'frame_crown').length, 1);
    await frames.equip(userId, 'frame_crown');
    assert.equal(await frames.equippedFor(userId), 'frame_crown');
  });

  it('backfills the frame for an achievement completed before frames existed, once, without paying coins again', async () => {
    await store.recordMatch(userId, wonFinal());
    // As if these had been unlocked (and paid) before avatar frames existed.
    await store.transaction(async () => {
      for (const id of ['games-1', 'wins-1', 'pvp-1', 'champion-1']) await store.insertAchievementUnlock(userId, id, 0);
    });
    const coins = await store.coins(userId);
    await achievements.evaluate(userId);
    assert.equal((await view('frame_crown')).owned, true);
    await achievements.evaluate(userId);
    assert.equal((await store.listCosmetics(userId, 'avatar_frame')).length, 1);
    assert.equal((await store.coins(userId)) - coins, 0, 'no coins paid for the restored reward');
  });

  it('keeps the secret frame hidden until owned, then reveals it', async () => {
    const leak = (x: unknown) => JSON.stringify(x);
    const secret = getAvatarFrame('frame_nebula')!;
    const masked = await view('frame_nebula');
    assert.deepEqual(
      { name: masked.name, unlock: masked.unlock, price: masked.price, achievement: masked.achievement, asset: masked.asset, secret: masked.secret, rarity: masked.rarity },
      { name: '???', unlock: 'secret', price: null, achievement: null, asset: null, secret: true, rarity: 'secret' },
    );
    for (const payload of [await frames.overview(userId), frames.catalogue(), await achievements.overview(userId)]) {
      assert.ok(!leak(payload).includes(secret.name), 'the name stays hidden');
      assert.ok(!leak(payload).includes(secret.description), 'the description stays hidden');
    }
    // The hidden achievement only says "a frame", never which.
    const hidden = (await achievements.overview(userId)).achievements.find((a) => a.id === 'marathon')!;
    assert.deepEqual(hidden.rewards.filter((r) => r.type === 'avatarFrame'), [{ type: 'avatarFrame', avatarFrame: null }]);

    await store.recordMatch(userId, marathon());
    const { unlocked } = await achievements.evaluate(userId);
    assert.ok(unlocked.some((a) => a.id === 'marathon'));
    const open = await view('frame_nebula');
    assert.deepEqual([open.secret, open.owned, open.name, open.unlock], [false, true, secret.name, 'secret']);
    assert.deepEqual(open.achievement, { id: 'marathon', name: 'Marathon trên bàn cờ' });
    await frames.equip(userId, 'frame_nebula');
    assert.equal(await frames.equippedFor(userId), 'frame_nebula');
  });

  it('falls back to default for stored ids that are unknown, retired or not owned', async () => {
    const db = await store.open();
    await db.execute({ sql: "UPDATE users SET avatar_frame_id = 'frame_fire' WHERE id = ?", args: [userId] });
    assert.equal(await frames.equippedFor(userId), DEFAULT_AVATAR_FRAME, 'not owned: ignored');

    await db.execute({ sql: "INSERT INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type) VALUES (?, 'avatar_frame', 'frame_retired', 0, 'event')", args: [userId] });
    await db.execute({ sql: "UPDATE users SET avatar_frame_id = 'frame_retired' WHERE id = ?", args: [userId] });
    assert.equal(await frames.equippedFor(userId), DEFAULT_AVATAR_FRAME, 'owned but gone from the catalogue');
    assert.ok(!(await frames.ownedIds(userId)).has('frame_retired'));
  });

  it('frames and name styles share the inventory table without mixing', async () => {
    await store.addCoins(userId, 10_000);
    await frames.buy(userId, 'frame_wood');
    await store.purchaseCosmetic(userId, 'name_style', 'frame_wood', 1); // same item id, other kind
    assert.equal((await store.listCosmetics(userId, 'avatar_frame')).length, 1);
    assert.equal((await store.listCosmetics(userId, 'name_style')).length, 1);
  });
});

describe('avatar frames: existing databases', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caro-af-'));
  });
  afterEach(() => {
    // libsql keeps a closed database's file open until its handle is garbage
    // collected, and Windows refuses to delete it meanwhile. A leftover temp dir is harmless.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      if (!['EPERM', 'EBUSY'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
    }
  });

  it('an account and its history from before avatar frames migrate in place and wear the default', async () => {
    const path = join(dir, 'caro.db');
    // A database exactly as the previous version (schema 4) left it.
    const raw = new DatabaseSync(path);
    for (const v of [1, 2, 3, 4]) raw.exec(MIGRATIONS[v]);
    raw.exec('PRAGMA user_version = 4');
    raw.prepare(
      "INSERT INTO users (id, email, password_hash, nickname, avatar, created_at, updated_at, coins) VALUES ('old-user', 'old@example.com', 'x', 'Old', 'preset:fox', 1, 1, 900)",
    ).run();
    raw.close();

    let store = new AccountStore(path);
    await store.recordMatch('old-user', game());
    const user = (await store.getUser('old-user'))!;
    assert.deepEqual([user.avatarFrameId, user.coins, user.avatar, user.nickname], [null, 900, 'preset:fox', 'Old']);
    assert.equal((await store.listMatches('old-user', { limit: 5 })).length, 1);
    const frames = new AvatarFrameService(store, links);
    assert.equal(await frames.equippedFor('old-user'), DEFAULT_AVATAR_FRAME);
    assert.ok((await frames.ownedIds('old-user')).has(DEFAULT_AVATAR_FRAME));
    await frames.buy('old-user', 'frame_wood');
    await frames.equip('old-user', 'frame_wood');
    await store.close();

    store = new AccountStore(path);
    assert.equal(await new AvatarFrameService(store, links).equippedFor('old-user'), 'frame_wood', 'survives a restart');
    assert.equal(await store.coins('old-user'), 400);
    await store.close();
  });
});

describe('avatar frames over the network', () => {
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

  function next<T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 4_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.off(event, handler);
        reject(new Error(`timed out waiting for ${event}`));
      }, ms);
      const handler = (payload: T) => {
        if (!pred(payload)) return;
        clearTimeout(timer);
        s.off(event, handler);
        resolve(payload);
      };
      s.on(event, handler);
    });
  }

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  async function account(email: string, coins = 0) {
    const reg = await api('POST', '/api/auth/register', { email, password: 'correct horse', nickname: email.split('@')[0] });
    if (coins) await server!.accounts.addCoins(reg.body.user.id, coins);
    return { token: reg.body.token as string, id: reg.body.user.id as string };
  }

  it('HTTP: buy and equip with server-side prices and error codes; the body cannot fake anything', async () => {
    await boot();
    const { token } = await account('buyer@example.com', 1_000);

    assert.equal((await api('GET', '/api/me/avatar-frames')).status, 401);
    assert.equal((await api('POST', '/api/me/avatar-frames/frame_wood/buy')).status, 401, 'unauthorized');
    assert.equal((await api('POST', '/api/me/avatar-frames/frame_wood/equip')).status, 401);

    const list = await api('GET', '/api/me/avatar-frames', undefined, token);
    assert.deepEqual([list.body.equippedAvatarFrame, list.body.coins], [DEFAULT_AVATAR_FRAME, 1_000]);
    assert.deepEqual(list.body.ownedAvatarFrames, [DEFAULT_AVATAR_FRAME]);
    assert.equal(list.body.frames.find((f: { id: string }) => f.id === 'frame_wood').price, 500);

    const bought = await api('POST', '/api/me/avatar-frames/frame_wood/buy', { price: 0, rarity: 'legendary', owned: true }, token);
    assert.equal(bought.status, 200);
    assert.equal(bought.body.coins, 500, 'the catalogue price, not the body');
    assert.ok(bought.body.ownedAvatarFrames.includes('frame_wood'));

    // Double click: both requests race, only one pays.
    const [x, y] = await Promise.all([
      api('POST', '/api/me/avatar-frames/frame_ocean/buy', undefined, token),
      api('POST', '/api/me/avatar-frames/frame_ocean/buy', undefined, token),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [402, 402], 'not enough coins either way');
    await server!.accounts.addCoins((await api('GET', '/api/me', undefined, token)).body.user.id, 1_500);
    const [p, q] = await Promise.all([
      api('POST', '/api/me/avatar-frames/frame_ocean/buy', undefined, token),
      api('POST', '/api/me/avatar-frames/frame_ocean/buy', undefined, token),
    ]);
    assert.deepEqual([p.status, q.status].sort(), [200, 409]);
    assert.equal((await api('GET', '/api/me', undefined, token)).body.user.coins, 500, 'paid once');

    const locked = await api('POST', '/api/me/avatar-frames/frame_crown/buy', undefined, token);
    assert.deepEqual([locked.status, locked.body.error], [403, 'ACHIEVEMENT_REQUIRED']);
    const unowned = await api('POST', '/api/me/avatar-frames/frame_fire/equip', undefined, token);
    assert.deepEqual([unowned.status, unowned.body.error, unowned.body.message], [403, 'FRAME_NOT_OWNED', 'Bạn chưa sở hữu khung này.']);
    const missing = await api('POST', '/api/me/avatar-frames/frame_nope/equip', undefined, token);
    assert.deepEqual([missing.status, missing.body.error], [404, 'FRAME_NOT_FOUND']);
    const junk = await api('POST', `/api/me/avatar-frames/${encodeURIComponent('../../x<script>')}/equip`, undefined, token);
    assert.deepEqual([junk.status, junk.body.error], [400, 'INVALID_FRAME']);

    const equip = await api('POST', '/api/me/avatar-frames/frame_wood/equip', { frameId: 'frame_crown' }, token);
    assert.equal(equip.body.equippedAvatarFrame, 'frame_wood');
    assert.equal((await api('GET', '/api/me', undefined, token)).body.user.avatarFrame, 'frame_wood');

    // Nothing writes ownership or the equipped frame directly.
    await api('PATCH', '/api/me', { avatarFrame: 'frame_crown', ownedAvatarFrames: ['frame_crown'] }, token);
    assert.equal((await api('GET', '/api/me', undefined, token)).body.user.avatarFrame, 'frame_wood');

    const catalogue = await api('GET', '/api/avatar-frames');
    assert.equal(catalogue.status, 200);
    assert.ok(!JSON.stringify(catalogue.body).includes(getAvatarFrame('frame_nebula')!.name), 'public catalogue masks secrets');
  });

  it('rooms: seats show the equipped frame, guests the default, and an equip reaches the opponent live', async () => {
    await boot();
    const alice = await account('alice@example.com', 5_000);
    await api('POST', '/api/me/avatar-frames/frame_neon/buy', undefined, alice.token);
    await api('POST', '/api/me/avatar-frames/frame_neon/equip', undefined, alice.token);

    const a = await client(alice.token);
    const aOther = await client(alice.token); // another tab of the same account
    const b = await client(); // a guest
    const created = await call(a, 'room:create', { name: 'Alice' });
    assert.equal(created.state.players[0].avatarFrame, 'frame_neon');
    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const seats = Object.fromEntries(joined.state.players.map((p: { name: string; avatarFrame: string }) => [p.name, p.avatarFrame]));
    assert.deepEqual(seats, { Alice: 'frame_neon', Bob: DEFAULT_AVATAR_FRAME });
    assert.equal((await api('GET', `/api/rooms/${created.roomId}`)).body.hostAvatarFrame, 'frame_neon');

    await api('POST', '/api/me/avatar-frames/frame_fire/buy', undefined, alice.token);
    const seen = next(b, 'room:state', (s: any) => s.players.some((p: any) => p.name === 'Alice' && p.avatarFrame === 'frame_fire'));
    const pushed = next(aOther, 'account:updated', (p: any) => p.avatarFrame === 'frame_fire');
    await api('POST', '/api/me/avatar-frames/frame_fire/equip', undefined, alice.token);
    assert.equal((await seen).status, 'WAITING', 'cosmetic only');
    assert.deepEqual(await pushed, { avatarFrame: 'frame_fire' });

    // A refused equip broadcasts nothing.
    let extra = 0;
    b.on('room:state', () => extra++);
    await api('POST', '/api/me/avatar-frames/frame_crown/equip', undefined, alice.token);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(extra, 0);

    // Signing out mid-room: the seat goes back to the default.
    const back = next(b, 'room:state', (s: any) => s.players.some((p: any) => p.name === 'Alice' && p.avatarFrame === DEFAULT_AVATAR_FRAME));
    await call(a, 'auth:identify', { token: null });
    await back;
  });

  it('tournaments: participants show their frame in the lobby and follow an equip live', async () => {
    await boot();
    const host = await account('host@example.com', 600);
    await api('POST', '/api/me/avatar-frames/frame_wood/buy', undefined, host.token);
    await api('POST', '/api/me/avatar-frames/frame_wood/equip', undefined, host.token);

    const h = await client(host.token);
    const guest = await client();
    const created = await call(h, 'tournament:create', { name: 'Cup', playerName: 'Host', size: 4 });
    assert.equal(created.state.participants[0].avatarFrame, 'frame_wood');
    assert.equal((await api('GET', `/api/tournaments/${created.tournamentId}`)).body.hostAvatarFrame, 'frame_wood');
    const joined = await call(guest, 'tournament:join', { tournamentId: created.tournamentId, name: 'Guest' });
    assert.equal(joined.state.participants.find((p: any) => p.name === 'Guest').avatarFrame, DEFAULT_AVATAR_FRAME);

    const seen = next(guest, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Host' && p.avatarFrame === DEFAULT_AVATAR_FRAME));
    await api('POST', `/api/me/avatar-frames/${DEFAULT_AVATAR_FRAME}/equip`, undefined, host.token);
    await seen;
  });
});
