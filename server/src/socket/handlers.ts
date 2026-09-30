import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import type { AuthService } from '../accounts/authService.js';
import { normalizeAvatar, type AvatarStorage } from '../avatars/avatars.js';
import { registerCommsHandlers } from '../comms/commsHandlers.js';
import type { CommsHub } from '../comms/commsHub.js';
import { registerStandsHandlers } from '../comms/standsHandlers.js';
import type { StandsHub } from '../comms/standsHub.js';
import type { AppConfig } from '../config.js';
import type { AckFailure, ErrorCode } from '../protocol.js';
import { ERROR_MESSAGES, GameError, type RoomManager } from '../rooms/roomManager.js';
import { toSnapshot } from '../rooms/serialize.js';
import type { BoardSize, RoomSettings, TurnSeconds } from '../types.js';
import { channel, userChannel } from './socketSink.js';
import { createRateLimiter, schemas } from './validation.js';

interface SessionData {
  roomId?: string;
  playerId?: string;
  role?: 'player' | 'spectator';
  /** Account this socket is signed in as (handshake `auth.token`, then `auth:identify`). Unset = guest. */
  userId?: string | null;
}

/** Unset fields fall back to the server defaults. */
const roomSettings = (boardSize?: BoardSize, turnSeconds?: TurnSeconds): Partial<RoomSettings> => ({
  boardSize,
  turnMs: turnSeconds && turnSeconds * 1000,
});

const fail = (code: ErrorCode, message = ERROR_MESSAGES[code]): AckFailure => ({ ok: false, error: code, message });

/**
 * Thin transport layer: validate input, resolve which seat this socket owns,
 * delegate to RoomManager, reply via ack. No game rules live here.
 */
export function registerSocketHandlers(
  io: Server,
  manager: RoomManager,
  cfg: AppConfig,
  comms: CommsHub,
  avatars: AvatarStorage,
  stands?: StandsHub,
  auth?: AuthService,
  /** Told when a socket signs in or out mid-session (tournaments re-dress the participant it acts as). */
  onIdentityChange?: (socketId: string, userId: string | null) => void,
) {
  io.on('connection', (socket: Socket) => {
    const allow = createRateLimiter(25, 1000);
    // Every avatar change is a room:state broadcast to players and spectators.
    const allowAvatar = createRateLimiter(3, 3000);
    const session = socket.data as SessionData;
    /** Unknown or foreign avatars are dropped (null): the client then shows a default. */
    const avatarOf = (raw: string | undefined) => normalizeAvatar(raw, avatars);
    /** Guests (no token, or a stale one) play exactly as before. */
    const identify = (token: unknown) => {
      try {
        return auth?.identify(token)?.userId ?? null;
      } catch (err) {
        console.error('[socket] identify failed', err);
        return null;
      }
    };
    /** Keeps the socket in its account's channel (achievement pushes) as it signs in and out. */
    const setIdentity = (userId: string | null) => {
      if (session.userId && session.userId !== userId) socket.leave(userChannel(session.userId));
      if (userId) socket.join(userChannel(userId));
      session.userId = userId;
    };
    setIdentity(identify((socket.handshake.auth as { token?: unknown } | undefined)?.token));
    const me = () => session.userId ?? null;

    function handle<S extends z.ZodType>(
      event: string,
      schema: S,
      fn: (input: z.output<S>) => Promise<object | void>,
    ) {
      socket.on(event, async (raw: unknown, ack?: unknown) => {
        if (typeof raw === 'function' && ack === undefined) {
          ack = raw;
          raw = {};
        }
        const reply = typeof ack === 'function' ? (ack as (res: unknown) => void) : () => {};
        if (!allow()) return reply(fail('RATE_LIMITED'));
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) return reply(fail('INVALID_PAYLOAD'));
        try {
          const result = await fn(parsed.data);
          reply({ ok: true, ...(result ?? {}) });
        } catch (err) {
          if (err instanceof GameError) return reply(fail(err.code, err.message));
          console.error(`[socket] ${event} failed`, err);
          reply(fail('INTERNAL'));
        }
      });
    }

    const snapshot = async (roomId: string) => {
      const room = await manager.getRoom(roomId);
      if (!room) throw new GameError('ROOM_NOT_FOUND');
      return toSnapshot(room, cfg);
    };

    const requirePlayer = (roomId: string) => {
      if (session.roomId !== roomId || session.role !== 'player' || !session.playerId) {
        throw new GameError('NOT_IN_ROOM');
      }
      return session.playerId;
    };

    const bind = (roomId: string, role: 'player' | 'spectator', playerId?: string) => {
      socket.join(channel(roomId));
      session.roomId = roomId;
      session.role = role;
      session.playerId = playerId;
    };

    /** Detaches the socket from its current room, as if it had disconnected from it. */
    const unbind = async () => {
      const { roomId, role, playerId } = session;
      if (!roomId) return;
      socket.leave(channel(roomId));
      delete session.roomId;
      delete session.role;
      delete session.playerId;
      try {
        if (role === 'player' && playerId) {
          await manager.handleDisconnect(roomId, playerId, socket.id);
          await comms.detach(roomId, playerId);
        } else if (role === 'spectator') {
          stands?.leave(roomId, socket.id);
          await manager.removeSpectator(roomId, socket.id);
        }
      } catch (err) {
        if (!(err instanceof GameError)) console.error('[socket] unbind failed', err);
      }
    };

    handle('time:sync', schemas.timeSync, async ({ t0 }) => ({ t0, serverNow: Date.now() }));

    handle('room:create', schemas.create, async ({ name, boardSize, turnSeconds, avatar }) => {
      await unbind();
      const { room, player } = await manager.createRoom(name, socket.id, roomSettings(boardSize, turnSeconds), avatarOf(avatar), me());
      bind(room.id, 'player', player.id);
      return { roomId: room.id, playerId: player.id, token: player.token, state: toSnapshot(room, cfg) };
    });

    handle('room:createBot', schemas.createBot, async ({ name, boardSize, turnSeconds, avatar, difficulty, firstMove }) => {
      await unbind();
      const { room, player } = await manager.createBotRoom(
        name,
        socket.id,
        { difficulty, firstMove },
        roomSettings(boardSize, turnSeconds),
        avatarOf(avatar),
        me(),
      );
      bind(room.id, 'player', player.id);
      return { roomId: room.id, playerId: player.id, token: player.token, state: toSnapshot(room, cfg) };
    });

    handle('room:join', schemas.join, async ({ roomId, name, avatar }) => {
      // Idempotent: a duplicate join from the same socket returns its existing seat.
      if (session.roomId === roomId) {
        const room = await manager.getRoom(roomId);
        const seat = room?.players.find((p) => p.id === session.playerId && p.socketId === socket.id);
        if (room && seat) {
          return { role: 'player', playerId: seat.id, token: seat.token, state: toSnapshot(room, cfg) };
        }
        if (room && session.role === 'spectator') return { role: 'spectator', state: toSnapshot(room, cfg) };
      }
      if (session.roomId) await unbind();

      const result = await manager.joinRoom(roomId, name, socket.id, avatarOf(avatar), me());
      if (result.role === 'player') {
        bind(roomId, 'player', result.player.id);
        return {
          role: 'player',
          playerId: result.player.id,
          token: result.player.token,
          state: await snapshot(roomId),
        };
      }
      bind(roomId, 'spectator');
      return { role: 'spectator', state: await snapshot(roomId) };
    });

    handle('player:reconnect', schemas.reconnect, async ({ roomId, token, takeover, avatar }) => {
      if (session.roomId && session.roomId !== roomId) await unbind();
      const { player, replacedSocketId } = await manager.reconnect(roomId, token, socket.id, takeover, avatarOf(avatar), me());

      if (replacedSocketId) {
        const old = io.sockets.sockets.get(replacedSocketId);
        if (old) {
          old.leave(channel(roomId));
          // Mutate (not replace): the old socket's handlers hold a reference to this object.
          const oldSession = old.data as SessionData;
          delete oldSession.roomId;
          delete oldSession.role;
          delete oldSession.playerId;
          old.emit('session:replaced', { roomId });
        }
      }
      // A reconnecting client always starts with voice off (reload, new tab or dropped socket).
      await comms.detach(roomId, player.id);
      bind(roomId, 'player', player.id);
      return { role: 'player', playerId: player.id, token: player.token, state: await snapshot(roomId) };
    });

    /**
     * Signs this socket in or out without reconnecting, so logging in mid-game
     * keeps the seat, the board and the clock. The current seat follows: the
     * game in progress is recorded for the new account.
     */
    handle('auth:identify', schemas.identify, async ({ token }) => {
      const userId = token ? identify(token) : null;
      if (token && !userId) throw new GameError('AUTH_INVALID');
      const changed = (session.userId ?? null) !== userId;
      setIdentity(userId);
      if (changed) onIdentityChange?.(socket.id, userId);
      const { roomId, role, playerId } = session;
      if (roomId && role === 'player' && playerId) await manager.setAccount(roomId, playerId, userId).catch(() => {});
      return { signedIn: !!userId };
    });

    handle('game:move', schemas.move, async ({ roomId, index, seq }) => {
      const playerId = requirePlayer(roomId);
      const move = await manager.move(roomId, playerId, index, seq);
      return { seq: move?.seq };
    });

    handle('game:resign', schemas.roomOnly, async ({ roomId }) => {
      await manager.resign(roomId, requirePlayer(roomId));
    });

    handle('room:ready', schemas.ready, async ({ roomId, ready }) => {
      return manager.setReady(roomId, requirePlayer(roomId), ready);
    });

    handle('game:rematch', schemas.rematch, async ({ roomId, accept }) => {
      return manager.rematch(roomId, requirePlayer(roomId), accept);
    });

    handle('player:rename', schemas.rename, async ({ roomId, name }) => {
      return { name: await manager.rename(roomId, requirePlayer(roomId), name) };
    });

    handle('player:avatar', schemas.avatar, async ({ roomId, avatar }) => {
      const playerId = requirePlayer(roomId);
      if (!allowAvatar()) throw new GameError('RATE_LIMITED', 'Bạn đổi avatar nhanh quá, chờ chút nhé.');
      const value = avatarOf(avatar);
      if (!value) throw new GameError('INVALID_PAYLOAD', 'Avatar không hợp lệ.');
      return { avatar: await manager.setAvatar(roomId, playerId, value) };
    });

    handle('room:leave', schemas.roomOnly, async ({ roomId }) => {
      if (session.roomId !== roomId) return;
      const { role, playerId } = session;
      socket.leave(channel(roomId));
      delete session.roomId;
      delete session.role;
      delete session.playerId;
      if (role === 'player' && playerId) {
        await manager.leave(roomId, playerId);
        await comms.detach(roomId, playerId);
      } else {
        stands?.leave(roomId, socket.id);
        await manager.removeSpectator(roomId, socket.id);
      }
    });

    registerCommsHandlers(socket, comms, requirePlayer);
    if (stands) {
      registerStandsHandlers(socket, stands, (roomId) =>
        session.roomId === roomId && session.role ? { role: session.role, playerId: session.playerId } : null,
      );
    }

    socket.on('disconnect', () => {
      void unbind();
    });
  });
}
