import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import { normalizeAvatar, type AvatarStorage } from '../avatars/avatars.js';
import type { ChatMessage, StandsCheers, StandsHype, StandsViewer } from '../protocol.js';
import { GameError, type RoomManager } from '../rooms/roomManager.js';
import { sanitizeName } from '../rooms/names.js';
import { channel } from '../socket/socketSink.js';
import type { Room } from '../types.js';
import { mayCoach } from './coaching.js';
import { REACTION_SET } from './reactions.js';
import { STICKER_SET } from './stickers.js';
import { sanitizeChatText, textLength } from './text.js';

export interface StandsLimits {
  msgMaxLength: number;
  /** Per viewer: at most `viewerBurst` posts (text + stickers) per `viewerWindowMs`. */
  viewerBurst: number;
  viewerWindowMs: number;
  viewerMinIntervalMs: number;
  duplicateMs: number;
  /** Per IP address and room, so opening more tabs doesn't buy more messages. */
  ipBurst: number;
  ipWindowMs: number;
  reactionCooldownMs: number;
  /** How often a viewer may switch the player they cheer for. */
  cheerCooldownMs: number;
  /** Room-wide cap on floating reactions/stickers per second; the excess is dropped. */
  roomHypePerSecond: number;
  history: number;
}

export const DEFAULT_STANDS_LIMITS: StandsLimits = {
  msgMaxLength: 160,
  viewerBurst: 3,
  viewerWindowMs: 5_000,
  viewerMinIntervalMs: 1_000,
  duplicateMs: 10_000,
  ipBurst: 8,
  ipWindowMs: 10_000,
  reactionCooldownMs: 700,
  cheerCooldownMs: 1_500,
  roomHypePerSecond: 8,
  history: 60,
};

interface Viewer extends StandsViewer {
  socketId: string;
  ip: string;
  posts: number[];
  lastText: string;
  lastTextAt: number;
  lastReactionAt: number;
  /** Player id this viewer cheers for. */
  supports: string | null;
  lastCheerAt: number;
}

interface RoomStands {
  viewers: Map<string, Viewer>; // by socket id
  history: ChatMessage[];
  ipHits: Map<string, number[]>;
  hypeHits: number[];
}

/** A game is "live" from the countdown until it ends. */
const isLive = (room: Room) => room.status === 'PLAYING' && !!room.game && !room.game.finished;

/**
 * Whether players get this stands message right now. Between games: all of
 * them. During a game: plain comments that don't look like move advice, and
 * never in tournament rooms. Stickers float over the board instead.
 */
const reachesPlayers = (room: Room, m: ChatMessage) =>
  !isLive(room) || (room.mode !== 'tournament' && !m.sticker && !mayCoach(m.text));

/**
 * The "stands": spectators talking among themselves while they watch.
 *
 * - Comments and stickers go to every spectator. During a game, players get
 *   only comments that don't look like move advice ("h8", "chặn bên trái"),
 *   and none at all in tournament rooms; they can read the whole thread after
 *   the game (see `playerSync`).
 * - Spectators can cheer for a player; everyone sees the fan counts.
 * - Emoji reactions and stickers also float over the board for everyone,
 *   players included ("hype"), capped per room so they can't flood a player.
 * - Nothing here touches the room model, the lock or the clock.
 */
export class StandsHub {
  private rooms = new Map<string, RoomStands>();

  constructor(
    private readonly io: Server,
    private readonly manager: RoomManager,
    private readonly avatars: AvatarStorage,
    private readonly cfg: StandsLimits = DEFAULT_STANDS_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** A spectator takes a seat in the stands. Idempotent per socket (a rejoin updates name/avatar). */
  async join(roomId: string, socketId: string, ip: string, name: string | undefined, avatar: string | undefined) {
    const room = await this.spectatorRoom(roomId, socketId);
    const stands = this.standsOf(roomId);
    const profile = { name: sanitizeName(name), avatar: normalizeAvatar(avatar, this.avatars) };
    let viewer = stands.viewers.get(socketId);
    if (viewer) Object.assign(viewer, profile);
    else {
      viewer = {
        id: `v_${nanoid(8)}`,
        ...profile,
        socketId,
        ip,
        posts: [],
        lastText: '',
        lastTextAt: 0,
        lastReactionAt: -Infinity,
        supports: null,
        lastCheerAt: -Infinity,
      };
      stands.viewers.set(socketId, viewer);
    }
    return { viewer: publicViewer(viewer), messages: stands.history, live: isLive(room), cheers: this.cheerCounts(room, stands), supports: viewer.supports };
  }

  /** Players: fan counts, and the thread once no game is live (live comments arrive as events). */
  async playerSync(roomId: string, playerId: string, socketId: string) {
    const room = await this.manager.getRoom(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    if (!room.players.some((p) => p.id === playerId && p.socketId === socketId)) throw new GameError('NOT_IN_ROOM');
    const live = isLive(room);
    const stands = this.standsOf(roomId);
    return { live, messages: live ? [] : stands.history, cheers: this.cheerCounts(room, stands) };
  }

  async chat(roomId: string, socketId: string, raw: string): Promise<ChatMessage> {
    const { room, viewer, stands } = await this.resolve(roomId, socketId);
    const text = sanitizeChatText(raw);
    if (!text) throw new GameError('INVALID_PAYLOAD', 'Bình luận trống.');
    if (textLength(text) > this.cfg.msgMaxLength) {
      throw new GameError('INVALID_PAYLOAD', `Bình luận tối đa ${this.cfg.msgMaxLength} ký tự.`);
    }
    const now = this.now();
    this.spendPost(stands, viewer, now);
    if (text === viewer.lastText && now - viewer.lastTextAt < this.cfg.duplicateMs) {
      throw new GameError('RATE_LIMITED', 'Đừng gửi lặp lại cùng một bình luận nhé.');
    }
    this.recordPost(stands, viewer, now);
    viewer.lastText = text;
    viewer.lastTextAt = now;
    return this.post(room, stands, { id: nanoid(10), roomId, playerId: viewer.id, name: viewer.name, avatar: viewer.avatar, text, at: now });
  }

  async sticker(roomId: string, socketId: string, sticker: string): Promise<ChatMessage> {
    const { room, viewer, stands } = await this.resolve(roomId, socketId);
    if (!STICKER_SET.has(sticker)) throw new GameError('INVALID_PAYLOAD', 'Sticker không hợp lệ.');
    const now = this.now();
    this.spendPost(stands, viewer, now);
    this.recordPost(stands, viewer, now);
    const message = this.post(room, stands, {
      id: nanoid(10),
      roomId,
      playerId: viewer.id,
      name: viewer.name,
      avatar: viewer.avatar,
      text: '',
      sticker,
      at: now,
    });
    this.hype(room, stands, { id: message.id, roomId, viewerId: viewer.id, name: viewer.name, sticker, supports: viewer.supports, at: now });
    return message;
  }

  async react(roomId: string, socketId: string, emoji: string) {
    const { room, viewer, stands } = await this.resolve(roomId, socketId);
    if (!REACTION_SET.has(emoji)) throw new GameError('INVALID_PAYLOAD', 'Biểu cảm không hợp lệ.');
    const now = this.now();
    if (now - viewer.lastReactionAt < this.cfg.reactionCooldownMs) throw new GameError('RATE_LIMITED', 'Từ từ thôi nào!');
    viewer.lastReactionAt = now;
    const shown = this.hype(room, stands, { id: nanoid(8), roomId, viewerId: viewer.id, name: viewer.name, emoji, supports: viewer.supports, at: now });
    return { shown };
  }

  /** Cheer for a player (or stop, with null). Everyone gets the new fan counts. */
  async cheer(roomId: string, socketId: string, playerId: string | null) {
    const { room, viewer, stands } = await this.resolve(roomId, socketId);
    if (playerId !== null && !room.players.some((p) => p.id === playerId)) throw new GameError('INVALID_PAYLOAD', 'Người chơi không tồn tại.');
    if (viewer.supports === playerId) return { supports: playerId, cheers: this.cheerCounts(room, stands) };
    const now = this.now();
    if (now - viewer.lastCheerAt < this.cfg.cheerCooldownMs) throw new GameError('RATE_LIMITED', 'Đổi phe chậm thôi nào!');
    viewer.lastCheerAt = now;
    viewer.supports = playerId;
    return { supports: playerId, cheers: this.broadcastCheers(room, stands) };
  }

  leave(roomId: string, socketId: string) {
    const stands = this.rooms.get(roomId);
    const viewer = stands?.viewers.get(socketId);
    if (!stands || !viewer) return;
    stands.viewers.delete(socketId);
    if (viewer.supports) {
      void this.manager.getRoom(roomId).then((room) => room && this.broadcastCheers(room, stands));
    }
  }

  /** Drops state for rooms that no longer exist. */
  async prune() {
    for (const id of [...this.rooms.keys()]) if (!(await this.manager.getRoom(id))) this.rooms.delete(id);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async spectatorRoom(roomId: string, socketId: string) {
    const room = await this.manager.getRoom(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    if (!room.spectators.includes(socketId)) throw new GameError('NOT_IN_ROOM', 'Chỉ khán giả mới bình luận được ở khán đài.');
    return room;
  }

  private async resolve(roomId: string, socketId: string) {
    const room = await this.spectatorRoom(roomId, socketId);
    const stands = this.standsOf(roomId);
    const viewer = stands.viewers.get(socketId);
    if (!viewer) throw new GameError('NOT_IN_ROOM', 'Hãy vào khán đài trước.');
    return { room, viewer, stands };
  }

  private spendPost(stands: RoomStands, viewer: Viewer, now: number) {
    prune(viewer.posts, now, this.cfg.viewerWindowMs);
    const last = viewer.posts[viewer.posts.length - 1] ?? -Infinity;
    const ipHits = stands.ipHits.get(viewer.ip) ?? [];
    prune(ipHits, now, this.cfg.ipWindowMs);
    if (
      viewer.posts.length >= this.cfg.viewerBurst ||
      now - last < this.cfg.viewerMinIntervalMs ||
      ipHits.length >= this.cfg.ipBurst
    ) {
      throw new GameError('RATE_LIMITED', 'Bạn bình luận quá nhanh, chờ chút nhé.');
    }
  }

  private recordPost(stands: RoomStands, viewer: Viewer, now: number) {
    viewer.posts.push(now);
    const ipHits = stands.ipHits.get(viewer.ip) ?? [];
    ipHits.push(now);
    stands.ipHits.set(viewer.ip, ipHits);
  }

  private post(room: Room, stands: RoomStands, message: ChatMessage) {
    stands.history.push(message);
    if (stands.history.length > this.cfg.history) stands.history.splice(0, stands.history.length - this.cfg.history);
    const targets = [...room.spectators];
    if (reachesPlayers(room, message)) for (const p of room.players) if (p.online && p.socketId) targets.push(p.socketId);
    if (targets.length) this.io.to(targets).emit('stands:message', message);
    return message;
  }

  /** Best effort: returns false when the room-wide cap dropped it. */
  private hype(room: Room, stands: RoomStands, event: StandsHype) {
    const now = this.now();
    prune(stands.hypeHits, now, 1_000);
    if (stands.hypeHits.length >= this.cfg.roomHypePerSecond) return false;
    stands.hypeHits.push(now);
    this.io.to(channel(room.id)).emit('stands:hype', event);
    return true;
  }

  /** Fans per current player (viewers cheering for someone who left don't count). */
  private cheerCounts(room: Room, stands: RoomStands): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const p of room.players) counts[p.id] = 0;
    for (const v of stands.viewers.values()) if (v.supports && v.supports in counts) counts[v.supports] += 1;
    return counts;
  }

  private broadcastCheers(room: Room, stands: RoomStands) {
    const cheers = this.cheerCounts(room, stands);
    this.io.to(channel(room.id)).emit('stands:cheers', { roomId: room.id, cheers } satisfies StandsCheers);
    return cheers;
  }

  private standsOf(roomId: string) {
    let s = this.rooms.get(roomId);
    if (!s) this.rooms.set(roomId, (s = { viewers: new Map(), history: [], ipHits: new Map(), hypeHits: [] }));
    return s;
  }
}

const publicViewer = (v: Viewer): StandsViewer => ({ id: v.id, name: v.name, avatar: v.avatar });

function prune(hits: number[], now: number, windowMs: number) {
  while (hits.length && now - hits[0] >= windowMs) hits.shift();
}
