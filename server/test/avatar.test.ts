import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { createCaroServer, type CaroServer } from '../src/app.js';
import { CloudinaryAvatarStorage, LocalAvatarStorage, normalizeAvatar, sniffImage } from '../src/avatars/avatars.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { RoomSnapshot } from '../src/protocol.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function pngOfSize(width: number, height: number) {
  const b = Buffer.from(PNG);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** JFIF APP0 segment, then a baseline SOF0 frame header for 64×32. */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

/** Extended-format WebP header (VP8X) for 300×200. */
function webp(width: number, height: number) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

describe('avatar validation', () => {
  it('identifies images by their bytes and reads their size', () => {
    assert.deepEqual(pick(sniffImage(PNG)), { mime: 'image/png', ext: 'png', width: 1, height: 1 });
    assert.deepEqual(pick(sniffImage(JPEG)), { mime: 'image/jpeg', ext: 'jpg', width: 64, height: 32 });
    assert.deepEqual(pick(sniffImage(webp(300, 200))), { mime: 'image/webp', ext: 'webp', width: 300, height: 200 });
    assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
    assert.equal(sniffImage(PNG.subarray(0, 10)), null, 'truncated header');
  });

  it('only accepts presets and URLs from its own storage', () => {
    const local = new LocalAvatarStorage(tmpdir());
    assert.equal(normalizeAvatar('preset:fox', local), 'preset:fox');
    assert.equal(normalizeAvatar(' preset:owl ', local), 'preset:owl');
    assert.equal(normalizeAvatar('preset:unicorn', local), null);
    assert.equal(normalizeAvatar('/api/avatars/files/AbCdEfGhIjKlMnOp.webp', local), '/api/avatars/files/AbCdEfGhIjKlMnOp.webp');
    assert.equal(normalizeAvatar('/api/avatars/files/../../etc/passwd', local), null);
    assert.equal(normalizeAvatar('https://evil.example/pixel.png', local), null);
    assert.equal(normalizeAvatar('javascript:alert(1)', local), null);
    assert.equal(normalizeAvatar('', local), null);
    assert.equal(normalizeAvatar(undefined, local), null);

    const cloud = new CloudinaryAvatarStorage({ cloudName: 'demo', apiKey: 'k', apiSecret: 's', folder: 'caro/avatars' });
    const ok = 'https://res.cloudinary.com/demo/image/upload/v1712345678/caro/avatars/AbCdEfGhIjKlMnOp.webp';
    assert.equal(normalizeAvatar(ok, cloud), ok);
    assert.equal(normalizeAvatar(ok.replace('/demo/', '/other/'), cloud), null, 'another Cloudinary account');
    assert.equal(normalizeAvatar(ok.replace('caro/avatars', 'elsewhere'), cloud), null, 'another folder');
    assert.equal(normalizeAvatar('/api/avatars/files/AbCdEfGhIjKlMnOp.webp', cloud), null);
  });
});

const pick = (img: ReturnType<typeof sniffImage>) => img && { mime: img.mime, ext: img.ext, width: img.width, height: img.height };

// ─── End to end ──────────────────────────────────────────────────────────────

let server: CaroServer | null = null;
let clients: Socket[] = [];
let baseUrl = '';
let uploadDir = '';

async function boot(avatars: Partial<AppConfig['avatars']> = {}) {
  uploadDir = await mkdtemp(join(tmpdir(), 'caro-avatars-'));
  const base = loadConfig({});
  const cfg: AppConfig = {
    ...base,
    turnMs: 5_000,
    startCountdownMs: 100,
    disconnectForfeitMs: 300,
    avatars: { ...base.avatars, localDir: uploadDir, maxBytes: 64 * 1024, ...avatars },
  };
  server = createCaroServer(cfg);
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

function next<T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 3_000): Promise<T> {
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

const upload = (body: Buffer, type = 'image/png') =>
  fetch(`${baseUrl}/api/avatars`, { method: 'POST', headers: { 'Content-Type': type }, body: new Uint8Array(body) });

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  // fetch() keeps HTTP connections alive, which would hold the server open.
  server?.httpServer.closeAllConnections();
  await server?.close();
  server = null;
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
});

describe('avatars over sockets', () => {
  it('keeps the avatar chosen on create/join and drops ones the server does not own', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice', avatar: 'preset:fox' });
    assert.equal(created.ok, true);
    assert.equal(created.state.players[0].avatar, 'preset:fox');

    const joined = await call(b, 'room:join', { roomId: created.roomId, name: 'Bob', avatar: 'https://evil.example/x.png' });
    assert.equal(joined.ok, true);
    const bob = (joined.state as RoomSnapshot).players.find((p) => p.id === joined.playerId)!;
    assert.equal(bob.avatar, null, 'foreign URL is dropped, the client falls back to a default');

    const info: any = await fetch(`${baseUrl}/api/rooms/${created.roomId}`).then((r) => r.json());
    assert.equal(info.hostAvatar, 'preset:fox');
  });

  it('gives each bot level its own avatar, which people cannot take', async () => {
    await boot();
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const a = await client();
      const res = await call(a, 'room:createBot', { name: 'Alice', difficulty, avatar: 'preset:robot' });
      assert.equal(res.ok, true);
      const [me, bot] = (res.state as RoomSnapshot).players;
      assert.equal(me.avatar, 'preset:robot', 'the plain robot stays available to people');
      assert.equal(bot.isBot, true);
      assert.equal(bot.avatar, `preset:bot-${difficulty}`);
    }

    const b = await client();
    const created = await call(b, 'room:create', { name: 'Bob', avatar: 'preset:bot-hard' });
    assert.equal(created.state.players[0].avatar, null, 'a person cannot pose as a bot');
    const set = await call(b, 'player:avatar', { roomId: created.roomId, avatar: 'preset:bot-easy' });
    assert.equal(set.error, 'INVALID_PAYLOAD');
  });

  it('broadcasts an avatar change to the opponent and spectators without touching the game', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const spectator = await client();
    const created = await call(a, 'room:create', { name: 'Alice', avatar: 'preset:owl' });
    const started = next(a, 'game:started');
    await call(b, 'room:join', { roomId: created.roomId, name: 'Bob', avatar: 'preset:bear' });
    await call(a, 'room:ready', { roomId: created.roomId });
    await call(b, 'room:ready', { roomId: created.roomId });
    await started;
    const watching = await call(spectator, 'room:join', { roomId: created.roomId });
    assert.equal(watching.role, 'spectator');
    const before = (await call(a, 'room:join', { roomId: created.roomId })).state as RoomSnapshot;

    const avatarOfAlice = (s: RoomSnapshot) => s.players.find((p) => p.id === created.playerId)?.avatar;
    const seenByBob = next<RoomSnapshot>(b, 'room:state', (s) => avatarOfAlice(s) === 'preset:dragon');
    const seenBySpectator = next<RoomSnapshot>(spectator, 'room:state', (s) => avatarOfAlice(s) === 'preset:dragon');
    const res = await call(a, 'player:avatar', { roomId: created.roomId, avatar: 'preset:dragon' });
    assert.deepEqual(res, { ok: true, avatar: 'preset:dragon' });
    const [bobView] = await Promise.all([seenByBob, seenBySpectator]);

    assert.equal(bobView.status, 'PLAYING');
    assert.equal(bobView.game!.moveCount, before.game!.moveCount);
    assert.equal(bobView.game!.currentTurn, before.game!.currentTurn);
    assert.equal(bobView.game!.deadline, before.game!.deadline, 'the turn clock is not reset');

    const bad = await call(a, 'player:avatar', { roomId: created.roomId, avatar: 'https://evil.example/x.png' });
    assert.equal(bad.error, 'INVALID_PAYLOAD');
    const notASeat = await call(spectator, 'player:avatar', { roomId: created.roomId, avatar: 'preset:cat' });
    assert.equal(notASeat.error, 'NOT_IN_ROOM');
  });

  it('carries the avatar on chat messages and the finished result', async () => {
    await boot();
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'Alice', avatar: 'preset:panda' });
    const started = next(a, 'game:started');
    await call(b, 'room:join', { roomId: created.roomId, name: 'Bob', avatar: 'preset:frog' });
    await call(a, 'room:ready', { roomId: created.roomId });
    await call(b, 'room:ready', { roomId: created.roomId });
    await started;

    const chat = next(b, 'chat:message');
    await call(a, 'chat:send', { roomId: created.roomId, text: 'hi' });
    assert.equal((await chat).avatar, 'preset:panda');

    const finished = next(b, 'game:finished');
    await call(a, 'game:resign', { roomId: created.roomId });
    const result = await finished;
    assert.deepEqual(result.players.map((p: { avatar: string }) => p.avatar).sort(), ['preset:frog', 'preset:panda']);
  });

  it('restores the browser’s current avatar on reconnect', async () => {
    await boot();
    const a = await client();
    const created = await call(a, 'room:create', { name: 'Alice', avatar: 'preset:owl' });
    a.disconnect();
    const a2 = await client();
    const res = await call(a2, 'player:reconnect', { roomId: created.roomId, token: created.token, avatar: 'preset:tiger' });
    assert.equal(res.ok, true);
    assert.equal((res.state as RoomSnapshot).players[0].avatar, 'preset:tiger');
  });
});

describe('avatar uploads', () => {
  it('stores a valid image, serves it back and lets a player use it', async () => {
    await boot();
    const res = await upload(PNG);
    assert.equal(res.status, 201);
    const { ok, avatar } = (await res.json()) as any;
    assert.equal(ok, true);
    assert.match(avatar, /^\/api\/avatars\/files\/[A-Za-z0-9_-]{16}\.png$/);

    const file = await fetch(baseUrl + avatar);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

    const a = await client();
    const created = await call(a, 'room:create', { name: 'Alice' });
    const set = await call(a, 'player:avatar', { roomId: created.roomId, avatar });
    assert.deepEqual(set, { ok: true, avatar });
  });

  it('rejects files that are not JPG/PNG/WebP, whatever their declared type', async () => {
    await boot();
    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png');
    assert.equal(svg.status, 415);
    assert.equal(((await svg.json()) as any).error, 'INVALID_IMAGE');
  });

  it('rejects oversized files and oversized dimensions', async () => {
    await boot({ maxBytes: 1024 });
    const big = await upload(Buffer.concat([PNG, Buffer.alloc(4096)]));
    assert.equal(big.status, 413);
    assert.equal(((await big.json()) as any).error, 'TOO_LARGE');

    const huge = await upload(pngOfSize(20_000, 20_000));
    assert.equal(huge.status, 413, 'tiny file, gigantic bitmap');
  });

  it('limits uploads per IP', async () => {
    await boot({ uploadBurst: 2 });
    assert.equal((await upload(PNG)).status, 201);
    assert.equal((await upload(PNG)).status, 201);
    const third = await upload(PNG);
    assert.equal(third.status, 429);
    assert.equal(((await third.json()) as any).error, 'RATE_LIMITED');
  });

  it('never serves paths outside the upload folder', async () => {
    await boot();
    assert.equal((await fetch(`${baseUrl}/api/avatars/files/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/avatars/files/AbCdEfGhIjKlMnOp.webp`)).status, 404);
  });
});
