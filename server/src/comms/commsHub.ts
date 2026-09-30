import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import type { ChatMessage, CommsSync, ReactionEvent, VoiceIceResponse, VoiceSignal, VoiceSignalEvent, VoiceState, VoiceStateEvent } from '../protocol.js';
import { GameError, type RoomManager } from '../rooms/roomManager.js';
import type { Player, Room } from '../types.js';
import type { IceProvider } from './iceProvider.js';
import { REACTION_SET } from './reactions.js';
import { STICKER_SET } from './stickers.js';
import { sanitizeChatText, textLength } from './text.js';

export interface CommsLimits {
  chatMaxLength: number;
  /** At most `chatBurst` messages per `chatWindowMs`. */
  chatBurst: number;
  chatWindowMs: number;
  chatMinIntervalMs: number;
  /** The same text twice within this window is rejected. */
  chatDuplicateMs: number;
  chatHistory: number;
  reactionCooldownMs: number;
  /** Voice state + signaling budget (ICE candidates arrive in bursts). */
  signalBurst: number;
  signalWindowMs: number;
}

export const DEFAULT_COMMS_LIMITS: CommsLimits = {
  chatMaxLength: 200,
  chatBurst: 5,
  chatWindowMs: 5_000,
  chatMinIntervalMs: 300,
  chatDuplicateMs: 3_000,
  chatHistory: 50,
  // Slightly below the client's 1.5s cooldown so network jitter never trips it.
  reactionCooldownMs: 1_000,
  signalBurst: 120,
  signalWindowMs: 10_000,
};

interface PlayerLimits {
  chatHits: number[];
  lastText: string;
  lastTextAt: number;
  lastReactionAt: number;
  signalHits: number[];
}

interface Context {
  room: Room;
  me: Player;
  opponent: Player | null;
}

const OFF: VoiceState = { enabled: false, muted: false };

/**
 * Chat, reactions and voice signaling between the two players of a room.
 *
 * Deliberately separate from RoomManager: none of this touches game state,
 * the room lock or the room version, so it cannot delay a move or the clock.
 * Every event is checked against the live room (sender must hold a seat on
 * this socket) and delivered only to the opponent's socket, never to the
 * room channel, so spectators receive nothing.
 */
export class CommsHub {
  private history = new Map<string, ChatMessage[]>();
  private voice = new Map<string, Map<string, VoiceState>>();
  private limits = new Map<string, Map<string, PlayerLimits>>();
  private ice: IceProvider | null = null;

  constructor(
    private readonly io: Server,
    private readonly manager: RoomManager,
    private readonly cfg: CommsLimits = DEFAULT_COMMS_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  async sendChat(roomId: string, playerId: string, socketId: string, raw: string): Promise<ChatMessage> {
    const { me, opponent } = await this.resolve(roomId, playerId, socketId);
    const text = sanitizeChatText(raw);
    if (!text) throw new GameError('INVALID_PAYLOAD', 'Tin nhắn trống.');
    if (textLength(text) > this.cfg.chatMaxLength) {
      throw new GameError('INVALID_PAYLOAD', `Tin nhắn tối đa ${this.cfg.chatMaxLength} ký tự.`);
    }
    if (!opponent) throw new GameError('NO_OPPONENT', 'Chưa có đối thủ để trò chuyện.');

    const now = this.now();
    const lim = this.spendChat(roomId, playerId, now);
    if (text === lim.lastText && now - lim.lastTextAt < this.cfg.chatDuplicateMs) {
      throw new GameError('RATE_LIMITED', 'Đừng gửi lặp lại cùng một tin nhắn nhé.');
    }
    lim.chatHits.push(now);
    lim.lastText = text;
    lim.lastTextAt = now;
    return this.post(roomId, opponent, { id: nanoid(10), roomId, playerId, name: me.name, avatar: me.avatar, text, at: now });
  }

  /** A sticker is a chat message whose `text` is empty; it shares the chat rate limit and history. */
  async sendSticker(roomId: string, playerId: string, socketId: string, sticker: string): Promise<ChatMessage> {
    const { me, opponent } = await this.resolve(roomId, playerId, socketId);
    if (!STICKER_SET.has(sticker)) throw new GameError('INVALID_PAYLOAD', 'Sticker không hợp lệ.');
    if (!opponent) throw new GameError('NO_OPPONENT', 'Chưa có đối thủ để trò chuyện.');
    const now = this.now();
    this.spendChat(roomId, playerId, now).chatHits.push(now);
    return this.post(roomId, opponent, { id: nanoid(10), roomId, playerId, name: me.name, avatar: me.avatar, text: '', sticker, at: now });
  }

  private post(roomId: string, opponent: Player, message: ChatMessage) {
    const log = this.history.get(roomId) ?? [];
    log.push(message);
    if (log.length > this.cfg.chatHistory) log.splice(0, log.length - this.cfg.chatHistory);
    this.history.set(roomId, log);

    // An offline opponent picks the message up from history when they reconnect.
    this.toPlayer(opponent, 'chat:message', message);
    return message;
  }

  async sendReaction(roomId: string, playerId: string, socketId: string, emoji: string): Promise<ReactionEvent> {
    const { opponent } = await this.resolve(roomId, playerId, socketId);
    if (!REACTION_SET.has(emoji)) throw new GameError('INVALID_PAYLOAD', 'Biểu cảm không hợp lệ.');
    if (!opponent) throw new GameError('NO_OPPONENT');
    const now = this.now();
    const lim = this.limitsFor(roomId, playerId);
    if (now - lim.lastReactionAt < this.cfg.reactionCooldownMs) throw new GameError('RATE_LIMITED', 'Từ từ thôi nào!');
    lim.lastReactionAt = now;

    const event: ReactionEvent = { id: nanoid(8), roomId, playerId, emoji, at: now };
    this.toPlayer(opponent, 'reaction', event);
    return event;
  }

  async setVoice(roomId: string, playerId: string, socketId: string, state: VoiceState) {
    const { opponent } = await this.resolve(roomId, playerId, socketId);
    this.spendSignal(roomId, playerId);
    const next: VoiceState = { enabled: state.enabled, muted: state.enabled && state.muted };
    this.voiceOf(roomId).set(playerId, next);
    if (opponent) this.toPlayer(opponent, 'voice:state', { roomId, playerId, ...next } satisfies VoiceStateEvent);
    return next;
  }

  /** Relays an offer/answer/ICE candidate, only while both players have voice enabled. */
  async relaySignal(roomId: string, playerId: string, socketId: string, signal: VoiceSignal) {
    const { opponent } = await this.resolve(roomId, playerId, socketId);
    this.spendSignal(roomId, playerId);
    const states = this.voiceOf(roomId);
    if (!opponent?.socketId || !states.get(playerId)?.enabled || !states.get(opponent.id)?.enabled) {
      throw new GameError('NO_OPPONENT', 'Đối thủ chưa bật voice.');
    }
    this.toPlayer(opponent, 'voice:signal', { roomId, from: playerId, signal } satisfies VoiceSignalEvent);
  }

  setIceProvider(provider: IceProvider) {
    this.ice = provider;
  }

  /** TURN servers for a seated player's peer connection (`null`: none configured, use STUN). */
  async iceServers(roomId: string, playerId: string, socketId: string): Promise<VoiceIceResponse> {
    await this.resolve(roomId, playerId, socketId);
    this.spendSignal(roomId, playerId);
    return { iceServers: (await this.ice?.get()) ?? null };
  }

  /** What a (re)joining player needs: chat since this pairing began, and both voice states. */
  async sync(roomId: string, playerId: string, socketId: string): Promise<CommsSync> {
    const { room } = await this.resolve(roomId, playerId, socketId);
    // Messages from before the current opponent sat down belong to a previous pairing.
    const since = Math.max(...room.players.filter((p) => !p.isBot).map((p) => p.joinedAt));
    const messages = (this.history.get(roomId) ?? []).filter((m) => m.at >= since);
    const states = this.voiceOf(roomId);
    const voice: Record<string, VoiceState> = {};
    for (const p of room.players) voice[p.id] = states.get(p.id) ?? OFF;
    return { messages, voice };
  }

  /**
   * The player's socket left the room (disconnect, leave, or a new tab took the
   * seat): their voice is gone, so tell the opponent to drop the call.
   */
  async detach(roomId: string, playerId: string) {
    const states = this.voice.get(roomId);
    const was = states?.get(playerId);
    states?.delete(playerId);
    if (!was?.enabled) return;
    const room = await this.manager.getRoom(roomId);
    const opponent = room?.players.find((p) => p.id !== playerId && !p.isBot);
    if (opponent) this.toPlayer(opponent, 'voice:state', { roomId, playerId, ...OFF } satisfies VoiceStateEvent);
  }

  /** Drops state for rooms that no longer exist. */
  async prune() {
    const ids = new Set([...this.history.keys(), ...this.voice.keys(), ...this.limits.keys()]);
    for (const id of ids) {
      if (await this.manager.getRoom(id)) continue;
      this.history.delete(id);
      this.voice.delete(id);
      this.limits.delete(id);
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async resolve(roomId: string, playerId: string, socketId: string): Promise<Context> {
    const room = await this.manager.getRoom(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    const me = room.players.find((p) => p.id === playerId);
    // The seat must be bound to *this* socket: a replaced tab can't keep talking.
    if (!me || me.socketId !== socketId) throw new GameError('NOT_IN_ROOM');
    // A bot seat has no socket and nobody to talk to.
    return { room, me, opponent: room.players.find((p) => p.id !== playerId && !p.isBot) ?? null };
  }

  private toPlayer(player: Player, event: string, payload: object) {
    if (player.online && player.socketId) this.io.to(player.socketId).emit(event, payload);
  }

  /** Checks the shared chat budget (texts + stickers); the caller records the hit. */
  private spendChat(roomId: string, playerId: string, now: number) {
    const lim = this.limitsFor(roomId, playerId);
    prune(lim.chatHits, now, this.cfg.chatWindowMs);
    const last = lim.chatHits[lim.chatHits.length - 1] ?? -Infinity;
    if (lim.chatHits.length >= this.cfg.chatBurst || now - last < this.cfg.chatMinIntervalMs) {
      throw new GameError('RATE_LIMITED', 'Bạn gửi tin nhắn quá nhanh, chờ chút nhé.');
    }
    return lim;
  }

  private spendSignal(roomId: string, playerId: string) {
    const lim = this.limitsFor(roomId, playerId);
    const now = this.now();
    prune(lim.signalHits, now, this.cfg.signalWindowMs);
    if (lim.signalHits.length >= this.cfg.signalBurst) throw new GameError('RATE_LIMITED');
    lim.signalHits.push(now);
  }

  private voiceOf(roomId: string) {
    let m = this.voice.get(roomId);
    if (!m) this.voice.set(roomId, (m = new Map()));
    return m;
  }

  private limitsFor(roomId: string, playerId: string): PlayerLimits {
    let room = this.limits.get(roomId);
    if (!room) this.limits.set(roomId, (room = new Map()));
    let lim = room.get(playerId);
    if (!lim) {
      lim = { chatHits: [], lastText: '', lastTextAt: 0, lastReactionAt: -Infinity, signalHits: [] };
      room.set(playerId, lim);
    }
    return lim;
  }
}

function prune(hits: number[], now: number, windowMs: number) {
  while (hits.length && now - hits[0] >= windowMs) hits.shift();
}
