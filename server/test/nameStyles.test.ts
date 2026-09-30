import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { AccountStore, type MatchRecord } from '../src/accounts/accountStore.js';
import { AchievementManager } from '../src/achievements/achievementManager.js';
import { ACHIEVEMENTS } from '../src/achievements/definitions.js';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { NameStyleError, NameStyleService, nameStyleLinks } from '../src/cosmetics/nameStyleService.js';
import { DEFAULT_NAME_STYLE, getNameStyle, isPurchasable, NAME_STYLE_LIST, resolveNameStyleId } from '../src/cosmetics/nameStyles.js';
import { RARITIES } from '../src/cosmetics/rarity.js';

/* Name styles: catalogue, ownership, coins, achievement rewards, secrets, and live updates in rooms and tournaments. */

let seq = 0;
function game(extra: Partial<MatchRecord> = {}): MatchRecord {
  seq += 1;
  const at = 1_700_000_000_000 + seq * 60_000;
  return {
    roomId: `ns${seq}`,
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

/** The error code a call throws. */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof NameStyleError) return err.code;
    throw err;
  }
  return 'NO_ERROR';
}

const links = nameStyleLinks(ACHIEVEMENTS);

describe('name style catalogue', () => {
  it('is well-formed: unique ids, shared rarities, a free default, prices only where sold', () => {
    const ids = new Set<string>();
    for (const s of NAME_STYLE_LIST) {
      assert.ok(!ids.has(s.id), `duplicate ${s.id}`);
      ids.add(s.id);
      assert.match(s.id, /^[a-z0-9_]+$/);
      assert.ok(RARITIES.includes(s.rarity), s.id);
      assert.ok(s.name && s.description, s.id);
      if (s.unlock === 'coin') assert.ok(isPurchasable(s), `${s.id} has a positive price`);
      else assert.equal(s.price, undefined, `${s.id} is not sold`);
      if (s.rarity === 'secret') {
        assert.equal(s.unlock, 'secret', `${s.id}: secrets are never sold`);
        assert.ok(s.hidden, `${s.id} is hidden`);
      }
    }
    const def = getNameStyle(DEFAULT_NAME_STYLE)!;
    assert.equal(def.unlock, 'default');
    for (const r of ['common', 'rare', 'epic', 'legendary', 'secret'] as const) assert.ok(NAME_STYLE_LIST.some((s) => s.rarity === r), `has a ${r} style`);
  });

  it('achievement and secret styles are each granted by exactly one achievement, secrets only by hidden ones', () => {
    const granted = ACHIEVEMENTS.flatMap((a) => (a.rewards ?? []).filter((r) => r.type === 'nameStyle').map((r) => ({ a, id: r.nameStyleId })));
    for (const { a, id } of granted) {
      const s = getNameStyle(id);
      assert.ok(s, `${a.id} rewards a known style (${id})`);
      assert.ok(s.unlock === 'achievement' || s.unlock === 'secret', `${id} is an achievement/secret style`);
      // A visible achievement would announce the secret style in its rewards.
      if (s.unlock === 'secret') assert.ok(a.hidden, `${id} comes from a hidden achievement`);
    }
    for (const s of NAME_STYLE_LIST.filter((x) => x.unlock === 'achievement' || x.unlock === 'secret')) {
      assert.equal(granted.filter((g) => g.id === s.id).length, 1, `${s.id} has one source`);
    }
  });

  it('resolves only real ids; anything else is default', () => {
    assert.equal(resolveNameStyleId('galaxy'), 'galaxy');
    for (const bad of [undefined, null, '', 'nope', '__proto__', 'constructor', 'toString', 42, { id: 'galaxy' }, 'GALAXY']) {
      assert.equal(resolveNameStyleId(bad), 'default', String(bad));
      assert.equal(getNameStyle(bad), null);
    }
  });
});

describe('name style ownership, coins and achievements', () => {
  let store: AccountStore;
  let styles: NameStyleService;
  let achievements: AchievementManager;
  let userId: string;

  beforeEach(async () => {
    store = new AccountStore(':memory:');
    styles = new NameStyleService(store, links);
    achievements = new AchievementManager(store);
    userId = (await store.createUser({ email: 'n@example.com', passwordHash: 'x', nickname: 'N', avatar: null }))!.id;
  });
  afterEach(async () => {
    await store.close();
  });

  const view = async (id: string) => (await styles.overview(userId)).styles.find((s) => s.id === id)!;

  it('a new account owns only default and wears it', async () => {
    assert.deepEqual([...(await styles.ownedIds(userId))], ['default']);
    assert.equal(await styles.equippedFor(userId), 'default');
    assert.equal((await store.getUser(userId))!.nameStyleId, null);
    const o = await styles.overview(userId);
    assert.equal(o.equipped, 'default');
    assert.deepEqual(o.styles.filter((s) => s.owned).map((s) => s.id), ['default']);
    assert.equal(await styles.equippedFor(null), 'default', 'guests');
  });

  it('refuses to equip what the player does not own, with the reason', async () => {
    assert.equal(await codeOf(() => styles.equip(userId, 'ocean_blue')), 'STYLE_NOT_OWNED');
    assert.equal(await codeOf(() => styles.equip(userId, 'galaxy')), 'ACHIEVEMENT_REQUIRED');
    assert.equal(await codeOf(() => styles.equip(userId, 'void')), 'STYLE_LOCKED');
    assert.equal(await codeOf(() => styles.equip(userId, 'nope')), 'STYLE_NOT_FOUND');
    assert.equal(await codeOf(() => styles.equip(userId, '<b>x</b>')), 'INVALID_STYLE');
    assert.equal(await codeOf(() => styles.equip(userId, { id: 'galaxy' })), 'INVALID_STYLE');
    assert.equal(await styles.equippedFor(userId), 'default');
  });

  it('buys with enough coins, then equips; the price comes from the catalogue', async () => {
    await store.addCoins(userId, 600);
    const bought = await styles.buy(userId, 'ocean_blue');
    assert.equal(bought.coins, 100);
    assert.equal(bought.style.owned, true);
    assert.equal(await store.coins(userId), 100);
    assert.equal((await store.listCosmetics(userId, 'name_style'))[0].cost, 500);

    const events: [string, string][] = [];
    styles.onEquipped((u, s) => events.push([u, s]));
    assert.deepEqual(await styles.equip(userId, 'ocean_blue'), { equipped: 'ocean_blue' });
    assert.equal(await styles.equippedFor(userId), 'ocean_blue');
    assert.equal((await view('ocean_blue')).equipped, true);
    await styles.equip(userId, 'ocean_blue'); // no change, no event
    await styles.equip(userId, 'default');
    assert.equal((await store.getUser(userId))!.nameStyleId, null, 'default is stored as NULL');
    assert.deepEqual(events, [
      [userId, 'ocean_blue'],
      [userId, 'default'],
    ]);
  });

  it('refuses a purchase without enough coins and changes nothing', async () => {
    await store.addCoins(userId, 499);
    assert.equal(await codeOf(() => styles.buy(userId, 'ocean_blue')), 'NOT_ENOUGH_COIN');
    assert.equal(await store.coins(userId), 499);
    assert.equal((await view('ocean_blue')).owned, false);
  });

  it('never charges twice: a second purchase is ALREADY_OWNED, and the store refuses a raced one', async () => {
    await store.addCoins(userId, 5000);
    await styles.buy(userId, 'mystic_gradient');
    assert.equal(await codeOf(() => styles.buy(userId, 'mystic_gradient')), 'ALREADY_OWNED');
    assert.equal(await store.purchaseCosmetic(userId, 'name_style', 'mystic_gradient', 1500), 'ALREADY_OWNED', 'even past the service check');
    assert.equal(await store.coins(userId), 3500);
    assert.equal(await codeOf(() => styles.buy(userId, 'default')), 'ALREADY_OWNED');
  });

  it('cannot buy achievement, secret or unknown styles, whatever the balance', async () => {
    await store.addCoins(userId, 1_000_000);
    assert.equal(await codeOf(() => styles.buy(userId, 'galaxy')), 'ACHIEVEMENT_REQUIRED');
    assert.equal(await codeOf(() => styles.buy(userId, 'void')), 'STYLE_LOCKED');
    assert.equal(await codeOf(() => styles.buy(userId, 'free_gold')), 'STYLE_NOT_FOUND');
    assert.equal(await store.coins(userId), 1_000_000);
  });

  it('the balance never goes negative in the store either', async () => {
    await store.addCoins(userId, 10);
    assert.equal(await store.purchaseCosmetic(userId, 'name_style', 'ocean_blue', 500), 'NOT_ENOUGH_COIN');
    assert.equal(await store.coins(userId), 10);
  });

  it('an achievement grants its style exactly once, and re-checks never duplicate it', async () => {
    for (let i = 0; i < 20; i++) await store.recordMatch(userId, game({ mode: 'bot', opponentIsBot: true, botDifficulty: 'easy' }));
    const { unlocked } = await achievements.evaluate(userId);
    const bot20 = unlocked.find((a) => a.id === 'bot-20')!;
    assert.deepEqual(
      bot20.rewards.find((r) => r.type === 'nameStyle'),
      { type: 'nameStyle', nameStyle: { id: 'ice_glow', name: getNameStyle('ice_glow')!.name, rarity: 'rare' } },
    );
    assert.equal((await view('ice_glow')).owned, true);
    assert.deepEqual((await view('ice_glow')).achievement, { id: 'bot-20', name: 'Thợ săn AI' });
    for (let i = 0; i < 3; i++) await achievements.evaluate(userId);
    await achievements.overview(userId);
    assert.equal((await store.listCosmetics(userId, 'name_style')).filter((c) => c.itemId === 'ice_glow').length, 1);
    await styles.equip(userId, 'ice_glow');
    assert.equal(await styles.equippedFor(userId), 'ice_glow');
  });

  it('backfills the style for an achievement completed before it carried one, once, without paying coins again', async () => {
    for (let i = 0; i < 20; i++) await store.recordMatch(userId, game({ mode: 'bot', opponentIsBot: true, botDifficulty: 'easy' }));
    // As if bot-20 had been unlocked (and paid) before name styles existed.
    await store.transaction(async () => {
      for (const d of ACHIEVEMENTS.filter((a) => ['games-1', 'games-10', 'wins-1', 'wins-10', 'streak-3', 'streak-5', 'streak-10', 'streak-20', 'bot-1', 'bot-20'].includes(a.id))) {
        await store.insertAchievementUnlock(userId, d.id, 0);
      }
    });
    const coins = await store.coins(userId);
    await achievements.evaluate(userId);
    assert.equal((await view('ice_glow')).owned, true);
    assert.equal(await store.coins(userId), coins);
    await achievements.evaluate(userId);
    assert.equal((await store.listCosmetics(userId, 'name_style')).length, 1);
  });

  it('keeps the secret style secret until owned, then it works like any other', async () => {
    const leak = (x: unknown) => JSON.stringify(x);
    const masked = await view('void');
    assert.equal(masked.secret, true);
    assert.equal(masked.name, '???');
    assert.equal(masked.unlock, 'secret');
    assert.equal(masked.price, null);
    assert.equal(masked.achievement, null);
    for (const payload of [await styles.overview(userId), styles.catalogue(), await achievements.overview(userId)]) {
      assert.ok(!leak(payload).includes('Hư Không'), 'the name stays hidden');
      assert.ok(!leak(payload).includes(getNameStyle('void')!.description), 'the description stays hidden');
    }
    const byStyle = (await styles.overview(userId)).styles.find((s) => s.id === 'void')!;
    assert.ok(!leak(byStyle).includes('perfect-five'), 'the unlocking achievement is not named');

    // X wins with its 5th move: the hidden "perfect-five" achievement unlocks and grants the style.
    await store.recordMatch(userId, game({ reason: 'five', moves: [0, 20, 1, 21, 2, 22, 3, 23, 4] }));
    const { unlocked } = await achievements.evaluate(userId);
    assert.ok(unlocked.some((a) => a.id === 'perfect-five'));
    const open = await view('void');
    assert.equal(open.secret, false);
    assert.equal(open.owned, true);
    assert.equal(open.name, 'Hư Không');
    assert.deepEqual(open.achievement, { id: 'perfect-five', name: 'Thần tốc' });
    await styles.equip(userId, 'void');
    assert.equal(await styles.equippedFor(userId), 'void');
  });

  it('falls back to default for stored ids that are unknown, retired or not owned', async () => {
    const db = await store.open();
    await db.execute({ sql: "UPDATE users SET name_style_id = 'rainbow' WHERE id = ?", args: [userId] });
    assert.equal(await styles.equippedFor(userId), 'default', 'not owned: ignored');

    await db.execute({ sql: "INSERT INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type) VALUES (?, 'name_style', 'retired_style', 0, 'event')", args: [userId] });
    await db.execute({ sql: "UPDATE users SET name_style_id = 'retired_style' WHERE id = ?", args: [userId] });
    assert.equal((await store.getUser(userId))!.nameStyleId, 'retired_style');
    assert.equal(await styles.equippedFor(userId), 'default', 'owned but gone from the catalogue');
    assert.ok(!(await styles.ownedIds(userId)).has('retired_style'));
    assert.equal((await styles.overview(userId)).equipped, 'default');
  });
});

describe('name styles: existing databases', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caro-ns-'));
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

  it('an account from before name styles migrates cleanly and wears default', async () => {
    const path = join(dir, 'caro.db');
    let store = new AccountStore(path);
    const userId = (await store.createUser({ email: 'old@example.com', passwordHash: 'x', nickname: 'Old', avatar: null }))!.id;
    await store.addCoins(userId, 700);
    await store.close();
    const raw = new DatabaseSync(path);
    // The synchronous store kept the schema version in user_version only, with no row in meta.
    raw.exec("ALTER TABLE users DROP COLUMN avatar_frame_id; DROP TABLE user_cosmetics; ALTER TABLE users DROP COLUMN name_style_id; DELETE FROM meta WHERE key = 'schema_version'; PRAGMA user_version = 3;");
    raw.close();

    store = new AccountStore(path);
    const user = (await store.getUser(userId))!;
    assert.equal(user.nameStyleId, null);
    assert.equal(user.coins, 700);
    const styles = new NameStyleService(store, links);
    assert.equal(await styles.equippedFor(userId), 'default');
    await styles.buy(userId, 'emerald');
    await styles.equip(userId, 'emerald');
    await store.close();

    store = new AccountStore(path);
    assert.equal(await new NameStyleService(store, links).equippedFor(userId), 'emerald', 'survives a restart');
    await store.close();
  });
});

describe('name styles over the network', () => {
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

  /** A registered account with `coins` in the bank. */
  async function account(email: string, coins = 0) {
    const reg = await api('POST', '/api/auth/register', { email, password: 'correct horse', nickname: email.split('@')[0] });
    if (coins) await server!.accounts.addCoins(reg.body.user.id, coins);
    return { token: reg.body.token as string, id: reg.body.user.id as string };
  }

  it('HTTP: buy and equip with server-side prices and error codes; the body cannot fake anything', async () => {
    await boot();
    const { token } = await account('buyer@example.com', 1_000);

    assert.equal((await api('GET', '/api/me/name-styles')).status, 401);
    assert.equal((await api('POST', '/api/me/name-styles/ocean_blue/buy')).status, 401);

    const list = await api('GET', '/api/me/name-styles', undefined, token);
    assert.equal(list.body.equipped, 'default');
    assert.equal(list.body.coins, 1_000);
    assert.equal(list.body.styles.find((s: { id: string }) => s.id === 'ocean_blue').price, 500);

    const cheap = await api('POST', '/api/me/name-styles/ocean_blue/buy', { price: 0, rarity: 'common', owned: true }, token);
    assert.equal(cheap.status, 200);
    assert.equal(cheap.body.coins, 500, 'the catalogue price, not the body');

    const again = await api('POST', '/api/me/name-styles/ocean_blue/buy', undefined, token);
    assert.deepEqual([again.status, again.body.error], [409, 'ALREADY_OWNED']);
    const poor = await api('POST', '/api/me/name-styles/royal_gold/buy', undefined, token);
    assert.deepEqual([poor.status, poor.body.error], [402, 'NOT_ENOUGH_COIN']);
    assert.equal(typeof poor.body.message, 'string');
    const locked = await api('POST', '/api/me/name-styles/galaxy/equip', undefined, token);
    assert.deepEqual([locked.status, locked.body.error], [403, 'ACHIEVEMENT_REQUIRED']);
    const missing = await api('POST', '/api/me/name-styles/nope/equip', undefined, token);
    assert.deepEqual([missing.status, missing.body.error], [404, 'STYLE_NOT_FOUND']);
    const junk = await api('POST', `/api/me/name-styles/${encodeURIComponent('a b<c>')}/equip`, undefined, token);
    assert.deepEqual([junk.status, junk.body.error], [400, 'INVALID_STYLE']);

    const equip = await api('POST', '/api/me/name-styles/ocean_blue/equip', { nameStyle: 'galaxy' }, token);
    assert.deepEqual(equip.body, { ok: true, equipped: 'ocean_blue' });
    const me = await api('GET', '/api/me', undefined, token);
    assert.equal(me.body.user.nameStyle, 'ocean_blue');
    assert.equal(me.body.user.coins, 500);

    // Nothing writes the catalogue or ownership directly.
    for (const [method, path] of [['PATCH', '/api/me'], ['POST', '/api/me/name-styles']] as const) {
      await api(method, path, { nameStyle: 'galaxy', nameStyleId: 'galaxy', ownedNameStyleIds: ['galaxy'] }, token);
    }
    assert.equal((await api('GET', '/api/me', undefined, token)).body.user.nameStyle, 'ocean_blue');

    const catalogue = await api('GET', '/api/name-styles');
    assert.equal(catalogue.status, 200);
    assert.ok(!JSON.stringify(catalogue.body).includes('Hư Không'), 'public catalogue masks secrets');
  });

  it('rooms: seats show the equipped style, guests show default, and an equip reaches the opponent live', async () => {
    await boot();
    const alice = await account('alice@example.com', 2_000);
    await api('POST', '/api/me/name-styles/emerald/buy', undefined, alice.token);
    await api('POST', '/api/me/name-styles/emerald/equip', undefined, alice.token);

    const a = await client(alice.token);
    const aOther = await client(alice.token); // another tab of the same account
    const b = await client(); // a guest
    const created = await call(a, 'room:create', { name: 'Alice' });
    assert.equal(created.state.players[0].nameStyle, 'emerald');
    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    const seats = Object.fromEntries(joined.state.players.map((p: { name: string; nameStyle: string }) => [p.name, p.nameStyle]));
    assert.deepEqual(seats, { Alice: 'emerald', Bob: 'default' });
    assert.equal((await api('GET', `/api/rooms/${created.roomId}`)).body.hostNameStyle, 'emerald');

    await api('POST', '/api/me/name-styles/ocean_blue/buy', undefined, alice.token);
    const seen = next(b, 'room:state', (s: any) => s.players.some((p: any) => p.name === 'Alice' && p.nameStyle === 'ocean_blue'));
    const pushed = next(aOther, 'account:updated', (p: any) => p.nameStyle === 'ocean_blue');
    await api('POST', '/api/me/name-styles/ocean_blue/equip', undefined, alice.token);
    const state = await seen;
    assert.equal(state.status, 'WAITING', 'cosmetic only: the room is otherwise unchanged');
    assert.deepEqual(await pushed, { nameStyle: 'ocean_blue' });

    // A refused equip broadcasts nothing.
    let extra = 0;
    b.on('room:state', () => extra++);
    await api('POST', '/api/me/name-styles/galaxy/equip', undefined, alice.token);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(extra, 0);

    // Signing out mid-room: the seat goes back to default.
    const back = next(b, 'room:state', (s: any) => s.players.some((p: any) => p.name === 'Alice' && p.nameStyle === 'default'));
    await call(a, 'auth:identify', { token: null });
    await back;
  });

  it('tournaments: participants show their style in the lobby and follow an equip live', async () => {
    await boot();
    const host = await account('host@example.com', 600);
    await api('POST', '/api/me/name-styles/rose/buy', undefined, host.token);
    await api('POST', '/api/me/name-styles/rose/equip', undefined, host.token);

    const h = await client(host.token);
    const guest = await client();
    const created = await call(h, 'tournament:create', { name: 'Cup', playerName: 'Host', size: 4 });
    assert.equal(created.ok, true);
    assert.equal(created.state.participants[0].nameStyle, 'rose');
    const joined = await call(guest, 'tournament:join', { tournamentId: created.tournamentId, name: 'Guest' });
    assert.equal(joined.state.participants.find((p: any) => p.name === 'Guest').nameStyle, 'default');

    const seen = next(guest, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Host' && p.nameStyle === 'default'));
    await api('POST', '/api/me/name-styles/default/equip', undefined, host.token);
    await seen;

    // The guest signs in mid-lobby: their spot picks up the account's style.
    const later = await account('later@example.com', 600);
    await api('POST', '/api/me/name-styles/emerald/buy', undefined, later.token);
    await api('POST', '/api/me/name-styles/emerald/equip', undefined, later.token);
    const dressed = next(h, 'tournament:state', (t: any) => t.participants.some((p: any) => p.name === 'Guest' && p.nameStyle === 'emerald'));
    assert.equal((await call(guest, 'auth:identify', { token: later.token })).ok, true);
    await dressed;
  });
});
