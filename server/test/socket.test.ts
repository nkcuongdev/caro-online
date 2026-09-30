import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { RoomSnapshot } from '../src/protocol.js';

/* End-to-end tests over real sockets, with timings shrunk so timeouts run fast. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(overrides: Partial<AppConfig> = {}) {
  const cfg: AppConfig = {
    ...loadConfig({}),
    turnMs: 1_000,
    startCountdownMs: 150,
    disconnectForfeitMs: 700,
    moveGraceMs: 50,
    ...overrides,
  };
  server = createCaroServer(cfg);
  await new Promise<void>((resolve) => server!.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
  return cfg;
}

async function client() {
  const s = connectClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (r: number, c: number) => r * 20 + c;

/** Both seated players confirm the pre-match ready check; resolves with the first PLAYING snapshot. */
async function readyUp(roomId: string, ...players: Socket[]): Promise<RoomSnapshot> {
  const playing = next<RoomSnapshot>(players[0], 'room:state', (s) => s.status === 'PLAYING');
  for (const s of players) assert.equal((await call(s, 'room:ready', { roomId })).ok, true);
  return playing;
}

/** Creates a room, joins a second player, readies both and waits for the countdown to end. */
async function startMatch() {
  const a = await client();
  const b = await client();
  const created = await call(a, 'room:create', { name: 'Alice' });
  assert.equal(created.ok, true);
  const started = next(a, 'game:started');
  const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
  assert.equal(joined.ok, true);
  assert.equal(joined.role, 'player');
  const state = await readyUp(created.roomId, a, b);
  await started;

  const markOf = (id: string) => state.players.find((p) => p.id === id)!.mark;
  const aIsX = markOf(created.playerId) === 'X';
  return {
    roomId: created.roomId as string,
    a,
    b,
    created,
    joined,
    /** First snapshot of the running game (marks assigned). */
    state,
    x: aIsX ? a : b,
    o: aIsX ? b : a,
    xSession: aIsX ? created : joined,
    oSession: aIsX ? joined : created,
  };
}

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('multiplayer flow', () => {
  it('creates a room in WAITING and exposes it over HTTP', async () => {
    await boot();
    const a = await client();
    const res = await call(a, 'room:create', { name: 'Alice' });
    assert.equal(res.ok, true);
    assert.match(res.roomId, /^[A-Za-z0-9]{6}$/);
    assert.equal(res.state.status, 'WAITING');
    assert.equal(res.state.players.length, 1);
    assert.equal(JSON.stringify(res.state).includes(res.token), false, 'token must not leak in snapshots');

    const http = await fetch(`${baseUrl}/api/rooms/${res.roomId}`).then((r) => r.json());
    assert.deepEqual(http, {
      exists: true,
      status: 'WAITING',
      players: 1,
      seatAvailable: true,
      hostName: 'Alice',
      hostAvatar: null,
      hostNameStyle: 'default',
      hostAvatarFrame: 'frame_default',
      boardSize: 20,
      turnMs: 1_000,
    });
    assert.deepEqual(await fetch(`${baseUrl}/api/rooms/nope42`).then((r) => r.json()), { exists: false });
  });

  it('keeps the settings the host picked, for the invitee and across rematches', async () => {
    await boot({ turnMs: 5_000 });
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice', boardSize: 15, turnSeconds: 60 });
    assert.equal(created.state.config.boardSize, 15);
    assert.equal(created.state.config.turnMs, 60_000);
    const info = (await fetch(`${baseUrl}/api/rooms/${created.roomId}`).then((r) => r.json())) as { boardSize: number; turnMs: number };
    assert.equal(info.boardSize, 15);
    assert.equal(info.turnMs, 60_000);

    const started = next(a, 'game:started');
    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
    assert.equal(joined.state.config.boardSize, 15);
    assert.equal(joined.state.config.turnMs, 60_000);
    const live = await readyUp(created.roomId, a, b);
    assert.equal(live.game!.board.length, 15 * 15);
    assert.equal(live.game!.deadline - live.game!.startAt, 60_000);
    await started;

    // Indices are row-major on the room's own size: 225 is off a 15×15 board.
    const x = live.players.find((p) => p.mark === 'X')!.id === created.playerId ? a : b;
    assert.equal((await call(x, 'game:move', { roomId: created.roomId, index: 15 * 15, seq: 0 })).error, 'INVALID_CELL');

    // Each new turn gets the room's time, not the server default.
    assert.equal((await call(x, 'game:move', { roomId: created.roomId, index: 0, seq: 0 })).ok, true);
    const g = (await server!.manager.getRoom(created.roomId))!.game!;
    assert.equal(g.deadline - g.turnStartedAt, 60_000);

    await call(a, 'game:resign', { roomId: created.roomId });
    const restarted = next(a, 'room:state', (s: RoomSnapshot) => s.round === 2);
    await call(a, 'game:rematch', { roomId: created.roomId });
    await call(b, 'game:rematch', { roomId: created.roomId });
    const round2 = await restarted;
    assert.equal(round2.config.boardSize, 15);
    assert.equal(round2.config.turnMs, 60_000);
    assert.equal(round2.game!.board.length, 15 * 15);
  });

  it('rejects room settings outside the allowed lists', async () => {
    await boot();
    const a = await client();
    for (const boardSize of [3, 19, 100, '20']) {
      assert.equal((await call(a, 'room:create', { boardSize })).error, 'INVALID_PAYLOAD', String(boardSize));
      assert.equal((await call(a, 'room:createBot', { boardSize, difficulty: 'easy' })).error, 'INVALID_PAYLOAD', String(boardSize));
    }
    for (const turnSeconds of [0, 10, 45, 3_600, '30']) {
      assert.equal((await call(a, 'room:create', { turnSeconds })).error, 'INVALID_PAYLOAD', String(turnSeconds));
      assert.equal((await call(a, 'room:createBot', { turnSeconds, difficulty: 'easy' })).error, 'INVALID_PAYLOAD', String(turnSeconds));
    }
    const bot = await call(a, 'room:createBot', { boardSize: 30, turnSeconds: 15, difficulty: 'easy' });
    assert.equal(bot.state.config.boardSize, 30);
    assert.equal(bot.state.config.turnMs, 15_000);
    assert.equal(bot.state.game.board.length, 30 * 30);
  });

  it('assigns X/O, runs the countdown and plays a full game to a win', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const marks = m.state.players.map((p) => p.mark).sort();
    assert.deepEqual(marks, ['O', 'X']);
    assert.equal(m.state.status, 'PLAYING');

    // O cannot move first.
    assert.equal((await call(m.o, 'game:move', { roomId: m.roomId, index: 0, seq: 0 })).error, 'NOT_YOUR_TURN');

    let seq = 0;
    const moveSeen = next(m.o, 'game:move');
    assert.equal((await call(m.x, 'game:move', { roomId: m.roomId, index: at(10, 5), seq: seq++ })).ok, true);
    assert.equal((await moveSeen).index, at(10, 5), 'opponent receives the move in realtime');

    // Occupied cell, wrong turn.
    assert.equal((await call(m.o, 'game:move', { roomId: m.roomId, index: at(10, 5), seq })).error, 'CELL_TAKEN');
    assert.equal((await call(m.x, 'game:move', { roomId: m.roomId, index: at(0, 0), seq })).error, 'NOT_YOUR_TURN');

    assert.equal((await call(m.o, 'game:move', { roomId: m.roomId, index: at(11, 5), seq: seq++ })).ok, true);
    for (let c = 6; c <= 8; c++) {
      assert.equal((await call(m.x, 'game:move', { roomId: m.roomId, index: at(10, c), seq: seq++ })).ok, true);
      assert.equal((await call(m.o, 'game:move', { roomId: m.roomId, index: at(11, c), seq: seq++ })).ok, true);
    }
    const finished = next(m.o, 'game:finished');
    assert.equal((await call(m.x, 'game:move', { roomId: m.roomId, index: at(10, 9), seq: seq++ })).ok, true);
    const result = await finished;
    assert.equal(result.winner, 'X');
    assert.equal(result.reason, 'five');
    assert.deepEqual(result.winLine, [5, 6, 7, 8, 9].map((c) => at(10, c)));

    // Board is locked.
    assert.equal((await call(m.o, 'game:move', { roomId: m.roomId, index: at(0, 0), seq })).error, 'GAME_NOT_ACTIVE');
    const room = await server!.manager.getRoom(m.roomId);
    assert.equal(room!.status, 'FINISHED');
    assert.equal(room!.players.find((p) => p.mark === 'X')!.wins, 1);
  });

  it('accepts exactly one move when a player spams concurrent moves', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const attempts = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => call(m.x, 'game:move', { roomId: m.roomId, index: at(3, i), seq: 0 })),
    );
    assert.equal(attempts.filter((r) => r.ok).length, 1);
    const room = await server!.manager.getRoom(m.roomId);
    assert.equal(room!.game!.moves.length, 1);
    assert.equal(room!.game!.currentTurn, 'O');
  });

  it('waits for both players to be ready before starting', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    const roomId = created.roomId as string;
    assert.equal((await call(a, 'room:ready', { roomId })).error, 'READY_UNAVAILABLE', 'no ready check without an opponent');

    const joined = await call(b, 'room:join', { roomId, name: 'Bob' });
    assert.equal(joined.state.status, 'WAITING', 'joining alone does not start the match');
    assert.deepEqual(joined.state.readyVotes, []);
    assert.equal(joined.state.game, null);

    const aReady = await call(a, 'room:ready', { roomId });
    assert.deepEqual(aReady, { ok: true, started: false });
    let room = await server!.manager.getRoom(roomId);
    assert.equal(room!.status, 'WAITING');
    assert.deepEqual(room!.readyVotes, [created.playerId]);

    // Withdrawing and confirming again is allowed.
    await call(a, 'room:ready', { roomId, ready: false });
    assert.deepEqual((await server!.manager.getRoom(roomId))!.readyVotes, []);
    await call(a, 'room:ready', { roomId });

    // Dropping the connection withdraws the confirmation.
    b.disconnect();
    await sleep(50);
    room = await server!.manager.getRoom(roomId);
    assert.deepEqual(room!.readyVotes, [created.playerId]);

    const b2 = await client();
    const back = await call(b2, 'player:reconnect', { roomId, token: joined.token });
    assert.equal(back.state.status, 'WAITING', 'reconnecting does not start the match either');

    const started = next(a, 'game:started');
    const bReady = await call(b2, 'room:ready', { roomId });
    assert.deepEqual(bReady, { ok: true, started: true });
    await started;
    room = await server!.manager.getRoom(roomId);
    assert.equal(room!.status, 'PLAYING');
    assert.deepEqual(room!.readyVotes, []);
    assert.equal((await call(a, 'room:ready', { roomId })).error, 'READY_UNAVAILABLE', 'no ready check mid-game');
  });

  it('rejects moves during the start countdown', async () => {
    await boot({ startCountdownMs: 1_000 });
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', {});
    await call(b, 'room:join', { roomId: created.roomId });
    const live = await readyUp(created.roomId, a, b);
    const xIsA = live.players.find((p) => p.id === created.playerId)!.mark === 'X';
    const res = await call(xIsA ? a : b, 'game:move', { roomId: created.roomId, index: 0, seq: 0 });
    assert.equal(res.error, 'GAME_NOT_STARTED');
  });

  it('ends the game when the player on turn runs out of time', async () => {
    const cfg = await boot({ turnMs: 600 });
    const m = await startMatch();
    const t0 = Date.now();
    const result = await next(m.o, 'game:finished');
    assert.equal(result.reason, 'timeout');
    assert.equal(result.winner, 'O');
    assert.equal(result.loser, 'X');
    assert.ok(Date.now() - t0 >= cfg.turnMs - 50, 'should not time out early');
  });

  it('broadcasts server-driven timer ticks', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const tick = await next(m.x, 'game:timer');
    assert.equal(tick.currentTurn, 'X');
    assert.ok(tick.remainingMs > 0 && tick.remainingMs <= 5_000);
    assert.equal(typeof tick.serverNow, 'number');
  });

  it('lets a disconnected player reconnect without losing the board', async () => {
    await boot({ turnMs: 5_000, disconnectForfeitMs: 5_000 });
    const m = await startMatch();
    await call(m.x, 'game:move', { roomId: m.roomId, index: at(9, 9), seq: 0 });
    await call(m.o, 'game:move', { roomId: m.roomId, index: at(9, 10), seq: 1 });

    const disconnected = next(m.o, 'player:disconnected');
    m.x.disconnect();
    const d = await disconnected;
    assert.equal(d.playerId, m.xSession.playerId);
    assert.ok(d.forfeitAt > Date.now());

    const reconnected = next(m.o, 'player:reconnected');
    const x2 = await client();
    const res = await call(x2, 'player:reconnect', { roomId: m.roomId, token: m.xSession.token });
    assert.equal(res.ok, true);
    assert.equal(res.playerId, m.xSession.playerId);
    await reconnected;

    const state: RoomSnapshot = res.state;
    assert.equal(state.status, 'PLAYING');
    assert.equal(state.game!.moveCount, 2);
    assert.equal(state.game!.board[at(9, 9)], 'X');
    assert.equal(state.game!.board[at(9, 10)], 'O');
    assert.equal(state.game!.currentTurn, 'X');
    assert.equal(state.players.find((p) => p.id === m.xSession.playerId)!.online, true);

    // And can keep playing from the new socket.
    assert.equal((await call(x2, 'game:move', { roomId: m.roomId, index: at(0, 0), seq: 2 })).ok, true);
  });

  it('pauses the turn clock while the player on turn is disconnected', async () => {
    await boot({ turnMs: 600, disconnectForfeitMs: 5_000 });
    const m = await startMatch();
    const paused = next<RoomSnapshot>(m.o, 'room:state', (s) => s.game?.pausedRemainingMs != null);
    m.x.disconnect();
    const p = await paused;
    assert.ok(p.game!.pausedRemainingMs! > 0 && p.game!.pausedRemainingMs! <= 600);

    // Well past the turn time: X must not have lost on time while away.
    await sleep(900);
    const x2 = await client();
    const res = await call(x2, 'player:reconnect', { roomId: m.roomId, token: m.xSession.token });
    assert.equal(res.ok, true);
    assert.equal(res.state.status, 'PLAYING');
    assert.equal(res.state.game.pausedRemainingMs, null);
    const left = res.state.game.deadline - res.state.serverNow;
    assert.ok(left > 0 && left <= p.game!.pausedRemainingMs!, 'resumes with the time that was left');
    assert.equal((await call(x2, 'game:move', { roomId: m.roomId, index: at(9, 9), seq: 0 })).ok, true);
  });

  it('keeps the clock paused when the turn passes to a disconnected player', async () => {
    await boot({ turnMs: 600, disconnectForfeitMs: 5_000 });
    const m = await startMatch();
    const gone = next(m.x, 'player:disconnected');
    m.o.disconnect();
    await gone;
    const moved = await call(m.x, 'game:move', { roomId: m.roomId, index: at(9, 9), seq: 0 });
    assert.equal(moved.ok, true);
    await sleep(900);
    const o2 = await client();
    const res = await call(o2, 'player:reconnect', { roomId: m.roomId, token: m.oSession.token });
    assert.equal(res.state.status, 'PLAYING');
    assert.equal(res.state.game.currentTurn, 'O');
  });

  it('still times out the online player whose opponent is disconnected', async () => {
    await boot({ turnMs: 600, disconnectForfeitMs: 5_000 });
    const m = await startMatch();
    const finished = next(m.x, 'game:finished');
    m.o.disconnect();
    const result = await finished;
    assert.equal(result.reason, 'timeout');
    assert.equal(result.winner, 'O');
  });

  it('awards the win when a player stays disconnected too long', async () => {
    await boot({ turnMs: 5_000, disconnectForfeitMs: 400 });
    const m = await startMatch();
    const finished = next(m.x, 'game:finished');
    m.o.disconnect();
    const result = await finished;
    assert.equal(result.reason, 'abandoned');
    assert.equal(result.winner, 'X');
  });

  it('protects an active seat from a second tab unless takeover is requested', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const tab2 = await client();
    const denied = await call(tab2, 'player:reconnect', { roomId: m.roomId, token: m.xSession.token });
    assert.equal(denied.error, 'SESSION_ACTIVE');

    const replaced = next(m.x, 'session:replaced');
    const ok = await call(tab2, 'player:reconnect', { roomId: m.roomId, token: m.xSession.token, takeover: true });
    assert.equal(ok.ok, true);
    await replaced;
    // The old socket lost its seat.
    assert.equal((await call(m.x, 'game:move', { roomId: m.roomId, index: 0, seq: 0 })).error, 'NOT_IN_ROOM');
    assert.equal((await call(tab2, 'game:move', { roomId: m.roomId, index: 0, seq: 0 })).ok, true);
  });

  it('rejects forged or malformed sessions and payloads', async () => {
    await boot();
    const m = await startMatch();
    const c = await client();
    assert.equal((await call(c, 'player:reconnect', { roomId: m.roomId, token: 'x'.repeat(32) })).error, 'INVALID_SESSION');
    assert.equal((await call(c, 'room:join', { roomId: '../../etc' })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(c, 'game:move', { roomId: m.roomId, index: 'a', seq: 0 })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(c, 'game:move', { roomId: m.roomId, index: 0, seq: 0 })).error, 'NOT_IN_ROOM');
    assert.equal((await call(c, 'room:join', { roomId: 'zzzzzz' })).error, 'ROOM_NOT_FOUND');
  });

  it('seats a third visitor as a spectator only', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const c = await client();
    const res = await call(c, 'room:join', { roomId: m.roomId, name: 'Carol' });
    assert.equal(res.ok, true);
    assert.equal(res.role, 'spectator');
    assert.equal(res.playerId, undefined);
    assert.equal(res.state.players.length, 2);
    assert.equal((await call(c, 'game:move', { roomId: m.roomId, index: 0, seq: 0 })).error, 'NOT_IN_ROOM');
    const moveSeen = next(c, 'game:move');
    await call(m.x, 'game:move', { roomId: m.roomId, index: 42, seq: 0 });
    assert.equal((await moveSeen).index, 42, 'spectators see live moves');
  });

  it('handles resign and a rematch that swaps sides', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const finished = next(m.x, 'game:finished');
    assert.equal((await call(m.o, 'game:resign', { roomId: m.roomId })).ok, true);
    const result = await finished;
    assert.equal(result.reason, 'resign');
    assert.equal(result.winner, 'X');

    const first = await call(m.x, 'game:rematch', { roomId: m.roomId });
    assert.deepEqual(first, { ok: true, started: false });
    const newRound = next<RoomSnapshot>(m.x, 'room:state', (s) => s.round === 2);
    const second = await call(m.o, 'game:rematch', { roomId: m.roomId });
    assert.deepEqual(second, { ok: true, started: true });
    const state = await newRound;
    assert.equal(state.status, 'PLAYING');
    assert.equal(state.game!.moveCount, 0);
    assert.equal(state.players.find((p) => p.id === m.xSession.playerId)!.mark, 'O', 'sides swap');
    assert.equal(state.players.find((p) => p.id === m.xSession.playerId)!.wins, 1, 'score carries over');
  });

  it('gives the win to the remaining player when the opponent leaves, then accepts a new opponent', async () => {
    await boot({ turnMs: 5_000 });
    const m = await startMatch();
    const finished = next(m.x, 'game:finished');
    await call(m.o, 'room:leave', { roomId: m.roomId });
    const result = await finished;
    assert.equal(result.reason, 'left');
    assert.equal(result.winner, 'X');
    assert.equal(result.players.length, 2, 'result keeps the leaver for display');

    const c = await client();
    const started = next(m.x, 'game:started');
    const joined = await call(c, 'room:join', { roomId: m.roomId, name: 'Carol' });
    assert.equal(joined.role, 'player');
    assert.equal(joined.state.status, 'WAITING', 'a new opponent confirms the ready check first');
    await readyUp(m.roomId, m.x, c);
    await started;
    const room = await server!.manager.getRoom(m.roomId);
    assert.equal(room!.round, 2);
  });

  it('deletes the room when the last player leaves', async () => {
    await boot();
    const a = await client();
    const created = await call(a, 'room:create', {});
    await call(a, 'room:leave', { roomId: created.roomId });
    await sleep(20);
    assert.equal(await server!.manager.getRoom(created.roomId), undefined);
  });
});
