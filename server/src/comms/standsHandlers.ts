import type { Socket } from 'socket.io';
import type { z } from 'zod';
import type { AckFailure, ErrorCode } from '../protocol.js';
import { ERROR_MESSAGES, GameError } from '../rooms/roomManager.js';
import { createRateLimiter, schemas } from '../socket/validation.js';
import type { StandsHub } from './standsHub.js';

const fail = (code: ErrorCode, message = ERROR_MESSAGES[code]): AckFailure => ({ ok: false, error: code, message });

export type SeatLookup = (roomId: string) => { role: 'player' | 'spectator'; playerId?: string } | null;

/** Client address, honouring one proxy hop (Railway / Render put the client first in X-Forwarded-For). */
function clientIp(socket: Socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || socket.handshake.address || 'unknown';
}

/** Stands (spectator) events for one socket, with their own flood limiter. */
export function registerStandsHandlers(socket: Socket, stands: StandsHub, seatIn: SeatLookup) {
  const allow = createRateLimiter(20, 1000);
  const ip = clientIp(socket);

  function on<S extends z.ZodType>(event: string, schema: S, fn: (input: z.output<S>) => Promise<object | void>) {
    socket.on(event, async (raw: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (res: unknown) => void) : () => {};
      if (!allow()) return reply(fail('RATE_LIMITED'));
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) return reply(fail('INVALID_PAYLOAD'));
      try {
        reply({ ok: true, ...((await fn(parsed.data)) ?? {}) });
      } catch (err) {
        if (err instanceof GameError) return reply(fail(err.code, err.message));
        console.error(`[stands] ${event} failed`, err);
        reply(fail('INTERNAL'));
      }
    });
  }

  const requireSpectator = (roomId: string) => {
    if (seatIn(roomId)?.role !== 'spectator') throw new GameError('NOT_IN_ROOM', 'Chỉ khán giả mới bình luận được ở khán đài.');
  };

  on('stands:join', schemas.standsJoin, async ({ roomId, name, avatar }) => {
    requireSpectator(roomId);
    return stands.join(roomId, socket.id, ip, name, avatar);
  });

  /** Players: fan counts, plus the full thread once the game is over. */
  on('stands:sync', schemas.roomOnly, async ({ roomId }) => {
    const seat = seatIn(roomId);
    if (seat?.role !== 'player' || !seat.playerId) throw new GameError('NOT_IN_ROOM');
    return stands.playerSync(roomId, seat.playerId, socket.id);
  });

  on('stands:chat', schemas.chat, async ({ roomId, text }) => {
    requireSpectator(roomId);
    return { message: await stands.chat(roomId, socket.id, text) };
  });

  on('stands:sticker', schemas.sticker, async ({ roomId, sticker }) => {
    requireSpectator(roomId);
    return { message: await stands.sticker(roomId, socket.id, sticker) };
  });

  on('stands:cheer', schemas.standsCheer, async ({ roomId, playerId }) => {
    requireSpectator(roomId);
    return stands.cheer(roomId, socket.id, playerId);
  });

  on('stands:react', schemas.reaction, async ({ roomId, emoji }) => {
    requireSpectator(roomId);
    return stands.react(roomId, socket.id, emoji);
  });
}
