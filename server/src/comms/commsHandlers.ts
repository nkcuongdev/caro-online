import type { Socket } from 'socket.io';
import type { z } from 'zod';
import type { AckFailure, ErrorCode } from '../protocol.js';
import { ERROR_MESSAGES, GameError } from '../rooms/roomManager.js';
import { createRateLimiter, schemas } from '../socket/validation.js';
import type { CommsHub } from './commsHub.js';

const fail = (code: ErrorCode, message = ERROR_MESSAGES[code]): AckFailure => ({ ok: false, error: code, message });

/**
 * Chat / reaction / voice-signaling events for one socket. `requirePlayer`
 * resolves the seat this socket holds in `roomId` (throws NOT_IN_ROOM).
 *
 * Uses its own flood limiter rather than the game one, so a burst of ICE
 * candidates or chat can never make a move come back RATE_LIMITED.
 */
export function registerCommsHandlers(socket: Socket, hub: CommsHub, requirePlayer: (roomId: string) => string) {
  const allow = createRateLimiter(40, 1000);

  function on<S extends z.ZodType>(event: string, schema: S, fn: (input: z.output<S>, playerId: string) => Promise<object | void>) {
    socket.on(event, async (raw: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (res: unknown) => void) : () => {};
      if (!allow()) return reply(fail('RATE_LIMITED'));
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) return reply(fail('INVALID_PAYLOAD'));
      try {
        const input = parsed.data as z.output<S> & { roomId: string };
        const result = await fn(input, requirePlayer(input.roomId));
        reply({ ok: true, ...(result ?? {}) });
      } catch (err) {
        if (err instanceof GameError) return reply(fail(err.code, err.message));
        console.error(`[comms] ${event} failed`, err);
        reply(fail('INTERNAL'));
      }
    });
  }

  on('comms:sync', schemas.roomOnly, ({ roomId }, playerId) => hub.sync(roomId, playerId, socket.id));

  on('chat:send', schemas.chat, async ({ roomId, text }, playerId) => ({
    message: await hub.sendChat(roomId, playerId, socket.id, text),
  }));

  on('chat:sticker', schemas.sticker, async ({ roomId, sticker }, playerId) => ({
    message: await hub.sendSticker(roomId, playerId, socket.id, sticker),
  }));

  on('reaction:send', schemas.reaction, async ({ roomId, emoji }, playerId) => ({
    reaction: await hub.sendReaction(roomId, playerId, socket.id, emoji),
  }));

  on('voice:state', schemas.voiceState, async ({ roomId, enabled, muted }, playerId) => ({
    state: await hub.setVoice(roomId, playerId, socket.id, { enabled, muted }),
  }));

  on('voice:ice', schemas.roomOnly, ({ roomId }, playerId) => hub.iceServers(roomId, playerId, socket.id));

  on('voice:signal', schemas.voiceSignal, async ({ roomId, signal }, playerId) => {
    await hub.relaySignal(roomId, playerId, socket.id, signal);
  });
}
