import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { BOT_TIME_BUDGET_MS, chooseBotMove } from '../src/bot/botEngine.js';
import { evaluateBoard, Position, sideOf } from '../src/bot/evaluate.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { findWinningLine } from '../src/game/winChecker.js';
import type { BotDifficulty, Mark } from '../src/types.js';

const SIZE = 20;
const at = (r: number, c: number) => r * SIZE + c;
const LEVELS: BotDifficulty[] = ['easy', 'medium', 'hard'];

/** Deterministic RNG so the random levels are reproducible. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boardOf(pieces: Record<number, Mark>) {
  const board = new Array<Mark | null>(SIZE * SIZE).fill(null);
  for (const [i, m] of Object.entries(pieces)) board[Number(i)] = m;
  return board;
}

function playGame(x: BotDifficulty, o: BotDifficulty, seed: number): Mark | null {
  const rng = seeded(seed);
  const board = new Array<Mark | null>(SIZE * SIZE).fill(null);
  let turn: Mark = 'X';
  for (let n = 0; n < board.length; n++) {
    const m = chooseBotMove(board, SIZE, turn, turn === 'X' ? x : o, { rng });
    assert.equal(board[m], null, 'bot played an occupied cell');
    board[m] = turn;
    if (findWinningLine(board, SIZE, m, turn, 5)) return turn;
    turn = turn === 'X' ? 'O' : 'X';
  }
  return null;
}

/** Wins of `a` over `b` across `games` games, alternating who plays X. */
function matchWins(a: BotDifficulty, b: BotDifficulty, games: number) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const aIsX = g % 2 === 0;
    const winner = playGame(aIsX ? a : b, aIsX ? b : a, 1000 + g);
    if (winner && (winner === 'X') === aIsX) wins++;
  }
  return wins;
}

describe('bot engine', () => {
  it('does not treat a five blocked at both ends as a win or a threat', () => {
    // Row 5: O X X X X _ O — filling the gap would be blocked by O at both ends.
    const pieces: Record<number, Mark> = { [at(5, 3)]: 'O', [at(5, 9)]: 'O' };
    for (let c = 4; c < 8; c++) pieces[at(5, c)] = 'X';
    const pos = new Position(boardOf(pieces), SIZE);
    assert.equal(pos.makesFive(at(5, 8), sideOf('X')), false);
    assert.deepEqual(pos.fivePoints(sideOf('X')), []);
    assert.equal(pos.hasFive(sideOf('X')), false);

    // Same shape with an open end is still a real five-point.
    const { [at(5, 9)]: _, ...oneEnd } = pieces;
    const open = new Position(boardOf(oneEnd), SIZE);
    assert.deepEqual(open.fivePoints(sideOf('X')).sort((a, b) => a - b), [at(5, 8)]);
  });

  it('does not treat a move that makes six in a row as a win or a threat', () => {
    // Row 5: X X _ X X X — filling the gap gives six, which does not win.
    const pieces: Record<number, Mark> = {};
    for (const c of [3, 4, 6, 7, 8]) pieces[at(5, c)] = 'X';
    const pos = new Position(boardOf(pieces), SIZE);
    assert.equal(pos.makesFive(at(5, 5), sideOf('X')), false);
    assert.ok(!pos.fivePoints(sideOf('X')).includes(at(5, 5)));
  });

  it('opens in the centre and never plays an occupied cell', () => {
    const empty = new Array<Mark | null>(SIZE * SIZE).fill(null);
    for (const level of LEVELS) assert.equal(chooseBotMove(empty, SIZE, 'X', level), at(10, 10));

    const rng = seeded(7);
    for (let trial = 0; trial < 30; trial++) {
      const board = new Array<Mark | null>(SIZE * SIZE).fill(null);
      const stones = 20 + Math.floor(rng() * 200);
      for (let k = 0; k < stones; k++) board[Math.floor(rng() * board.length)] = k % 2 ? 'O' : 'X';
      for (const level of LEVELS) {
        const m = chooseBotMove(board, SIZE, 'X', level, { rng, timeLimitMs: 30 });
        assert.ok(m >= 0 && m < board.length && board[m] === null, `${level} picked ${m}`);
      }
    }
  });

  it('completes its own five when it can, even over blocking', () => {
    // X: four in a row with a gap (row 5). O: an open four of its own (row 12).
    const board = boardOf({
      [at(5, 3)]: 'X', [at(5, 4)]: 'X', [at(5, 6)]: 'X', [at(5, 7)]: 'X',
      [at(12, 8)]: 'O', [at(12, 9)]: 'O', [at(12, 10)]: 'O', [at(12, 11)]: 'O',
    });
    for (const level of LEVELS) assert.equal(chooseBotMove(board, SIZE, 'X', level), at(5, 5), level);
  });

  it("blocks the opponent's five", () => {
    // O threatens a five on the diagonal; the only open end is (9, 9).
    const board = boardOf({
      [at(4, 4)]: 'X', [at(5, 5)]: 'O', [at(6, 6)]: 'O', [at(7, 7)]: 'O', [at(8, 8)]: 'O',
      [at(10, 3)]: 'X', [at(10, 4)]: 'X',
    });
    for (const level of LEVELS) {
      for (let s = 0; s < 5; s++) assert.equal(chooseBotMove(board, SIZE, 'X', level, { rng: seeded(s) }), at(9, 9), level);
    }
  });

  it('medium and hard stop an open three before it becomes an open four', () => {
    const board = boardOf({
      [at(10, 8)]: 'O', [at(10, 9)]: 'O', [at(10, 10)]: 'O',
      [at(11, 9)]: 'X', [at(9, 10)]: 'X',
    });
    const blocks = [at(10, 7), at(10, 11), at(10, 6), at(10, 12)];
    for (const level of ['medium', 'hard'] as const) {
      const m = chooseBotMove(board, SIZE, 'X', level, { rng: seeded(3) });
      assert.ok(blocks.includes(m), `${level} played ${m}`);
    }
  });

  it('hard turns its open three into an open four', () => {
    const board = boardOf({
      [at(10, 8)]: 'X', [at(10, 9)]: 'X', [at(10, 10)]: 'X',
      [at(11, 9)]: 'O', [at(9, 10)]: 'O',
    });
    assert.ok([at(10, 7), at(10, 11)].includes(chooseBotMove(board, SIZE, 'X', 'hard')));
  });

  it('evaluateBoard favours the side with the stronger lines', () => {
    const board = boardOf({ [at(3, 3)]: 'X', [at(3, 4)]: 'X', [at(3, 5)]: 'X', [at(15, 15)]: 'O' });
    assert.ok(evaluateBoard(board, SIZE, 'X') > 0);
    assert.equal(evaluateBoard(board, SIZE, 'O'), -evaluateBoard(board, SIZE, 'X'));
  });

  it('stays within its time budget on a crowded 20×20 board', () => {
    const rng = seeded(42);
    const board = new Array<Mark | null>(SIZE * SIZE).fill(null);
    let turn: Mark = 'X';
    // A realistic mid-game: 60 stones from medium-vs-medium play.
    for (let n = 0; n < 60; n++) {
      const m = chooseBotMove(board, SIZE, turn, 'medium', { rng });
      board[m] = turn;
      if (findWinningLine(board, SIZE, m, turn, 5)) board[m] = null;
      turn = turn === 'X' ? 'O' : 'X';
    }
    for (const level of LEVELS) {
      const t0 = performance.now();
      chooseBotMove(board, SIZE, turn, level, { rng });
      const ms = performance.now() - t0;
      assert.ok(ms < BOT_TIME_BUDGET_MS[level] + 100, `${level} took ${ms.toFixed(0)}ms`);
    }
  });

  it('difficulty levels are clearly ordered: medium beats easy, hard beats medium', () => {
    assert.ok(matchWins('medium', 'easy', 10) >= 8, 'medium should beat easy');
    assert.ok(matchWins('hard', 'medium', 4) >= 3, 'hard should beat medium');
  });
});

/* End-to-end: a bot room over real sockets. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(overrides: Partial<AppConfig> = {}) {
  const cfg: AppConfig = {
    ...loadConfig({}),
    turnMs: 5_000,
    startCountdownMs: 100,
    disconnectForfeitMs: 700,
    botMinDelayMs: 60,
    botMaxDelayMs: 150,
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

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('bot rooms', () => {
  it('starts at once, locks the person out while the bot thinks, and replies on an empty cell', async () => {
    const cfg = await boot();
    const a = await client();
    const started = next(a, 'game:started');
    const res = await call(a, 'room:createBot', { name: 'Alice', difficulty: 'medium', firstMove: 'human' });
    assert.equal(res.ok, true);
    assert.equal(res.state.mode, 'bot');
    assert.deepEqual(res.state.bot, { difficulty: 'medium', firstMove: 'human' });
    assert.equal(res.state.status, 'PLAYING');
    const bot = res.state.players.find((p: any) => p.isBot);
    const me = res.state.players.find((p: any) => p.id === res.playerId);
    assert.equal(bot.online, true);
    assert.equal(me.mark, 'X');
    assert.equal(bot.mark, 'O');
    assert.equal(JSON.stringify(res.state).includes(res.token), false);
    await started;

    const botMove = next(a, 'game:move', (m) => m.playerId === bot.id);
    const t0 = Date.now();
    assert.equal((await call(a, 'game:move', { roomId: res.roomId, index: at(10, 10), seq: 0 })).ok, true);
    // Bot's turn: the person is locked out.
    assert.equal((await call(a, 'game:move', { roomId: res.roomId, index: at(0, 0), seq: 1 })).error, 'NOT_YOUR_TURN');

    const m = await botMove;
    const elapsed = Date.now() - t0;
    assert.equal(m.mark, 'O');
    assert.notEqual(m.index, at(10, 10));
    assert.ok(elapsed >= cfg.botMinDelayMs - 10, `bot answered too fast (${elapsed}ms)`);
    assert.ok(elapsed <= cfg.botMaxDelayMs + 300, `bot answered too slowly (${elapsed}ms)`);

    const room = await server!.manager.getRoom(res.roomId);
    assert.equal(room!.game!.moves.length, 2);
    assert.equal(room!.game!.currentTurn, 'X');
  });

  it('moves first when asked to, and blocks a five in a live game', async () => {
    await boot();
    const a = await client();
    const res = await call(a, 'room:createBot', { difficulty: 'easy', firstMove: 'bot' });
    const bot = res.state.players.find((p: any) => p.isBot);
    assert.equal(bot.mark, 'X');
    const first = await next(a, 'game:move', (m) => m.playerId === bot.id);
    assert.equal(first.seq, 0);
    assert.equal(first.index, at(10, 10));

    // Give the person (O) three in a row on row 3 (the easy bot's own moves are random,
    // so set it up directly), then let them make it four: even easy must block.
    const room = await server!.manager.getRoom(res.roomId);
    for (const c of [2, 3, 4]) room!.game!.board[at(3, c)] = 'O';
    const reply = next(a, 'game:move', (m) => m.playerId === bot.id && m.seq === 2);
    assert.equal((await call(a, 'game:move', { roomId: res.roomId, index: at(3, 5), seq: 1 })).ok, true);
    const r = await reply;
    assert.ok([at(3, 1), at(3, 6)].includes(r.index), `bot did not block (played ${r.index})`);
  });

  it('supports rematch, keeps the score, and never seats a second person', async () => {
    await boot();
    const a = await client();
    const res = await call(a, 'room:createBot', { difficulty: 'hard', firstMove: 'human' });
    await next(a, 'game:started');

    const finished = next(a, 'game:finished');
    assert.equal((await call(a, 'game:resign', { roomId: res.roomId })).ok, true);
    const result = await finished;
    assert.equal(result.mode, 'bot');
    assert.equal(result.reason, 'resign');
    assert.equal(result.winner, 'O');

    const restarted = next(a, 'game:started');
    const rematch = await call(a, 'game:rematch', { roomId: res.roomId, accept: true });
    assert.equal(rematch.started, true, 'the bot accepts a rematch right away');
    await restarted;
    const room = await server!.manager.getRoom(res.roomId);
    assert.equal(room!.round, 2);
    assert.equal(room!.status, 'PLAYING');
    assert.equal(room!.players.find((p) => p.id === res.playerId)!.mark, 'X', 'first-move choice is kept');
    assert.equal(room!.players.find((p) => p.isBot)!.wins, 1);

    const b = await client();
    const joined = await call(b, 'room:join', { roomId: res.roomId, name: 'Bob' });
    assert.equal(joined.role, 'spectator');
  });

  it('closes the room when the person leaves, and does not count the bot as online', async () => {
    await boot();
    const a = await client();
    const res = await call(a, 'room:createBot', { difficulty: 'easy' });
    const stats = (await fetch(`${baseUrl}/api/stats`).then((r) => r.json())) as { playersOnline: number };
    assert.equal(stats.playersOnline, 1);
    await call(a, 'room:leave', { roomId: res.roomId });
    assert.equal(await server!.manager.getRoom(res.roomId), undefined);
  });

  it('rejects an unknown difficulty', async () => {
    await boot();
    const a = await client();
    assert.equal((await call(a, 'room:createBot', { difficulty: 'godlike' })).error, 'INVALID_PAYLOAD');
  });
});
