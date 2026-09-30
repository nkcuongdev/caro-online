import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { AccountStore, levelFor, levelFloor } from '../src/accounts/accountStore.js';
import { signToken, verifyToken } from '../src/accounts/jwt.js';
import { hashPassword, needsRehash, verifyPassword } from '../src/accounts/password.js';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';

/* Accounts: hashing, tokens, the HTTP API, and how signed-in players' games reach their history. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(overrides: Partial<AppConfig['accounts']> = {}) {
  const base = loadConfig({});
  const cfg: AppConfig = {
    ...base,
    turnMs: 5_000,
    startCountdownMs: 80,
    disconnectForfeitMs: 5_000,
    botMinDelayMs: 30,
    botMaxDelayMs: 60,
    accounts: { ...base.accounts, databasePath: ':memory:', ...overrides },
  };
  server = createCaroServer(cfg, undefined, undefined, undefined, new AccountStore(':memory:'));
  await new Promise<void>((resolve) => server!.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
  return cfg;
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
  return { status: res.status, body: (await res.json()) as any };
}

const register = (email: string, extra: object = {}) => api('POST', '/api/auth/register', { email, password: 'correct horse', ...extra });

/** Two players in a started pvp room. */
async function startMatch(a: Socket, b: Socket) {
  const created = await call(a, 'room:create', { name: 'Alice', avatar: 'preset:fox' });
  const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
  const started = next(a, 'game:started');
  for (const s of [a, b]) assert.equal((await call(s, 'room:ready', { roomId: created.roomId })).ok, true);
  await started;
  return { roomId: created.roomId as string, created, joined };
}

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('hunter2hunter2');
    const b = await hashPassword('hunter2hunter2');
    assert.match(a, /^scrypt\$15\$8\$3\$[\w-]+\$[\w-]+$/);
    assert.notEqual(a, b, 'salted');
    assert.equal(await verifyPassword('hunter2hunter2', a), true);
    assert.equal(await verifyPassword('hunter2hunter3', a), false);
    assert.equal(await verifyPassword('hunter2hunter2', 'bcrypt$garbage'), false);
    assert.equal(needsRehash(a), false);
    assert.equal(needsRehash('scrypt$14$8$1$aaaa$bbbb'), true);
  });
});

describe('login tokens', () => {
  const secret = 'x'.repeat(40);

  it('accepts its own tokens and rejects tampered, foreign, alg:none and expired ones', () => {
    const now = Date.now();
    const token = signToken({ sub: 'u1', sid: 's1' }, secret, 60_000, now);
    assert.deepEqual(verifyToken(token, secret, now)?.sub, 'u1');
    assert.equal(verifyToken(token, 'y'.repeat(40), now), null, 'other key');
    assert.equal(verifyToken(token, secret, now + 61_000), null, 'expired');

    const [h, p] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'admin' })).toString('base64url');
    assert.equal(verifyToken(`${h}.${forged}.${token.split('.')[2]}`, secret, now), null, 'edited payload');

    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    assert.equal(verifyToken(`${none}.${p}.`, secret, now), null, 'alg none');
    const hs512Header = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url');
    const sig = createHmac('sha256', secret).update(`${hs512Header}.${p}`).digest('base64url');
    assert.equal(verifyToken(`${hs512Header}.${p}.${sig}`, secret, now), null, 'only HS256');
    assert.equal(verifyToken('not-a-token', secret, now), null);
  });
});

describe('levels', () => {
  it('grows level thresholds', () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(99), 1);
    assert.equal(levelFor(100), 2);
    assert.equal(levelFor(levelFloor(5)), 5);
  });
});

describe('accounts API', () => {
  it('registers, logs in, edits the profile and logs out (revoking the token)', async () => {
    await boot();
    const reg = await register('Mai@Example.com', { nickname: 'Mèo Lanh Lợi', avatar: 'preset:cat' });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.user.email, 'mai@example.com');
    assert.equal(reg.body.user.nickname, 'Mèo Lanh Lợi');
    assert.equal(reg.body.user.avatar, 'preset:cat');
    assert.equal(JSON.stringify(reg.body).includes('scrypt'), false, 'hash never leaves the server');

    assert.equal((await register('mai@example.com')).body.error, 'EMAIL_TAKEN');
    assert.equal((await register('not-an-email')).body.error, 'INVALID_EMAIL');
    assert.equal((await api('POST', '/api/auth/register', { email: 'x@y.vn', password: 'short' })).body.error, 'WEAK_PASSWORD');

    const bad = await api('POST', '/api/auth/login', { email: 'mai@example.com', password: 'wrong password' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'BAD_CREDENTIALS');
    const unknown = await api('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong password' });
    assert.equal(unknown.body.error, 'BAD_CREDENTIALS', 'same answer for unknown emails');

    const login = await api('POST', '/api/auth/login', { email: ' MAI@example.com ', password: 'correct horse' });
    assert.equal(login.status, 200);
    const token = login.body.token as string;

    const me = await api('GET', '/api/me', undefined, token);
    assert.equal(me.body.user.nickname, 'Mèo Lanh Lợi');
    assert.equal(me.body.stats.overall.games, 0);
    assert.equal(me.body.stats.level, 1);

    const patched = await api('PATCH', '/api/me', { nickname: '  Cáo <b>Nhanh</b> ', avatar: 'preset:fox' }, token);
    assert.equal(patched.body.user.nickname, 'Cáo bNhanh/b');
    assert.equal(patched.body.user.avatar, 'preset:fox');
    assert.equal((await api('PATCH', '/api/me', { avatar: 'https://evil.example/x.png' }, token)).body.error, 'INVALID_AVATAR');
    assert.equal((await api('PATCH', '/api/me', { nickname: '   ' }, token)).body.error, 'INVALID_NICKNAME');

    assert.equal((await api('GET', '/api/me')).status, 401);
    assert.equal((await api('GET', '/api/me', undefined, 'garbage')).status, 401);
    await api('POST', '/api/auth/logout', undefined, token);
    assert.equal((await api('GET', '/api/me', undefined, token)).status, 401, 'logout revokes the session');
    // The registration token is a separate session and still works.
    assert.equal((await api('GET', '/api/me', undefined, reg.body.token)).status, 200);
  });

  it('pauses an email after repeated wrong passwords, even for the right one', async () => {
    await boot({ failuresPerEmail: 3, authBurst: 100 });
    await register('lock@example.com');
    for (let i = 0; i < 3; i++) {
      assert.equal((await api('POST', '/api/auth/login', { email: 'lock@example.com', password: `nope-nope-${i}` })).body.error, 'BAD_CREDENTIALS');
    }
    assert.equal((await api('POST', '/api/auth/login', { email: 'lock@example.com', password: 'correct horse' })).body.error, 'RATE_LIMITED');
  });
});

describe('match history', () => {
  it('records a finished game for each signed-in player, with stats and a replayable move list', async () => {
    await boot();
    const alice = (await register('alice@example.com', { nickname: 'Alice' })).body.token as string;
    const a = await client(alice);
    const b = await client(); // guest
    const { roomId, joined } = await startMatch(a, b);

    const seats = joined.state.players as { id: string; registered: boolean }[];
    assert.deepEqual(
      seats.map((p) => p.registered),
      [true, false],
      'signed-in seats are flagged, guests are not',
    );
    assert.equal(JSON.stringify(joined.state).includes('userId'), false);

    const finished = next(a, 'game:finished');
    await call(b, 'game:resign', { roomId });
    const result = await finished;
    assert.equal(JSON.stringify(result).includes('token'), false);

    const list = await api('GET', '/api/me/matches', undefined, alice);
    assert.equal(list.body.matches.length, 1);
    const m = list.body.matches[0];
    assert.equal(m.result, 'win');
    assert.equal(m.reason, 'resign');
    assert.equal(m.mode, 'pvp');
    assert.equal(m.opponentName, 'Bob');
    assert.equal(m.opponentRegistered, false);
    assert.equal(m.moves, undefined, 'list omits moves');
    assert.equal('opponentUserId' in m, false);

    const detail = await api('GET', `/api/me/matches/${m.id}`, undefined, alice);
    assert.deepEqual(detail.body.match.moves, []);

    const stats = (await api('GET', '/api/me/stats', undefined, alice)).body.stats;
    assert.equal(stats.overall.games, 1);
    assert.equal(stats.overall.wins, 1);
    assert.equal(stats.overall.winRate, 100);
    assert.equal(stats.currentStreak.count, 1);
    assert.equal(stats.xp, 30);

    // Another user can't read it.
    const bobToken = (await register('bob@example.com')).body.token;
    assert.equal((await api('GET', `/api/me/matches/${m.id}`, undefined, bobToken)).status, 404);
  });

  it('moves games a guest played into the account they create afterwards', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const { roomId, created, joined } = await startMatch(a, b);
    const finished = next(a, 'game:finished');
    await call(a, 'game:resign', { roomId });
    await finished;

    // Bob plays as a guest, wins, then signs up from the result screen.
    const reg = await register('bob@example.com', { nickname: 'Bob', guestTokens: [joined.token] });
    assert.equal(reg.body.claimed, 1);
    const list = (await api('GET', '/api/me/matches', undefined, reg.body.token)).body.matches;
    assert.equal(list.length, 1);
    assert.equal(list[0].result, 'win');

    // Claims are one-shot, and claiming both sides of one game counts neither.
    assert.equal((await api('POST', '/api/me/claim', { guestTokens: [joined.token] }, reg.body.token)).body.claimed, 0);
    const other = await register('both@example.com');
    assert.equal((await api('POST', '/api/me/claim', { guestTokens: [created.token, joined.token] }, other.body.token)).body.claimed, 0);
  });

  it('signing in mid-game keeps the seat, and the game in progress is recorded', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const { roomId } = await startMatch(a, b);

    const token = (await register('late@example.com')).body.token as string;
    const flagged = next(b, 'room:state', (s) => s.players.some((p: { registered: boolean }) => p.registered));
    assert.equal((await call(a, 'auth:identify', { token })).signedIn, true);
    const snap = await flagged;
    assert.equal(snap.status, 'PLAYING', 'still the same game');

    assert.equal((await call(a, 'auth:identify', { token: 'bogus' })).error, 'AUTH_INVALID');

    const finished = next(a, 'game:finished');
    await call(b, 'game:resign', { roomId });
    await finished;
    const list = (await api('GET', '/api/me/matches', undefined, token)).body.matches;
    assert.equal(list.length, 1);
    assert.equal(list[0].result, 'win');

    // Signing out unlinks the seat: the next game isn't recorded.
    await call(a, 'auth:identify', { token: null });
    const rematch = next(a, 'game:started');
    await call(a, 'game:rematch', { roomId, accept: true });
    await call(b, 'game:rematch', { roomId, accept: true });
    await rematch;
    const again = next(a, 'game:finished');
    await call(b, 'game:resign', { roomId });
    await again;
    assert.equal((await api('GET', '/api/me/matches', undefined, token)).body.matches.length, 1);
  });

  it('records bot games per difficulty, and one account on both seats records nothing', async () => {
    await boot();
    const token = (await register('solo@example.com')).body.token as string;
    const a = await client(token);
    const bot = await call(a, 'room:createBot', { difficulty: 'easy', firstMove: 'human' });
    await next(a, 'game:started');
    const finished = next(a, 'game:finished');
    await call(a, 'game:resign', { roomId: bot.roomId });
    await finished;

    const b = await client(token);
    const c = await client(token);
    const { roomId } = await startMatch(b, c);
    const selfDone = next(b, 'game:finished');
    await call(c, 'game:resign', { roomId });
    await selfDone;

    const { stats } = (await api('GET', '/api/me/stats', undefined, token)).body;
    assert.equal(stats.overall.games, 1, 'self-play is not recorded');
    assert.equal(stats.byMode.bot.losses, 1);
    assert.equal(stats.xp, 5, 'bot games give half XP');
    const [m] = (await api('GET', '/api/me/matches?mode=bot', undefined, token)).body.matches;
    assert.equal(m.opponentIsBot, true);
    assert.equal(m.botDifficulty, 'easy');
  });
});
