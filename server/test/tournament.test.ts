import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { PublicMatch, RoomSnapshot, TournamentSnapshot } from '../src/protocol.js';
import { seedOrder } from '../src/tournament/tournamentManager.js';

/* End-to-end tournament tests over real sockets, with timings shrunk. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(tournament: Partial<AppConfig['tournament']> = {}) {
  const base = loadConfig({});
  const cfg: AppConfig = {
    ...base,
    turnMs: 5_000,
    startCountdownMs: 100,
    disconnectForfeitMs: 2_000,
    moveGraceMs: 50,
    tournament: { ...base.tournament, readyCheckMs: 3_000, matchStartDelayMs: 150, nextGameDelayMs: 150, ...tournament },
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (r: number, c: number) => r * 20 + c;

function next<T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 5_000): Promise<T> {
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

interface Seat {
  socket: Socket;
  id: string;
  token: string;
}

/** Host creates a tournament, `joiners` more players join. */
async function setup(size: 4 | 8 | 16, joiners: number, bestOf?: 1 | 3 | 5) {
  const host = await client();
  const created = await call(host, 'tournament:create', { name: 'Cup', playerName: 'P0', size, bestOf });
  assert.equal(created.ok, true);
  const seats: Seat[] = [{ socket: host, id: created.participantId, token: created.token }];
  for (let i = 1; i <= joiners; i++) {
    const s = await client();
    const res = await call(s, 'tournament:join', { tournamentId: created.tournamentId, name: `P${i}` });
    assert.equal(res.ok, true);
    seats.push({ socket: s, id: res.participantId, token: res.token });
  }
  return { id: created.tournamentId as string, seats, host: seats[0] };
}

const seatOf = (seats: Seat[], id: string | null) => seats.find((s) => s.id === id)!;
const matchIn = (t: TournamentSnapshot, matchId: string) => t.rounds.flat().find((m) => m.id === matchId)!;

/** Both players confirm; resolves with the LIVE match. */
async function readyUp(tid: string, seats: Seat[], m: PublicMatch) {
  const live = next<TournamentSnapshot>(seats[0].socket, 'tournament:state', (t) => matchIn(t, m.id).status === 'LIVE');
  for (const id of [m.playerA, m.playerB]) {
    const res = await call(seatOf(seats, id).socket, 'tournament:ready', { tournamentId: tid, matchId: m.id });
    assert.equal(res.ok, true, res.message);
  }
  return matchIn(await live, m.id);
}

/** Both players take their room seats; `winnerId` makes five in a row. */
async function playOut(seats: Seat[], m: PublicMatch, winnerId: string) {
  const roomId = m.roomId!;
  const a = seatOf(seats, m.playerA);
  const b = seatOf(seats, m.playerB);
  const ra = await call(a.socket, 'player:reconnect', { roomId, token: a.token });
  assert.equal(ra.ok, true, ra.message);
  // In a series the next game starts after a short pause: wait for it. Polls gently,
  // so the socket stays well under the server's per-socket rate limit for the moves that follow.
  let rb: any;
  for (let i = 0; i < 40; i++) {
    rb = await call(b.socket, 'player:reconnect', { roomId, token: b.token });
    assert.equal(rb.ok, true, rb.message);
    if (rb.state.status === 'PLAYING' && !rb.state.game.finished) break;
    await sleep(120);
  }
  const state: RoomSnapshot = rb.state;
  assert.equal(state.mode, 'tournament');
  assert.equal(state.tournament?.matchId, m.id);
  await sleep(Math.max(0, state.game!.startAt - Date.now()) + 40);

  const markOf = (id: string) => state.players.find((p) => p.id === id)!.mark;
  const x = markOf(a.id) === 'X' ? a : b;
  const o = x === a ? b : a;
  const xWins = x.id === winnerId;
  const xCells = xWins ? [0, 1, 2, 3, 4].map((c) => at(0, c)) : [at(5, 0), at(5, 2), at(5, 4), at(7, 0), at(7, 2)];
  const oCells = xWins ? [0, 1, 2, 3].map((c) => at(1, c)) : [0, 1, 2, 3, 4].map((c) => at(0, c));
  let seq = 0;
  const move = async (s: Socket, index: number) => {
    const res = await call(s, 'game:move', { roomId, index, seq: seq++ });
    assert.equal(res.ok, true, `move ${seq - 1} of game ${state.round}: ${res.error}`);
  };
  for (let i = 0; i < 5; i++) {
    await move(x.socket, xCells[i]);
    if (xWins && i === 4) break;
    await move(o.socket, oCells[i]);
  }
  return roomId;
}

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('tournament bracket', () => {
  it('orders seeds so the top two can only meet in the final', () => {
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    assert.equal(seedOrder(16).length, 16);
  });

  it('runs a 4-player tournament from lobby to champion, with results from the game rooms', async () => {
    await boot();
    const { id, seats, host } = await setup(4, 3);

    const info = (await fetch(`${baseUrl}/api/tournaments/${id}`).then((r) => r.json())) as { exists: boolean; players: number };
    assert.equal(info.exists, true);
    assert.equal(info.players, 4);

    // Only the host starts, and snapshots never carry tokens.
    assert.equal((await call(seats[1].socket, 'tournament:start', { tournamentId: id })).error, 'NOT_HOST');
    const started = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.status === 'RUNNING');
    assert.equal((await call(host.socket, 'tournament:start', { tournamentId: id })).ok, true);
    const t0 = await started;
    assert.equal(JSON.stringify(t0).includes(host.token), false, 'token must not leak');
    assert.equal(t0.rounds.length, 2);
    assert.deepEqual(t0.rounds[0].map((m) => m.status), ['READY_CHECK', 'READY_CHECK']);
    assert.deepEqual(t0.participants.map((p) => p.seed).sort(), [1, 2, 3, 4]);

    // A late joiner can't take a spot any more.
    const late = await client();
    assert.equal((await call(late, 'tournament:join', { tournamentId: id })).error, 'TOURNAMENT_STARTED');

    // Semifinal 1: playerA wins.
    const sf1 = await readyUp(id, seats, t0.rounds[0][0]);
    assert.ok(sf1.roomId);
    // Nobody else can sit in a tournament room.
    const watcher = await client();
    assert.equal((await call(watcher, 'room:join', { roomId: sf1.roomId, name: 'Eve' })).role, 'spectator');
    const sf1Done = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => matchIn(t, 'r0m0').status === 'DONE');
    const room1 = await playOut(seats, sf1, sf1.playerA!);
    const afterSf1 = await sf1Done;
    assert.equal(matchIn(afterSf1, 'r0m0').winnerId, sf1.playerA);
    assert.equal(matchIn(afterSf1, 'r0m0').reason, 'five');
    assert.equal(afterSf1.rounds[1][0].playerA, sf1.playerA, 'winner moves into the final');
    assert.equal(afterSf1.rounds[1][0].status, 'PENDING', 'final waits for the other semifinal');
    assert.equal(afterSf1.participants.find((p) => p.id === sf1.playerB)!.eliminated, true);
    // No rematch in a bracket match.
    assert.equal((await call(seatOf(seats, sf1.playerA).socket, 'game:rematch', { roomId: room1, accept: true })).error, 'REMATCH_UNAVAILABLE');

    // Semifinal 2: playerB wins, which opens the final's ready check.
    const sf2 = await readyUp(id, seats, t0.rounds[0][1]);
    const finalOpen = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.rounds[1][0].status === 'READY_CHECK');
    await playOut(seats, sf2, sf2.playerB!);
    const tf = await finalOpen;
    assert.equal(tf.rounds[1][0].playerB, sf2.playerB);

    // Final.
    const final = await readyUp(id, seats, tf.rounds[1][0]);
    const finished = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.status === 'FINISHED');
    await playOut(seats, final, final.playerB!);
    const end = await finished;
    assert.equal(end.championId, final.playerB);
    assert.equal(end.rounds[1][0].winnerId, final.playerB);
    assert.ok(end.finishedAt);
  });

  it('gives byes to top seeds and settles a missed ready check as a walkover', async () => {
    await boot({ readyCheckMs: 400 });
    const { id, seats, host } = await setup(4, 2); // 3 of 4: one bye
    const started = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.status === 'RUNNING');
    await call(host.socket, 'tournament:start', { tournamentId: id });
    const t0 = await started;

    const bye = t0.rounds[0].find((m) => m.reason === 'bye')!;
    const seedOne = t0.participants.find((p) => p.seed === 1)!;
    assert.equal(bye.status, 'DONE');
    assert.equal(bye.winnerId, seedOne.id, 'the top seed gets the bye');

    const real = t0.rounds[0].find((m) => m.reason !== 'bye')!;
    assert.equal(real.status, 'READY_CHECK');
    const settled = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => matchIn(t, real.id).status === 'DONE', 3_000);
    assert.equal((await call(seatOf(seats, real.playerB).socket, 'tournament:ready', { tournamentId: id, matchId: real.id })).ok, true);
    const t1 = await settled;
    assert.equal(matchIn(t1, real.id).winnerId, real.playerB, 'the player who confirmed goes through');
    assert.equal(matchIn(t1, real.id).reason, 'walkover');
    assert.equal(t1.rounds[1][0].status, 'READY_CHECK');
  });

  it('a player who quits mid-match loses it, and the lobby handles leaving and a full bracket', async () => {
    await boot();
    const { id, seats, host } = await setup(4, 3);

    // Full lobby.
    const extra = await client();
    assert.equal((await call(extra, 'tournament:join', { tournamentId: id })).error, 'TOURNAMENT_FULL');
    // Leaving the lobby frees the spot; the host leaving hands the tournament over.
    const handed = next<TournamentSnapshot>(seats[1].socket, 'tournament:state', (t) => t.participants.length === 3);
    assert.equal((await call(host.socket, 'tournament:leave', { tournamentId: id })).ok, true);
    const t = await handed;
    assert.equal(t.hostId, seats[1].id);
    const back = await call(extra, 'tournament:join', { tournamentId: id, name: 'P9' });
    assert.equal(back.ok, true);
    const players: Seat[] = [...seats.slice(1), { socket: extra, id: back.participantId, token: back.token }];

    const started = next<TournamentSnapshot>(players[0].socket, 'tournament:state', (x) => x.status === 'RUNNING');
    await call(players[0].socket, 'tournament:start', { tournamentId: id });
    const t0 = await started;
    const m = await readyUp(id, players, t0.rounds[0][0]);
    const quitter = seatOf(players, m.playerA);
    await call(quitter.socket, 'player:reconnect', { roomId: m.roomId, token: quitter.token });

    const done = next<TournamentSnapshot>(players.find((p) => p !== quitter)!.socket, 'tournament:state', (x) => matchIn(x, m.id).status === 'DONE');
    assert.equal((await call(quitter.socket, 'tournament:leave', { tournamentId: id })).ok, true);
    const t1 = await done;
    assert.equal(matchIn(t1, m.id).winnerId, m.playerB);
    assert.equal(matchIn(t1, m.id).reason, 'left');
    assert.equal(t1.participants.find((p) => p.id === quitter.id)!.left, true);
  });

  it('plays a best-of-3 series in one room: 2–1 decides the match, sides swap every game', async () => {
    await boot();
    const { id, seats, host } = await setup(4, 3, 3);
    const started = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.status === 'RUNNING');
    await call(host.socket, 'tournament:start', { tournamentId: id });
    const t0 = await started;
    assert.equal(t0.config.bestOf, 3);

    const m = await readyUp(id, seats, t0.rounds[0][0]);
    const scoreIs = (a: number, b: number) =>
      next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => matchIn(t, m.id).scoreA === a && matchIn(t, m.id).scoreB === b);

    // Game 1 → A. The match stays LIVE and the next game is scheduled.
    let after = scoreIs(1, 0);
    await playOut(seats, m, m.playerA!);
    let s = matchIn(await after, m.id);
    assert.equal(s.status, 'LIVE');
    assert.ok(s.nextGameAt, 'next game scheduled');

    // Game 2 → B, in the same room with sides swapped.
    const room = await server!.manager.getRoom(m.roomId!);
    const firstX = room!.players.find((p) => p.mark === 'X')!.id;
    after = scoreIs(1, 1);
    await playOut(seats, m, m.playerB!);
    s = matchIn(await after, m.id);
    assert.equal(s.status, 'LIVE');
    const room2 = await server!.manager.getRoom(m.roomId!);
    assert.notEqual(room2!.players.find((p) => p.mark === 'X')!.id, firstX, 'sides swap between games');

    // Game 3 → A takes the series 2–1.
    const done = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => matchIn(t, m.id).status === 'DONE');
    await playOut(seats, m, m.playerA!);
    s = matchIn(await done, m.id);
    assert.equal(s.winnerId, m.playerA);
    assert.deepEqual([s.scoreA, s.scoreB, s.games], [2, 1, 3]);
    assert.equal(s.nextGameAt, null);
    const final = (await server!.manager.getRoom(m.roomId!))!;
    assert.equal(final.players.find((p) => p.id === m.playerA)!.wins, 2, 'room wins are the series score');
  });

  it('leaving between games of a series gives the match to the opponent', async () => {
    // Long enough that the leave always lands between games; leaving cancels it, so it costs nothing.
    await boot({ nextGameDelayMs: 5_000 });
    const { id, seats, host } = await setup(4, 3, 3);
    const started = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => t.status === 'RUNNING');
    await call(host.socket, 'tournament:start', { tournamentId: id });
    const m = await readyUp(id, seats, (await started).rounds[0][0]);

    const oneNil = next<TournamentSnapshot>(host.socket, 'tournament:state', (t) => matchIn(t, m.id).scoreA === 1);
    await playOut(seats, m, m.playerA!);
    await oneNil;
    // Watch from the opponent: the leaver's socket leaves the tournament channel before the
    // result is broadcast, and seeding is random, so the leaver is sometimes the host.
    const done = next<TournamentSnapshot>(seatOf(seats, m.playerB).socket, 'tournament:state', (t) => matchIn(t, m.id).status === 'DONE');
    assert.equal((await call(seatOf(seats, m.playerA).socket, 'tournament:leave', { tournamentId: id })).ok, true);
    const s = matchIn(await done, m.id);
    assert.equal(s.winnerId, m.playerB);
    assert.equal(s.reason, 'left');
    assert.deepEqual([s.scoreA, s.scoreB, s.nextGameAt], [1, 0, null], 'settled between games, no game forfeited');
  });

  it('reclaims a participant spot with the token, and a stranger with a bad token is refused', async () => {
    await boot();
    const { id, seats } = await setup(4, 1);
    seats[1].socket.disconnect();
    const again = await client();
    const res = await call(again, 'tournament:enter', { tournamentId: id, token: seats[1].token });
    assert.equal(res.role, 'participant');
    assert.equal(res.participantId, seats[1].id);
    const spectator = await client();
    assert.equal((await call(spectator, 'tournament:enter', { tournamentId: id })).role, 'spectator');
    assert.equal((await call(spectator, 'tournament:enter', { tournamentId: id, token: 'x'.repeat(32) })).error, 'INVALID_SESSION');
  });
});
