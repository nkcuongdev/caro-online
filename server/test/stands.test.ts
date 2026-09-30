import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import type { StandsLimits } from '../src/comms/standsHub.js';
import { loadConfig, type AppConfig } from '../src/config.js';

/* Spectator "stands": comments, stickers and floating reactions over real sockets. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(stands: Partial<StandsLimits> = {}) {
  const cfg: AppConfig = { ...loadConfig({}), turnMs: 5_000, startCountdownMs: 100, disconnectForfeitMs: 5_000 };
  server = createCaroServer(cfg, undefined, { stands: { viewerMinIntervalMs: 0, ...stands } });
  await new Promise<void>((resolve) => server!.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
}

async function client() {
  const s = connectClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(s);
  await new Promise<void>((resolve) => s.once('connect', () => resolve()));
  return s;
}

const call = (s: Socket, event: string, data: unknown): Promise<any> => s.timeout(2_000).emitWithAck(event, data);

function next<T = any>(s: Socket, event: string, ms = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    s.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Collects every `event` for `ms`. */
function collect(s: Socket, event: string, ms = 300): Promise<any[]> {
  const got: any[] = [];
  const handler = (p: any) => got.push(p);
  s.on(event, handler);
  return new Promise((resolve) =>
    setTimeout(() => {
      s.off(event, handler);
      resolve(got);
    }, ms),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Two players in a live game plus `n` spectators already seated in the stands. */
async function watchParty(n = 2) {
  const a = await client();
  const b = await client();
  const created = await call(a, 'room:create', { name: 'Alice' });
  const started = next(a, 'game:started');
  await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
  await call(a, 'room:ready', { roomId: created.roomId });
  await call(b, 'room:ready', { roomId: created.roomId });
  await started;
  const roomId = created.roomId as string;
  const fans: Socket[] = [];
  const viewers: any[] = [];
  for (let i = 0; i < n; i++) {
    const s = await client();
    assert.equal((await call(s, 'room:join', { roomId, name: `Fan ${i}` })).role, 'spectator');
    const joined = await call(s, 'stands:join', { roomId, name: `Fan ${i}` });
    assert.equal(joined.ok, true);
    fans.push(s);
    viewers.push(joined.viewer);
  }
  return { roomId, a, b, fans, viewers };
}

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('stands', () => {
  it('shares comments among spectators but hides them from players while the game is live', async () => {
    await boot();
    const m = await watchParty(2);
    const toFan = next(m.fans[1], 'stands:message');
    const toA = collect(m.a, 'stands:message');
    const toB = collect(m.b, 'stands:message');
    const res = await call(m.fans[0], 'stands:chat', { roomId: m.roomId, text: '  đánh ô giữa đi <b>Alice</b>  ' });
    assert.equal(res.ok, true);
    assert.equal(res.message.text, 'đánh ô giữa đi <b>Alice</b>', 'HTML is kept as literal text');
    assert.equal(res.message.name, 'Fan 0');
    assert.equal(res.message.playerId, m.viewers[0].id);
    assert.deepEqual(await toFan, res.message);
    assert.deepEqual(await toA, [], 'no coaching: players get nothing during the game');
    assert.deepEqual(await toB, []);
    assert.deepEqual((await call(m.a, 'stands:sync', { roomId: m.roomId })).messages, [], 'not even via sync');

    // Once the game is over, players can read the thread and get new comments live.
    const finished = next(m.a, 'game:finished');
    await call(m.b, 'game:resign', { roomId: m.roomId });
    await finished;
    const sync = await call(m.a, 'stands:sync', { roomId: m.roomId });
    assert.equal(sync.live, false);
    assert.deepEqual(sync.messages.map((x: any) => x.text), ['đánh ô giữa đi <b>Alice</b>']);
    const live = next(m.a, 'stands:message');
    await call(m.fans[1], 'stands:chat', { roomId: m.roomId, text: 'GG cả hai!' });
    assert.equal((await live).text, 'GG cả hai!');
  });

  it('only lets seated spectators post', async () => {
    await boot();
    const m = await watchParty(1);
    assert.equal((await call(m.a, 'stands:chat', { roomId: m.roomId, text: 'hi' })).error, 'NOT_IN_ROOM', 'players cannot post');
    assert.equal((await call(m.a, 'stands:join', { roomId: m.roomId })).error, 'NOT_IN_ROOM');
    const lurker = await client();
    await call(lurker, 'room:join', { roomId: m.roomId });
    assert.equal((await call(lurker, 'stands:chat', { roomId: m.roomId, text: 'hi' })).error, 'NOT_IN_ROOM', 'must join the stands first');
    const outsider = await client();
    assert.equal((await call(outsider, 'stands:join', { roomId: m.roomId })).error, 'NOT_IN_ROOM');

    const fan = m.fans[0];
    assert.equal((await call(fan, 'stands:chat', { roomId: m.roomId, text: '  ' })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(fan, 'stands:chat', { roomId: m.roomId, text: 'x'.repeat(161) })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(fan, 'stands:sticker', { roomId: m.roomId, sticker: 'https://evil.example/a.png' })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(fan, 'stands:react', { roomId: m.roomId, emoji: '<img>' })).error, 'INVALID_PAYLOAD');

    // Leaving the room leaves the stands.
    await call(fan, 'room:leave', { roomId: m.roomId });
    assert.equal((await call(fan, 'stands:chat', { roomId: m.roomId, text: 'still here?' })).error, 'NOT_IN_ROOM');
  });

  it('floats reactions and stickers over the board for everyone, players included', async () => {
    await boot();
    const m = await watchParty(2);
    const atA = next(m.a, 'stands:hype');
    const atFan = next(m.fans[1], 'stands:hype');
    const res = await call(m.fans[0], 'stands:react', { roomId: m.roomId, emoji: '🔥' });
    assert.deepEqual(res, { ok: true, shown: true });
    const hype = await atA;
    assert.equal(hype.emoji, '🔥');
    assert.equal(hype.name, 'Fan 0');
    assert.equal((await atFan).id, hype.id);
    assert.equal((await call(m.fans[0], 'stands:react', { roomId: m.roomId, emoji: '😂' })).error, 'RATE_LIMITED', 'per-viewer cooldown');

    // A sticker is both a stands message (spectators only, while live) and a float for everyone.
    const stickerHype = next(m.b, 'stands:hype');
    const quiet = collect(m.b, 'stands:message');
    const st = await call(m.fans[1], 'stands:sticker', { roomId: m.roomId, sticker: 'caro:gg' });
    assert.equal(st.message.sticker, 'caro:gg');
    assert.equal((await stickerHype).sticker, 'caro:gg');
    assert.deepEqual(await quiet, []);
  });

  it('caps floating reactions per room so a crowd cannot flood the players', async () => {
    await boot({ roomHypePerSecond: 3, reactionCooldownMs: 0 });
    const m = await watchParty(6);
    const seen = collect(m.a, 'stands:hype', 500);
    const results = await Promise.all(m.fans.map((f) => call(f, 'stands:react', { roomId: m.roomId, emoji: '👏' })));
    assert.equal(results.filter((r) => r.shown).length, 3);
    assert.equal(results.filter((r) => r.ok && !r.shown).length, 3, 'excess is dropped quietly, not an error');
    assert.equal((await seen).length, 3);
  });

  it('rate limits per viewer and per IP address', async () => {
    await boot({ viewerBurst: 2, viewerWindowMs: 1_000, ipBurst: 3, ipWindowMs: 1_000 });
    const m = await watchParty(2);
    const [f0, f1] = m.fans;
    const say = (s: Socket, text: string) => call(s, 'stands:chat', { roomId: m.roomId, text });
    assert.equal((await say(f0, 'một')).ok, true);
    assert.equal((await say(f0, 'hai')).ok, true);
    assert.equal((await say(f0, 'ba')).error, 'RATE_LIMITED', 'viewer burst');
    assert.equal((await say(f1, 'bốn')).ok, true);
    // Both tabs come from the same address: a new tab does not buy more messages.
    assert.equal((await say(f1, 'năm')).error, 'RATE_LIMITED', 'ip burst');
    await sleep(1_050);
    assert.equal((await say(f1, 'sáu')).ok, true);
  });

  it('shows harmless comments to players live, but holds back move advice', async () => {
    await boot();
    const m = await watchParty(2);
    const atA = collect(m.a, 'stands:message', 1600);
    const atFan = collect(m.fans[1], 'stands:message', 1600);
    await call(m.fans[0], 'stands:chat', { roomId: m.roomId, text: 'Hay quá, cố lên An!' });
    await sleep(1_050);
    await call(m.fans[0], 'stands:chat', { roomId: m.roomId, text: 'chặn bên trái đi' });
    const [gotA, gotFan] = await Promise.all([atA, atFan]);
    assert.deepEqual(gotA.map((x) => x.text), ['Hay quá, cố lên An!'], 'players only get the harmless one');
    assert.deepEqual(gotFan.map((x) => x.text), ['Hay quá, cố lên An!', 'chặn bên trái đi'], 'spectators get everything');
  });

  it('keeps every comment from players in tournament rooms', async () => {
    await boot();
    const m = await watchParty(1);
    (await server!.manager.getRoom(m.roomId))!.mode = 'tournament';
    const atA = collect(m.a, 'stands:message', 300);
    await call(m.fans[0], 'stands:chat', { roomId: m.roomId, text: 'Hay quá!' });
    assert.deepEqual(await atA, []);
  });

  it('lets spectators cheer for a player and shares the fan counts', async () => {
    await boot({ cheerCooldownMs: 200 });
    const m = await watchParty(2);
    const room = (await server!.manager.getRoom(m.roomId))!;
    const [alice, bob] = room.players;

    const seen = next(m.a, 'stands:cheers');
    const res = await call(m.fans[0], 'stands:cheer', { roomId: m.roomId, playerId: alice.id });
    assert.equal(res.supports, alice.id);
    assert.deepEqual((await seen).cheers, { [alice.id]: 1, [bob.id]: 0 });
    await call(m.fans[1], 'stands:cheer', { roomId: m.roomId, playerId: alice.id });

    assert.equal((await call(m.fans[0], 'stands:cheer', { roomId: m.roomId, playerId: bob.id })).error, 'RATE_LIMITED', 'switching sides has a cooldown');
    await sleep(220);
    const switched = await call(m.fans[0], 'stands:cheer', { roomId: m.roomId, playerId: bob.id });
    assert.deepEqual(switched.cheers, { [alice.id]: 1, [bob.id]: 1 });
    assert.equal((await call(m.fans[0], 'stands:cheer', { roomId: m.roomId, playerId: 'nobody' })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(m.a, 'stands:cheer', { roomId: m.roomId, playerId: alice.id })).error, 'NOT_IN_ROOM', 'players cannot cheer');

    // Reactions carry the side, and players see the counts on sync.
    const hype = next(m.b, 'stands:hype');
    await call(m.fans[0], 'stands:react', { roomId: m.roomId, emoji: '💪' });
    assert.equal((await hype).supports, bob.id);
    assert.deepEqual((await call(m.b, 'stands:sync', { roomId: m.roomId })).cheers, { [alice.id]: 1, [bob.id]: 1 });

    // A fan who leaves no longer counts.
    const after = next(m.a, 'stands:cheers');
    m.fans[1].disconnect();
    assert.deepEqual((await after).cheers, { [alice.id]: 0, [bob.id]: 1 });
  });
});
