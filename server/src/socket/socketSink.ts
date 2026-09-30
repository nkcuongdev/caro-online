import type { Server } from 'socket.io';
import type { AppConfig } from '../config.js';
import { toPublicPlayer, toSnapshot, toTimerPayload } from '../rooms/serialize.js';
import type { RoomEventSink } from '../rooms/roomManager.js';

export const channel = (roomId: string) => `room:${roomId}`;
/** Every socket signed in as this account (all its tabs and devices). Used for per-account pushes. */
export const userChannel = (userId: string) => `user:${userId}`;

/** Maps domain events from RoomManager onto Socket.IO broadcasts. */
export function createSocketSink(getIo: () => Server, cfg: AppConfig): RoomEventSink {
  const to = (roomId: string) => getIo().to(channel(roomId));

  return {
    state(room) {
      to(room.id).emit('room:state', toSnapshot(room, cfg));
    },
    playerJoined(room, player) {
      to(room.id).emit('player:joined', { roomId: room.id, player: toPublicPlayer(player) });
    },
    gameStarted(room) {
      const g = room.game!;
      to(room.id).emit('game:started', {
        roomId: room.id,
        round: room.round,
        startAt: g.startAt,
        deadline: g.deadline,
        currentTurn: g.currentTurn,
        serverNow: Date.now(),
      });
    },
    move(room, move, player) {
      to(room.id).emit('game:move', {
        roomId: room.id,
        round: room.round,
        index: move.index,
        mark: move.mark,
        seq: move.seq,
        playerId: player.id,
      });
    },
    turn(room) {
      const g = room.game!;
      to(room.id).emit('game:turn', {
        roomId: room.id,
        round: room.round,
        currentTurn: g.currentTurn,
        turnStartedAt: g.turnStartedAt,
        deadline: g.deadline,
        serverNow: Date.now(),
      });
    },
    timer(room) {
      const payload = toTimerPayload(room);
      if (payload) to(room.id).emit('game:timer', payload);
    },
    finished(room, result) {
      to(room.id).emit('game:finished', result);
    },
    playerDisconnected(room, player) {
      to(room.id).emit('player:disconnected', {
        roomId: room.id,
        playerId: player.id,
        forfeitAt: player.forfeitAt,
      });
    },
    playerReconnected(room, player) {
      to(room.id).emit('player:reconnected', { roomId: room.id, playerId: player.id });
    },
    closed(roomId) {
      to(roomId).emit('room:closed', { roomId });
    },
  };
}
