import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import type { CommsLimits } from '../src/comms/commsHub.js';
import { sanitizeChatText } from '../src/comms/text.js';
import { loadConfig, type AppConfig } from '../src/config.js';

/* Chat, reactions and voice signaling over real sockets. */

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';

async function boot(limits: Partial<CommsLimits> = {}, overrides: Partial<AppConfig> = {}) {
  const cfg: AppConfig = { ...loadConfig({}), turnMs: 5_000, startCountdownMs: 100, disconnectForfeitMs: 5_000, ...overrides };
  server = createCaroServer(cfg, undefined, limits);
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

/** Resolves true if `event` does NOT arrive within `ms`. */
function silent(s: Socket, event: string, ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => resolve(false);
    s.once(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve(true);
    }, ms);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pair() {
  const a = await client();
  const b = await client();
  const created = await call(a, 'room:create', { name: 'Alice' });
  const started = next(a, 'game:started');
  const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob' });
  await call(a, 'room:ready', { roomId: created.roomId });
  await call(b, 'room:ready', { roomId: created.roomId });
  await started;
  // A repeated join returns the seat with the running game's snapshot (marks assigned).
  const { state } = await call(a, 'room:join', { roomId: created.roomId });
  return { roomId: created.roomId as string, a, b, aId: created.playerId as string, bId: joined.playerId as string, created, joined, state };
}

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await server?.close();
  server = null;
});

describe('chat text sanitizing', () => {
  it('keeps HTML as literal text but strips invisible and layout-breaking characters', () => {
    assert.equal(sanitizeChatText('  <img src=x onerror=alert(1)>  '), '<img src=x onerror=alert(1)>');
    assert.equal(sanitizeChatText('a\u202Eb\u200Bc\n\nd\t e'), 'a b c d e');
    assert.equal(sanitizeChatText('Xin chào 👨‍👩‍👧 ❤️'), 'Xin chào 👨‍👩‍👧 ❤️', 'ZWJ emoji and Vietnamese survive');
    assert.equal(sanitizeChatText('q\u0301\u0302\u0303\u0304\u0305'), 'q\u0301\u0302\u0303');
    assert.equal(sanitizeChatText(' \u200B \u0000 '), '');
  });
});

describe('in-match chat', () => {
  it('delivers messages to the opponent only, never to spectators', async () => {
    await boot();
    const m = await pair();
    const spectator = await client();
    assert.equal((await call(spectator, 'room:join', { roomId: m.roomId })).role, 'spectator');

    const got = next(m.b, 'chat:message');
    const specSilent = silent(spectator, 'chat:message');
    const selfSilent = silent(m.a, 'chat:message');
    const res = await call(m.a, 'chat:send', { roomId: m.roomId, text: '  <b>gg</b>  ' });
    assert.equal(res.ok, true);
    assert.equal(res.message.text, '<b>gg</b>');
    assert.equal(res.message.name, 'Alice');

    const msg = await got;
    assert.deepEqual(msg, res.message);
    assert.equal(await specSilent, true, 'spectator must not receive chat');
    assert.equal(await selfSilent, true, 'sender gets the ack, not an echo');

    // Spectators cannot send either.
    assert.equal((await call(spectator, 'chat:send', { roomId: m.roomId, text: 'hi' })).error, 'NOT_IN_ROOM');
  });

  it('validates length and content', async () => {
    await boot();
    const m = await pair();
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: '   \u200B ' })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: 'x'.repeat(201) })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: '😂'.repeat(200) })).ok, true, 'emoji count as one char');
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: 42 })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(m.a, 'chat:send', { roomId: 'ZZZZZZ', text: 'hi' })).error, 'NOT_IN_ROOM');
  });

  it('rejects chat when alone in the room', async () => {
    await boot();
    const a = await client();
    const created = await call(a, 'room:create', {});
    assert.equal((await call(a, 'chat:send', { roomId: created.roomId, text: 'hello?' })).error, 'NO_OPPONENT');
  });

  it('rate limits bursts and repeated messages', async () => {
    await boot({ chatBurst: 3, chatWindowMs: 1_000, chatMinIntervalMs: 0, chatDuplicateMs: 1_000 });
    const m = await pair();
    const send = (text: string) => call(m.a, 'chat:send', { roomId: m.roomId, text });
    assert.equal((await send('one')).ok, true);
    assert.equal((await send('one')).error, 'RATE_LIMITED', 'duplicate');
    assert.equal((await send('two')).ok, true);
    assert.equal((await send('three')).ok, true);
    assert.equal((await send('four')).error, 'RATE_LIMITED', 'burst');
    // The limit is per player, not per socket: reconnecting does not reset it.
    m.a.disconnect();
    const a2 = await client();
    assert.equal((await call(a2, 'player:reconnect', { roomId: m.roomId, token: m.created.token })).ok, true);
    assert.equal((await call(a2, 'chat:send', { roomId: m.roomId, text: 'five' })).error, 'RATE_LIMITED');
    await sleep(1_050);
    assert.equal((await call(a2, 'chat:send', { roomId: m.roomId, text: 'five' })).ok, true);
  });

  it('replays history on sync, scoped to the current pairing', async () => {
    await boot({ chatMinIntervalMs: 0 });
    const m = await pair();
    await call(m.a, 'chat:send', { roomId: m.roomId, text: 'hi Bob' });
    await call(m.b, 'chat:send', { roomId: m.roomId, text: 'hi Alice' });

    const sync = await call(m.b, 'comms:sync', { roomId: m.roomId });
    assert.deepEqual(sync.messages.map((x: any) => x.text), ['hi Bob', 'hi Alice']);
    assert.deepEqual(sync.voice[m.aId], { enabled: false, muted: false });

    // Bob leaves; Carol takes the seat and must not see the earlier conversation.
    await call(m.b, 'room:leave', { roomId: m.roomId });
    const c = await client();
    const carol = await call(c, 'room:join', { roomId: m.roomId, name: 'Carol' });
    assert.equal(carol.role, 'player');
    assert.deepEqual((await call(c, 'comms:sync', { roomId: m.roomId })).messages, []);
  });
});

describe('reactions', () => {
  it('relays whitelisted emoji to the opponent with a cooldown', async () => {
    await boot({ reactionCooldownMs: 300 });
    const m = await pair();
    const got = next(m.b, 'reaction');
    const res = await call(m.a, 'reaction:send', { roomId: m.roomId, emoji: '🔥' });
    assert.equal(res.ok, true);
    const r = await got;
    assert.equal(r.emoji, '🔥');
    assert.equal(r.playerId, m.aId);

    assert.equal((await call(m.a, 'reaction:send', { roomId: m.roomId, emoji: '😂' })).error, 'RATE_LIMITED');
    assert.equal((await call(m.b, 'reaction:send', { roomId: m.roomId, emoji: '😂' })).ok, true, 'cooldown is per player');
    await sleep(320);
    assert.equal((await call(m.a, 'reaction:send', { roomId: m.roomId, emoji: '❤️' })).ok, true);
    assert.equal((await call(m.a, 'reaction:send', { roomId: m.roomId, emoji: '<script>' })).error, 'INVALID_PAYLOAD');
  });
});

describe('voice signaling', () => {
  const offer = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };

  it('relays signals only while both players have voice enabled', async () => {
    await boot();
    const m = await pair();
    assert.equal((await call(m.a, 'voice:signal', { roomId: m.roomId, signal: offer })).error, 'NO_OPPONENT');

    const stateSeen = next(m.b, 'voice:state');
    assert.equal((await call(m.a, 'voice:state', { roomId: m.roomId, enabled: true, muted: false })).ok, true);
    assert.deepEqual(await stateSeen, { roomId: m.roomId, playerId: m.aId, enabled: true, muted: false });
    assert.equal((await call(m.a, 'voice:signal', { roomId: m.roomId, signal: offer })).error, 'NO_OPPONENT', 'B has not opted in');

    await call(m.b, 'voice:state', { roomId: m.roomId, enabled: true });
    const relayed = next(m.b, 'voice:signal');
    assert.equal((await call(m.a, 'voice:signal', { roomId: m.roomId, signal: offer })).ok, true);
    assert.deepEqual(await relayed, { roomId: m.roomId, from: m.aId, signal: offer });

    const ice = { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0, extra: 'x' } };
    const iceSeen = next(m.a, 'voice:signal');
    assert.equal((await call(m.b, 'voice:signal', { roomId: m.roomId, signal: ice })).ok, true);
    const got = await iceSeen;
    assert.equal(got.signal.candidate.extra, undefined, 'unknown fields are stripped');

    assert.equal((await call(m.a, 'voice:signal', { roomId: m.roomId, signal: { type: 'bogus' } })).error, 'INVALID_PAYLOAD');
    assert.equal((await call(m.a, 'voice:signal', { roomId: m.roomId, signal: { type: 'offer', sdp: 'x'.repeat(13_000) } })).error, 'INVALID_PAYLOAD');
  });

  it('hands TURN servers only to seated players, null when none is configured', async () => {
    await boot();
    const m = await pair();
    assert.deepEqual(await call(m.a, 'voice:ice', { roomId: m.roomId }), { ok: true, iceServers: null });
    const stranger = await client();
    assert.equal((await call(stranger, 'voice:ice', { roomId: m.roomId })).error, 'NOT_IN_ROOM');
  });

  it('turns voice off for the opponent when a player disconnects or reconnects', async () => {
    await boot();
    const m = await pair();
    await call(m.a, 'voice:state', { roomId: m.roomId, enabled: true });
    await call(m.b, 'voice:state', { roomId: m.roomId, enabled: true });

    const off = next(m.b, 'voice:state');
    m.a.disconnect();
    assert.deepEqual(await off, { roomId: m.roomId, playerId: m.aId, enabled: false, muted: false });

    const a2 = await client();
    await call(a2, 'player:reconnect', { roomId: m.roomId, token: m.created.token });
    const sync = await call(a2, 'comms:sync', { roomId: m.roomId });
    assert.equal(sync.voice[m.aId].enabled, false, 'a reconnecting client starts with voice off');
    assert.equal(sync.voice[m.bId].enabled, true);
  });

  it('never lets comms traffic rate-limit game moves', async () => {
    await boot();
    const m = await pair();
    await call(m.a, 'voice:state', { roomId: m.roomId, enabled: true });
    await call(m.b, 'voice:state', { roomId: m.roomId, enabled: true });
    const ice = { type: 'ice', candidate: null };
    const x = m.state.players.find((p: any) => p.id === m.aId).mark === 'X' ? m.a : m.b;
    await Promise.all(Array.from({ length: 35 }, () => call(x, 'voice:signal', { roomId: m.roomId, signal: ice })));
    const move = await call(x, 'game:move', { roomId: m.roomId, index: 210, seq: 0 });
    assert.equal(move.ok, true);
  });
});

describe('stickers', () => {
  it('relays whitelisted stickers as chat messages and keeps them in history', async () => {
    await boot({ chatMinIntervalMs: 0 });
    const m = await pair();
    const spectator = await client();
    await call(spectator, 'room:join', { roomId: m.roomId });

    const got = next(m.b, 'chat:message');
    const specSilent = silent(spectator, 'chat:message');
    const res = await call(m.a, 'chat:sticker', { roomId: m.roomId, sticker: 'noto:fire' });
    assert.equal(res.ok, true);
    assert.equal(res.message.sticker, 'noto:fire');
    assert.equal(res.message.text, '');
    assert.deepEqual(await got, res.message);
    assert.equal(await specSilent, true, 'spectators never get stickers');

    for (const bad of ['noto:nope', '../../etc/passwd', 'https://evil.example/x.png', '']) {
      assert.equal((await call(m.a, 'chat:sticker', { roomId: m.roomId, sticker: bad })).error, 'INVALID_PAYLOAD', bad);
    }
    const sync = await call(m.b, 'comms:sync', { roomId: m.roomId });
    assert.deepEqual(sync.messages.map((x: any) => x.sticker), ['noto:fire']);
  });

  it('shares the chat rate limit with text messages', async () => {
    await boot({ chatBurst: 3, chatWindowMs: 1_000, chatMinIntervalMs: 0 });
    const m = await pair();
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: 'hi' })).ok, true);
    assert.equal((await call(m.a, 'chat:sticker', { roomId: m.roomId, sticker: 'caro:gg' })).ok, true);
    assert.equal((await call(m.a, 'chat:sticker', { roomId: m.roomId, sticker: 'caro:gg' })).ok, true, 'same sticker twice is fine');
    assert.equal((await call(m.a, 'chat:sticker', { roomId: m.roomId, sticker: 'fluent:trophy' })).error, 'RATE_LIMITED');
    assert.equal((await call(m.a, 'chat:send', { roomId: m.roomId, text: 'again' })).error, 'RATE_LIMITED');
  });
});
