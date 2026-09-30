import type { Server } from 'socket.io';
import type { AppConfig } from '../config.js';
import type { PublicMatch, PublicParticipant, TournamentSnapshot } from '../protocol.js';
import { publicTitleOf } from '../titles/titles.js';
import { minPlayersFor, type Match, type Participant, type Tournament, type TournamentEventSink } from './tournamentManager.js';

export const tournamentChannel = (tournamentId: string) => `tournament:${tournamentId}`;

function toPublicParticipant(t: Tournament, p: Participant): PublicParticipant {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    seed: p.seed,
    online: p.sockets.size > 0,
    isHost: t.hostId === p.id,
    eliminated: p.eliminated,
    left: p.left,
    nameStyle: p.nameStyle,
    avatarFrame: p.avatarFrame,
    title: p.userId ? publicTitleOf(p.titleId) : null,
  };
}

function toPublicMatch(m: Match): PublicMatch {
  return {
    id: m.id,
    round: m.round,
    index: m.index,
    playerA: m.playerA,
    playerB: m.playerB,
    status: m.status,
    ready: [...m.ready],
    readyDeadline: m.readyDeadline,
    roomId: m.roomId,
    winnerId: m.winnerId,
    reason: m.reason,
    games: m.games,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    nextGameAt: m.nextGameAt,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
  };
}

/** Public view of a tournament. Never includes participant tokens. */
export function toTournamentSnapshot(t: Tournament, cfg: AppConfig, now = Date.now()): TournamentSnapshot {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    status: t.status,
    size: t.size,
    minPlayers: minPlayersFor(t.size),
    hostId: t.hostId,
    participants: t.participants.map((p) => toPublicParticipant(t, p)),
    rounds: t.rounds.map((round) => round.map(toPublicMatch)),
    championId: t.championId,
    spectatorCount: t.spectators.size,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    serverNow: now,
    config: { boardSize: t.boardSize, turnMs: t.turnMs, readyCheckMs: cfg.tournament.readyCheckMs, bestOf: t.bestOf },
  };
}

export function createTournamentSink(getIo: () => Server, cfg: AppConfig): TournamentEventSink {
  return {
    state(t) {
      getIo().to(tournamentChannel(t.id)).emit('tournament:state', toTournamentSnapshot(t, cfg));
    },
    closed(tournamentId) {
      getIo().to(tournamentChannel(tournamentId)).emit('tournament:closed', { tournamentId });
    },
  };
}
