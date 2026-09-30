import { customAlphabet, nanoid } from 'nanoid';
import type { AppConfig } from '../config.js';
import { DEFAULT_AVATAR_FRAME, resolveAvatarFrameId } from '../cosmetics/avatarFrames.js';
import { DEFAULT_NAME_STYLE, resolveNameStyleId } from '../cosmetics/nameStyles.js';
import type { TournamentMatchStatus, TournamentStatus, TournamentWinReason } from '../protocol.js';
import { GameError, ROOM_ID_ALPHABET, type FinishedResult, type RoomManager } from '../rooms/roomManager.js';
import { sanitizeName } from '../rooms/names.js';
import { isTitleId } from '../titles/titles.js';
import type { TimerManager } from '../timer/timerManager.js';
import type { BoardSize, Room } from '../types.js';

/**
 * Single-elimination tournaments.
 *
 * The bracket is server state only: clients send intents (join, start, ready)
 * and render snapshots. Each match is played in an ordinary game room created
 * through RoomManager; the room's `finished` result is the only thing that can
 * move a player forward, so a client can never report its own win.
 */

export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];

/** Games per match. BO3/BO5 are played as a series in the same room, sides swapping every game. */
export const BEST_OF = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OF)[number];

/** Game wins needed to take a best-of-`n` match. */
export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;

const makeTournamentId = customAlphabet(ROOM_ID_ALPHABET, 6);

/** Only the public-safe fields, with the cosmetics checked against their catalogues. Guests wear the defaults. */
const accountOf = (a: ParticipantAccount): ParticipantAccount => ({
  userId: a.userId,
  nameStyle: a.userId ? resolveNameStyleId(a.nameStyle) : DEFAULT_NAME_STYLE,
  avatarFrame: a.userId ? resolveAvatarFrameId(a.avatarFrame) : DEFAULT_AVATAR_FRAME,
  titleId: a.userId ? resolveTitleId(a.titleId) : null,
});
const resolveTitleId = (id: string | null) => (isTitleId(id) ? id : null);
const sameAccount = (p: ParticipantAccount, a: ParticipantAccount) =>
  p.userId === a.userId && p.nameStyle === a.nameStyle && p.avatarFrame === a.avatarFrame && p.titleId === a.titleId;

export interface Participant {
  id: string;
  /** Secret: reclaims this spot in the tournament and the seat in each of its match rooms. */
  token: string;
  name: string;
  avatar: string | null;
  seed: number | null;
  /** Sockets currently watching the tournament as this participant. Online = at least one. */
  sockets: Set<string>;
  joinedAt: number;
  eliminated: boolean;
  left: boolean;
  /** Account of the socket that last acted as this participant (null = guest). Server-only. */
  userId: string | null;
  /** That account's equipped name style (`default` for guests). Cosmetic, public. */
  nameStyle: string;
  /** That account's equipped avatar frame (`frame_default` for guests). Cosmetic, public. */
  avatarFrame: string;
  /** That account's equipped title (null for guests and accounts without one). Cosmetic, public. */
  titleId: string | null;
}

/** Who a socket is signed in as, with the cosmetics its seat shows. */
export interface ParticipantAccount {
  userId: string | null;
  nameStyle: string;
  avatarFrame: string;
  titleId: string | null;
}

const GUEST: ParticipantAccount = { userId: null, nameStyle: DEFAULT_NAME_STYLE, avatarFrame: DEFAULT_AVATAR_FRAME, titleId: null };

export interface Match {
  id: string;
  round: number;
  index: number;
  playerA: string | null;
  playerB: string | null;
  status: TournamentMatchStatus;
  ready: string[];
  readyDeadline: number | null;
  roomId: string | null;
  winnerId: string | null;
  reason: TournamentWinReason | null;
  games: number;
  scoreA: number;
  scoreB: number;
  nextGameAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Tournament {
  id: string;
  name: string;
  size: TournamentSize;
  bestOf: BestOf;
  boardSize: BoardSize;
  turnMs: number;
  status: TournamentStatus;
  hostId: string | null;
  participants: Participant[];
  rounds: Match[][];
  championId: string | null;
  spectators: Set<string>;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TournamentEventSink {
  state(t: Tournament): void;
  closed(tournamentId: string): void;
}

export interface CreateTournamentInput {
  name?: string;
  playerName?: string;
  avatar: string | null;
  size: TournamentSize;
  bestOf: BestOf;
  boardSize: BoardSize;
  turnMs: number;
  socketId: string;
  account?: ParticipantAccount;
}

/** Players needed to start: more than half the bracket, so a bye never meets another bye. */
export const minPlayersFor = (size: number) => size / 2 + 1;

export const totalRounds = (size: number) => Math.log2(size);

/**
 * Standard bracket order for seeds 1..size: 1 and 2 can only meet in the
 * final, and the top seeds get the byes when the bracket isn't full.
 * 8 → [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((s) => [s, sum - s]);
  }
  return order;
}

export function sanitizeTournamentName(raw: string | undefined | null): string {
  const cleaned = (raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  return cleaned || 'Giải đấu Caro';
}

class Tx {
  changed = true;
  deleted = false;
  readonly events: Array<() => void> = [];
  emit(fn: () => void) {
    this.events.push(fn);
  }
}

export class TournamentManager {
  private tournaments = new Map<string, Tournament>();
  /** Match room → the bracket slot it plays. */
  private roomIndex = new Map<string, { tournamentId: string; matchId: string }>();
  private locks = new Map<string, Promise<void>>();

  constructor(
    private readonly rooms: RoomManager,
    private readonly timers: TimerManager,
    private readonly sink: TournamentEventSink,
    private readonly cfg: AppConfig,
    private readonly now: () => number = Date.now,
  ) {
    rooms.onRoomFinished((room, result) => this.onRoomFinished(room, result));
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async create(input: CreateTournamentInput) {
    let id = makeTournamentId();
    // Codes share the lobby's "enter a code" box with room codes, so keep them distinct.
    while (this.tournaments.has(id) || (await this.rooms.getRoom(id))) id = makeTournamentId();
    const now = this.now();
    const host = this.newParticipant(input.playerName, input.avatar, input.socketId, now, input.account);
    const t: Tournament = {
      id,
      name: sanitizeTournamentName(input.name),
      size: input.size,
      bestOf: input.bestOf,
      boardSize: input.boardSize,
      turnMs: input.turnMs,
      status: 'LOBBY',
      hostId: host.id,
      participants: [host],
      rounds: [],
      championId: null,
      spectators: new Set(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.tournaments.set(id, t);
    return { tournament: t, participant: host };
  }

  /**
   * Starts watching a tournament. With a valid token the socket acts as that
   * participant (taking over from another tab only with `takeover`, or when
   * the participant is offline); otherwise it watches as a spectator.
   */
  enter(tournamentId: string, token: string | undefined, takeover: boolean, socketId: string, account: ParticipantAccount = GUEST) {
    return this.withTournament(tournamentId, (t) => {
      const p = token ? t.participants.find((x) => x.token === token) : undefined;
      if (token && !p) throw new GameError('INVALID_SESSION');
      if (p) {
        const elsewhere = [...p.sockets].some((s) => s !== socketId);
        if (elsewhere && !takeover) throw new GameError('SESSION_ACTIVE');
        p.sockets.add(socketId);
        // The latest socket to act as the participant decides their look (like a room seat on reconnect).
        Object.assign(p, accountOf(account));
        t.spectators.delete(socketId);
        return { tournament: t, participant: p as Participant | null };
      }
      t.spectators.add(socketId);
      return { tournament: t, participant: null as Participant | null };
    });
  }

  join(tournamentId: string, name: string | undefined, avatar: string | null, socketId: string, account: ParticipantAccount = GUEST) {
    return this.withTournament(tournamentId, (t) => {
      const existing = t.participants.find((p) => p.sockets.has(socketId));
      if (existing) return { tournament: t, participant: existing };
      if (t.status !== 'LOBBY') throw new GameError('TOURNAMENT_STARTED');
      if (t.participants.length >= t.size) throw new GameError('TOURNAMENT_FULL');
      const p = this.newParticipant(name, avatar, socketId, this.now(), account);
      t.participants.push(p);
      t.spectators.delete(socketId);
      return { tournament: t, participant: p };
    });
  }

  /**
   * An account equipped another name style: its participant spots show it at
   * once. Cosmetic, so allowed at any stage (the bracket and lobby update live).
   */
  async refreshNameStyle(userId: string, nameStyle: string) {
    await this.refreshCosmetic(userId, 'nameStyle', resolveNameStyleId(nameStyle));
  }

  /** Same as `refreshNameStyle`, for the account's avatar frame. */
  async refreshAvatarFrame(userId: string, avatarFrame: string) {
    await this.refreshCosmetic(userId, 'avatarFrame', resolveAvatarFrameId(avatarFrame));
  }

  /** Same as `refreshNameStyle`, for the account's title (null = took it off). */
  async refreshTitle(userId: string, titleId: string | null) {
    await this.refreshCosmetic(userId, 'titleId', resolveTitleId(titleId));
  }

  private async refreshCosmetic<K extends 'nameStyle' | 'avatarFrame' | 'titleId'>(userId: string, key: K, value: Participant[K]) {
    const stale = (p: Participant) => p.userId === userId && p[key] !== value;
    for (const t of [...this.tournaments.values()]) {
      if (!t.participants.some(stale)) continue;
      await this.withTournament(t.id, (fresh, tx) => {
        const mine = fresh.participants.filter(stale);
        tx.changed = mine.length > 0;
        for (const p of mine) p[key] = value;
      }).catch(() => {});
    }
  }

  /** A socket signed in or out: the participant it acts as follows its account. */
  async setSocketAccount(socketId: string, account: ParticipantAccount) {
    const next = accountOf(account);
    for (const t of [...this.tournaments.values()]) {
      const p = t.participants.find((x) => x.sockets.has(socketId));
      if (!p || sameAccount(p, next)) continue;
      await this.withTournament(t.id, (fresh, tx) => {
        const q = fresh.participants.find((x) => x.sockets.has(socketId));
        tx.changed = !!q;
        if (q) Object.assign(q, next);
      }).catch(() => {});
    }
  }

  /** Cosmetic changes, lobby only (the bracket shows what players looked like when it started). */
  updateProfile(tournamentId: string, participantId: string, profile: { name?: string; avatar?: string | null }) {
    return this.withTournament(tournamentId, (t, tx) => {
      const p = this.requireParticipant(t, participantId);
      if (t.status !== 'LOBBY') throw new GameError('TOURNAMENT_STARTED');
      const name = profile.name !== undefined ? sanitizeName(profile.name) : p.name;
      const avatar = profile.avatar !== undefined && profile.avatar !== null ? profile.avatar : p.avatar;
      tx.changed = name !== p.name || avatar !== p.avatar;
      p.name = name;
      p.avatar = avatar;
      return { name, avatar };
    });
  }

  /** Stops a socket from watching (disconnect, or it moved to another tournament). */
  detach(tournamentId: string, socketId: string) {
    return this.withTournament(tournamentId, (t, tx) => {
      let changed = t.spectators.delete(socketId);
      for (const p of t.participants) changed = p.sockets.delete(socketId) || changed;
      tx.changed = changed;
    });
  }

  leave(tournamentId: string, participantId: string) {
    return this.withTournament(tournamentId, async (t, tx) => {
      const p = this.requireParticipant(t, participantId);
      if (t.status === 'LOBBY') {
        t.participants = t.participants.filter((x) => x.id !== p.id);
        if (t.hostId === p.id) t.hostId = t.participants[0]?.id ?? null;
        if (t.participants.length === 0) {
          tx.deleted = true;
          tx.emit(() => this.sink.closed(t.id));
        }
        return;
      }
      p.sockets.clear();
      if (t.status === 'FINISHED' || p.left) return;
      p.left = true;
      p.eliminated = true;
      const m = this.activeMatchOf(t, p.id);
      if (m?.status === 'READY_CHECK') {
        this.finishMatch(t, m, this.opponentOf(m, p.id), 'walkover', tx);
      } else if (m?.status === 'LIVE' && m.roomId) {
        // Mid-game, leaving the room forfeits it and the room's result settles the match.
        // Between games of a series there's nothing to forfeit, so settle it here. The room
        // decides which under its own lock, so a game ending just before the leave can't
        // leave the match waiting on a next game that will never start.
        const forfeited = await this.rooms.leave(m.roomId, p.id).catch(() => false);
        if (!forfeited) this.finishMatch(t, m, this.opponentOf(m, p.id), 'left', tx);
      }
      // A PENDING match is settled as a walkover when its ready check would open.
    });
  }

  kick(tournamentId: string, hostId: string, targetId: string) {
    return this.withTournament(tournamentId, (t) => {
      if (t.hostId !== hostId) throw new GameError('NOT_HOST');
      if (t.status !== 'LOBBY') throw new GameError('TOURNAMENT_STARTED');
      if (targetId === hostId) throw new GameError('INVALID_PAYLOAD');
      const target = this.requireParticipant(t, targetId);
      t.participants = t.participants.filter((x) => x.id !== targetId);
      // Their tabs stay on the page, now as spectators.
      for (const s of target.sockets) t.spectators.add(s);
      return { kickedSockets: [...target.sockets] };
    });
  }

  /** Seeds the players at random, builds the bracket, settles byes and opens the first ready checks. */
  start(tournamentId: string, hostId: string) {
    return this.withTournament(tournamentId, (t, tx) => {
      if (t.hostId !== hostId) throw new GameError('NOT_HOST');
      if (t.status !== 'LOBBY') throw new GameError('TOURNAMENT_STARTED');
      if (t.participants.length < minPlayersFor(t.size)) throw new GameError('NOT_ENOUGH_PLAYERS');

      const now = this.now();
      const shuffled = [...t.participants];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffled.forEach((p, i) => (p.seed = i + 1));
      const bySeed = new Map(shuffled.map((p) => [p.seed!, p.id]));

      const order = seedOrder(t.size);
      const rounds = totalRounds(t.size);
      t.rounds = Array.from({ length: rounds }, (_, r) =>
        Array.from({ length: t.size / 2 ** (r + 1) }, (_, i) => this.newMatch(r, i)),
      );
      t.rounds[0].forEach((m, i) => {
        m.playerA = bySeed.get(order[2 * i]) ?? null;
        m.playerB = bySeed.get(order[2 * i + 1]) ?? null;
        if (!m.playerA || !m.playerB) {
          m.status = 'DONE';
          m.winnerId = m.playerA ?? m.playerB;
          m.reason = 'bye';
          m.finishedAt = now;
        }
      });
      t.status = 'RUNNING';
      t.startedAt = now;
      this.advance(t, tx);
    });
  }

  ready(tournamentId: string, participantId: string, matchId: string) {
    return this.withTournament(tournamentId, async (t, tx) => {
      const m = this.findMatch(t, matchId);
      if (!m || m.status !== 'READY_CHECK') throw new GameError('MATCH_NOT_READY');
      if (m.playerA !== participantId && m.playerB !== participantId) throw new GameError('NOT_A_PLAYER');
      if (m.ready.includes(participantId)) {
        tx.changed = false;
        return { launched: false };
      }
      m.ready.push(participantId);
      if (m.ready.length < 2) return { launched: false };
      await this.launch(t, m);
      return { launched: true };
    });
  }

  get(tournamentId: string) {
    return this.tournaments.get(tournamentId);
  }

  /** Deletes tournaments nobody has watched for `idleTtlMs`. */
  async sweep() {
    for (const t of [...this.tournaments.values()]) {
      if (!this.isIdle(t)) continue;
      await this.lock(t.id, async () => {
        const fresh = this.tournaments.get(t.id);
        if (!fresh || !this.isIdle(fresh)) return;
        this.remove(fresh);
        this.sink.closed(fresh.id);
      });
    }
  }

  stats() {
    const all = [...this.tournaments.values()];
    return { tournaments: all.length, running: all.filter((t) => t.status === 'RUNNING').length };
  }

  // ─── Bracket mechanics ─────────────────────────────────────────────────────

  /**
   * Moves every decided winner into its next-round slot, then opens a ready
   * check on each match that now has both players. Runs until nothing changes
   * (a walkover can decide a match, which fills the next slot, and so on).
   */
  private advance(t: Tournament, tx: Tx) {
    for (let r = 0; r < t.rounds.length - 1; r++) {
      t.rounds[r].forEach((m, i) => {
        if (m.status !== 'DONE' || !m.winnerId) return;
        const next = t.rounds[r + 1][Math.floor(i / 2)];
        if (i % 2 === 0) next.playerA = m.winnerId;
        else next.playerB = m.winnerId;
      });
    }
    for (const round of t.rounds) {
      for (const m of round) {
        if (m.status === 'PENDING' && m.playerA && m.playerB) this.openReadyCheck(t, m, tx);
      }
    }
  }

  private openReadyCheck(t: Tournament, m: Match, tx: Tx) {
    const a = this.participant(t, m.playerA)!;
    const b = this.participant(t, m.playerB)!;
    if (a.left || b.left) {
      const winner = a.left && b.left ? this.betterSeed(a, b).id : a.left ? b.id : a.id;
      this.finishMatch(t, m, winner, 'walkover', tx);
      return;
    }
    const deadline = this.now() + this.cfg.tournament.readyCheckMs;
    m.status = 'READY_CHECK';
    m.ready = [];
    m.readyDeadline = deadline;
    this.timers.schedule(this.readyKey(t.id, m.id), deadline, () => {
      this.run(t.id, (fresh, ftx) => {
        const match = this.findMatch(fresh, m.id);
        if (!match || match.status !== 'READY_CHECK' || match.readyDeadline !== deadline) {
          ftx.changed = false;
          return;
        }
        this.settleNoShow(fresh, match, ftx);
      });
    });
  }

  /**
   * Ready check expired. A player who confirmed beats one who didn't; if
   * nobody confirmed, a connected player beats an absent one; otherwise the
   * better seed goes through, so the bracket always finishes.
   */
  private settleNoShow(t: Tournament, m: Match, tx: Tx) {
    const a = this.participant(t, m.playerA)!;
    const b = this.participant(t, m.playerB)!;
    const aReady = m.ready.includes(a.id);
    const bReady = m.ready.includes(b.id);
    let winner: Participant;
    if (aReady !== bReady) winner = aReady ? a : b;
    else if (a.sockets.size > 0 !== b.sockets.size > 0) winner = a.sockets.size > 0 ? a : b;
    else winner = this.betterSeed(a, b);
    this.finishMatch(t, m, winner.id, 'walkover', tx);
  }

  /** Both players are ready: the match gets its room and goes LIVE. */
  private async launch(t: Tournament, m: Match) {
    const players = [m.playerA, m.playerB].map((id) => this.participant(t, id)!);
    const room = await this.rooms.createTournamentRoom({
      link: { id: t.id, name: t.name, matchId: m.id, round: m.round, totalRounds: t.rounds.length, bestOf: t.bestOf },
      boardSize: t.boardSize,
      turnMs: t.turnMs,
      startDelayMs: this.cfg.tournament.matchStartDelayMs,
      players: players.map((p) => ({ id: p.id, token: p.token, name: p.name, avatar: p.avatar, nameStyle: p.nameStyle, avatarFrame: p.avatarFrame })),
    });
    this.timers.clear(this.readyKey(t.id, m.id));
    this.roomIndex.set(room.id, { tournamentId: t.id, matchId: m.id });
    m.status = 'LIVE';
    m.readyDeadline = null;
    m.roomId = room.id;
    m.games = 1;
    m.startedAt = this.now();
  }

  private finishMatch(t: Tournament, m: Match, winnerId: string, reason: TournamentWinReason, tx: Tx) {
    if (m.status === 'DONE') return;
    this.timers.clear(this.readyKey(t.id, m.id));
    this.timers.clear(this.nextGameKey(t.id, m.id));
    m.status = 'DONE';
    m.winnerId = winnerId;
    m.reason = reason;
    m.readyDeadline = null;
    m.nextGameAt = null;
    m.finishedAt = this.now();
    const loser = this.participant(t, this.opponentOf(m, winnerId));
    if (loser) loser.eliminated = true;

    if (m.round === t.rounds.length - 1) {
      t.status = 'FINISHED';
      t.championId = winnerId;
      t.finishedAt = this.now();
    } else {
      this.advance(t, tx);
    }
  }

  /** The room reports a finished game: the only way a LIVE match gets a winner. */
  private onRoomFinished(room: Room, result: FinishedResult) {
    const link = this.roomIndex.get(room.id);
    if (room.mode !== 'tournament' || !link) return;
    // Queued, not awaited: this runs inside the room's lock.
    this.run(link.tournamentId, (t, tx) => {
      const m = this.findMatch(t, link.matchId);
      if (!m || m.status !== 'LIVE' || m.roomId !== room.id) {
        tx.changed = false;
        return;
      }
      if (!result.winner) {
        // A draw decides nothing, in a single game or a series: play another, sides swapped.
        this.scheduleNextGame(t, m);
        return;
      }
      const winnerId = result.players.find((p) => p.mark === result.winner)?.id;
      if (!winnerId || (winnerId !== m.playerA && winnerId !== m.playerB)) {
        tx.changed = false;
        return;
      }
      if (winnerId === m.playerA) m.scoreA += 1;
      else m.scoreB += 1;
      const seriesWon = Math.max(m.scoreA, m.scoreB) >= winsNeeded(t.bestOf);
      // Leaving the room or staying offline too long gives up the whole series: that player isn't coming back.
      if (seriesWon || result.reason === 'left' || result.reason === 'abandoned') {
        this.finishMatch(t, m, winnerId, result.reason, tx);
      } else {
        this.scheduleNextGame(t, m);
      }
    });
  }

  /** Next game of the series in the same room, after a pause so both players see the result. */
  private scheduleNextGame(t: Tournament, m: Match) {
    const at = this.now() + this.cfg.tournament.nextGameDelayMs;
    m.nextGameAt = at;
    this.timers.schedule(this.nextGameKey(t.id, m.id), at, () => {
      this.run(t.id, async (fresh, tx) => {
        const match = this.findMatch(fresh, m.id);
        if (!match || match.status !== 'LIVE' || match.nextGameAt !== at || !match.roomId) {
          tx.changed = false;
          return;
        }
        match.nextGameAt = null;
        if (await this.rooms.replayTournamentRound(match.roomId).catch(() => false)) {
          match.games += 1;
          return;
        }
        // The room can't host another game (someone left it): the series goes to whoever is still seated.
        const room = await this.rooms.getRoom(match.roomId);
        const seated = room?.players.find((p) => p.id === match.playerA || p.id === match.playerB)?.id;
        this.finishMatch(fresh, match, seated ?? this.leader(fresh, match), 'left', tx);
      });
    });
  }

  /** Series leader, or the better seed when level. */
  private leader(t: Tournament, m: Match) {
    if (m.scoreA !== m.scoreB) return (m.scoreA > m.scoreB ? m.playerA : m.playerB)!;
    return this.betterSeed(this.participant(t, m.playerA)!, this.participant(t, m.playerB)!).id;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private newParticipant(name: string | undefined, avatar: string | null, socketId: string, now: number, account: ParticipantAccount = GUEST): Participant {
    return {
      ...accountOf(account),
      id: nanoid(10),
      token: nanoid(32),
      name: sanitizeName(name),
      avatar,
      seed: null,
      sockets: new Set([socketId]),
      joinedAt: now,
      eliminated: false,
      left: false,
    };
  }

  private newMatch(round: number, index: number): Match {
    return {
      id: `r${round}m${index}`,
      round,
      index,
      playerA: null,
      playerB: null,
      status: 'PENDING',
      ready: [],
      readyDeadline: null,
      roomId: null,
      winnerId: null,
      reason: null,
      games: 0,
      scoreA: 0,
      scoreB: 0,
      nextGameAt: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  private participant(t: Tournament, id: string | null) {
    return id ? t.participants.find((p) => p.id === id) : undefined;
  }

  private requireParticipant(t: Tournament, id: string) {
    const p = this.participant(t, id);
    if (!p) throw new GameError('NOT_IN_TOURNAMENT');
    return p;
  }

  private findMatch(t: Tournament, matchId: string) {
    for (const round of t.rounds) for (const m of round) if (m.id === matchId) return m;
    return undefined;
  }

  /** The not-yet-decided match a participant is in or waiting for. */
  private activeMatchOf(t: Tournament, participantId: string) {
    for (const round of t.rounds) {
      for (const m of round) {
        if (m.status !== 'DONE' && (m.playerA === participantId || m.playerB === participantId)) return m;
      }
    }
    return undefined;
  }

  private opponentOf(m: Match, participantId: string) {
    return (m.playerA === participantId ? m.playerB : m.playerA)!;
  }

  private betterSeed(a: Participant, b: Participant) {
    return (a.seed ?? Infinity) <= (b.seed ?? Infinity) ? a : b;
  }

  private isIdle(t: Tournament) {
    const someoneHere = t.spectators.size > 0 || t.participants.some((p) => p.sockets.size > 0);
    return !someoneHere && this.now() - t.lastActiveAt > this.cfg.tournament.idleTtlMs;
  }

  private remove(t: Tournament) {
    this.tournaments.delete(t.id);
    this.timers.clearPrefix(`t:${t.id}:`);
    for (const [roomId, link] of this.roomIndex) if (link.tournamentId === t.id) this.roomIndex.delete(roomId);
  }

  private readyKey(tournamentId: string, matchId: string) {
    return `t:${tournamentId}:ready:${matchId}`;
  }

  private nextGameKey(tournamentId: string, matchId: string) {
    return `t:${tournamentId}:next:${matchId}`;
  }

  private run(tournamentId: string, fn: (t: Tournament, tx: Tx) => void | Promise<void>) {
    this.withTournament(tournamentId, fn).catch((err) => {
      if (!(err instanceof GameError)) console.error('[tournament]', err);
    });
  }

  /** Same unit-of-work pattern as RoomManager.withRoom: lock, mutate, then broadcast. */
  private withTournament<T>(tournamentId: string, fn: (t: Tournament, tx: Tx) => T | Promise<T>): Promise<T> {
    return this.lock(tournamentId, async () => {
      const t = this.tournaments.get(tournamentId);
      if (!t) throw new GameError('TOURNAMENT_NOT_FOUND');
      const tx = new Tx();
      const result = await fn(t, tx);
      if (tx.deleted) {
        this.remove(t);
      } else if (tx.changed) {
        const now = this.now();
        t.version += 1;
        t.updatedAt = now;
        t.lastActiveAt = now;
        tx.emit(() => this.sink.state(t));
      }
      for (const emit of tx.events) emit();
      return result;
    });
  }

  private lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
