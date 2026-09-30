import type { AppConfig } from '../config.js';
import type { PublicGame, PublicPlayer, RoomSnapshot, TimerPayload } from '../protocol.js';
import { publicTitleOf } from '../titles/titles.js';
import type { GameState, Player, Room } from '../types.js';

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    mark: p.mark,
    wins: p.wins,
    online: p.online,
    forfeitAt: p.forfeitAt,
    isBot: p.isBot,
    registered: !!p.userId,
    title: p.userId ? publicTitleOf(p.titleId) : null,
    nameStyle: p.nameStyle,
    avatarFrame: p.avatarFrame,
  };
}

function toPublicGame(g: GameState): PublicGame {
  const last = g.moves[g.moves.length - 1];
  return {
    board: g.board.map((c) => c ?? '.').join(''),
    moveCount: g.moves.length,
    lastMove: last ? { index: last.index, mark: last.mark } : null,
    currentTurn: g.currentTurn,
    startAt: g.startAt,
    turnStartedAt: g.turnStartedAt,
    deadline: g.deadline,
    pausedRemainingMs: g.pausedRemainingMs,
    finished: g.finished,
    winner: g.winner,
    loser: g.loser,
    reason: g.reason,
    winLine: g.winLine,
    finishedAt: g.finishedAt,
  };
}

export function toSnapshot(room: Room, cfg: AppConfig, now = Date.now()): RoomSnapshot {
  return {
    id: room.id,
    mode: room.mode,
    bot: room.bot ? { ...room.bot } : null,
    version: room.version,
    status: room.status,
    round: room.round,
    players: room.players.map(toPublicPlayer),
    game: room.game ? toPublicGame(room.game) : null,
    rematchVotes: [...room.rematchVotes],
    readyVotes: [...room.readyVotes],
    spectatorCount: room.spectators.length,
    serverNow: now,
    config: {
      boardSize: room.boardSize,
      winLength: cfg.winLength,
      turnMs: room.turnMs,
      startCountdownMs: cfg.startCountdownMs,
      disconnectForfeitMs: cfg.disconnectForfeitMs,
    },
    tournament: room.tournament ? { ...room.tournament } : null,
  };
}

export function toTimerPayload(room: Room, now = Date.now()): TimerPayload | null {
  const g = room.game;
  if (!g || g.finished) return null;
  return {
    roomId: room.id,
    round: room.round,
    currentTurn: g.currentTurn,
    deadline: g.deadline,
    pausedRemainingMs: g.pausedRemainingMs,
    remainingMs: g.pausedRemainingMs ?? Math.max(0, g.deadline - Math.max(now, g.startAt)),
    serverNow: now,
  };
}
