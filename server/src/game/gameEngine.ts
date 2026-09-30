import type { FinishReason, GameState, Mark, Move } from '../types.js';
import { findWinningLine } from './winChecker.js';

/**
 * Pure game rules. No sockets, no timers, no I/O: every function takes the
 * current time as an argument so the rules are deterministic and testable.
 */

export interface EngineConfig {
  boardSize: number;
  winLength: number;
  turnMs: number;
  moveGraceMs: number;
}

export type MoveError =
  | 'GAME_NOT_ACTIVE'
  | 'GAME_NOT_STARTED'
  | 'TIME_UP'
  | 'NOT_YOUR_TURN'
  | 'INVALID_CELL'
  | 'STALE_MOVE'
  | 'CELL_TAKEN';

export type MoveResult = { ok: true; move: Move } | { ok: false; error: MoveError };

export const opposite = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

export function createGame(cfg: EngineConfig, startAt: number): GameState {
  const cells = cfg.boardSize * cfg.boardSize;
  return {
    size: cfg.boardSize,
    board: new Array<Mark | null>(cells).fill(null),
    moves: [],
    currentTurn: 'X',
    startAt,
    turnStartedAt: startAt,
    deadline: startAt + cfg.turnMs,
    pausedRemainingMs: null,
    finished: false,
    winner: null,
    loser: null,
    reason: null,
    winLine: null,
    finishedAt: null,
  };
}

/** True once the current turn's deadline (plus latency grace) has passed. A paused clock never expires. */
export function isTurnExpired(game: GameState, cfg: EngineConfig, now: number): boolean {
  return !game.finished && game.pausedRemainingMs === null && now > game.deadline + cfg.moveGraceMs;
}

/** Freezes the turn clock, keeping whatever time the player on turn has left. */
export function pauseClock(game: GameState, now: number): void {
  if (game.finished || game.pausedRemainingMs !== null) return;
  game.pausedRemainingMs = Math.max(0, game.deadline - Math.max(now, game.startAt));
}

/** Restarts a frozen clock with the time that was left (counting from the start of play, if not yet reached). */
export function resumeClock(game: GameState, now: number): void {
  if (game.pausedRemainingMs === null) return;
  game.deadline = Math.max(now, game.startAt) + game.pausedRemainingMs;
  game.pausedRemainingMs = null;
}

/**
 * Validates and applies one move. `seq` must equal the number of moves already
 * played, so duplicate or stale submissions (double clicks, retries after lag)
 * can never produce a second move for the same turn.
 */
export function applyMove(
  game: GameState,
  cfg: EngineConfig,
  mark: Mark,
  index: number,
  seq: number,
  now: number,
): MoveResult {
  if (game.finished) return { ok: false, error: 'GAME_NOT_ACTIVE' };
  if (now < game.startAt) return { ok: false, error: 'GAME_NOT_STARTED' };
  if (isTurnExpired(game, cfg, now)) return { ok: false, error: 'TIME_UP' };
  if (mark !== game.currentTurn) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!Number.isInteger(index) || index < 0 || index >= game.board.length) {
    return { ok: false, error: 'INVALID_CELL' };
  }
  if (seq !== game.moves.length) return { ok: false, error: 'STALE_MOVE' };
  if (game.board[index] !== null) return { ok: false, error: 'CELL_TAKEN' };

  const move: Move = { index, mark, seq, at: now };
  game.board[index] = mark;
  game.moves.push(move);

  const winLine = findWinningLine(game.board, game.size, index, mark, cfg.winLength);
  if (winLine) {
    finishGame(game, mark, 'five', now, winLine);
  } else if (game.moves.length === game.board.length) {
    finishGame(game, null, 'draw', now);
  } else {
    game.currentTurn = opposite(mark);
    game.turnStartedAt = now;
    game.deadline = now + cfg.turnMs;
  }
  return { ok: true, move };
}

export function finishGame(
  game: GameState,
  winner: Mark | null,
  reason: FinishReason,
  now: number,
  winLine: number[] | null = null,
): void {
  if (game.finished) return;
  game.finished = true;
  game.winner = winner;
  game.loser = winner ? opposite(winner) : null;
  game.reason = reason;
  game.winLine = winLine;
  game.finishedAt = now;
}
