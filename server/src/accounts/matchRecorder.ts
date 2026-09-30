import type { FinishedResult, FinishedSeat, RoomManager } from '../rooms/roomManager.js';
import type { Room } from '../types.js';
import type { AccountStore, MatchRecord, MatchResult } from './accountStore.js';

interface Pending {
  record: MatchRecord;
  /** The other seat's token: claiming both sides of one game (self-play) counts neither. */
  opponentToken: string | null;
  expiresAt: number;
}

export interface MatchRecorderLimits {
  /** How long a guest's finished games wait to be claimed by a new account. */
  pendingTtlMs: number;
  maxPerSeat: number;
  maxTotal: number;
}

/** Called after a live game was added to an account's history (not for duplicates, not for claims). */
export type MatchRecordedListener = (userId: string, record: MatchRecord) => void | Promise<void>;

export const DEFAULT_RECORDER_LIMITS: MatchRecorderLimits = { pendingTtlMs: 6 * 60 * 60_000, maxPerSeat: 30, maxTotal: 5_000 };

/**
 * Writes every finished game to the history of each signed-in player in it.
 *
 * Guests' games are kept in memory for a while, keyed by their secret seat
 * token. If the guest then signs up or logs in, the client hands those tokens
 * back and the games move into the account, so playing first and registering
 * afterwards loses nothing. Knowing a seat token is the proof of having played
 * that seat: tokens are never broadcast.
 */
export class MatchRecorder {
  private pending = new Map<string, Pending[]>();
  private total = 0;
  private recordedListeners: MatchRecordedListener[] = [];
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly store: AccountStore,
    rooms: RoomManager,
    private readonly limits: MatchRecorderLimits = DEFAULT_RECORDER_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    rooms.onRoomFinished((room, result, seats) => {
      // Built synchronously from the room as it is now; only the database writes wait.
      this.track(this.onFinished(room, result, seats).catch((err) => console.error('[accounts] recording a match failed', err)));
    });
  }

  onMatchRecorded(listener: MatchRecordedListener) {
    this.recordedListeners.push(listener);
  }

  /** Resolves once every game finished so far is written and its listeners ran (tests, shutdown). */
  async idle() {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  private track(work: Promise<unknown>) {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  /** Moves a guest's recent games into an account. Returns how many were added. */
  async claim(tokens: string[], userId: string): Promise<number> {
    const mine = new Set(tokens);
    let added = 0;
    for (const token of mine) {
      const list = this.pending.get(token);
      if (!list) continue;
      this.pending.delete(token);
      this.total -= list.length;
      for (const p of list) {
        if (p.expiresAt <= this.now()) continue;
        if ((p.opponentToken && mine.has(p.opponentToken)) || p.record.opponentUserId === userId) continue;
        if (await this.store.recordMatch(userId, p.record)) added++;
      }
    }
    return added;
  }

  prune() {
    const now = this.now();
    for (const [token, list] of this.pending) {
      const fresh = list.filter((p) => p.expiresAt > now);
      this.total -= list.length - fresh.length;
      if (fresh.length) this.pending.set(token, fresh);
      else this.pending.delete(token);
    }
  }

  private async onFinished(room: Room, result: FinishedResult, seats: FinishedSeat[]) {
    const game = room.game;
    if (!game) return;
    const writes: Promise<void>[] = [];
    const humans = seats.filter((s) => !s.isBot && s.mark);
    for (const seat of humans) {
      const opponent = seats.find((s) => s.id !== seat.id) ?? null;
      const outcome: MatchResult = !result.winner ? 'draw' : seat.mark === result.winner ? 'win' : 'loss';
      const record: MatchRecord = {
        roomId: room.id,
        round: result.round,
        mode: room.mode,
        result: outcome,
        reason: result.reason,
        myMark: seat.mark,
        myName: seat.name,
        myAvatar: seat.avatar,
        opponentName: opponent?.name ?? null,
        opponentAvatar: opponent?.avatar ?? null,
        opponentIsBot: !!opponent?.isBot,
        opponentUserId: opponent?.userId ?? null,
        botDifficulty: room.bot?.difficulty ?? null,
        boardSize: room.boardSize,
        turnMs: room.turnMs,
        moves: game.moves.map((m) => m.index),
        winLine: result.winLine,
        startedAt: game.startAt,
        finishedAt: game.finishedAt ?? this.now(),
        tournamentId: room.tournament?.id ?? null,
        tournamentName: room.tournament?.name ?? null,
        tournamentRound: room.tournament?.round ?? null,
        tournamentTotalRounds: room.tournament?.totalRounds ?? null,
      };

      if (seat.userId) {
        // One account on both seats (two tabs) isn't a real game.
        if (opponent?.userId === seat.userId) continue;
        const userId = seat.userId;
        writes.push(this.store.recordMatch(userId, record).then((added) => (added ? this.notifyRecorded(userId, record) : undefined)));
      } else {
        this.remember(seat.token, { record, opponentToken: opponent && !opponent.isBot ? opponent.token : null, expiresAt: this.now() + this.limits.pendingTtlMs });
      }
    }
    await Promise.all(writes);
  }

  private async notifyRecorded(userId: string, record: MatchRecord) {
    for (const listener of this.recordedListeners) {
      try {
        await listener(userId, record);
      } catch (err) {
        console.error('[accounts] match-recorded listener failed', err);
      }
    }
  }

  private remember(token: string, entry: Pending) {
    const list = this.pending.get(token) ?? [];
    list.push(entry);
    this.total++;
    if (list.length > this.limits.maxPerSeat) {
      list.shift();
      this.total--;
    }
    // Re-insert so Map order stays "least recently used first".
    this.pending.delete(token);
    this.pending.set(token, list);
    for (const [oldest, old] of this.pending) {
      if (this.total <= this.limits.maxTotal) break;
      this.pending.delete(oldest);
      this.total -= old.length;
    }
  }
}
