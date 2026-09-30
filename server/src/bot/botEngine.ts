import type { BotDifficulty, Mark } from '../types.js';
import { generateCandidateMoves, rankMoves } from './candidates.js';
import { other, Position, sideOf, type Side } from './evaluate.js';
import { searchBestMove } from './search.js';

/**
 * Picks the bot's move. Pure and synchronous: no I/O, no game state beyond the
 * board, so it can be unit-tested and later moved to a worker thread unchanged.
 *
 * Every level, in order:
 *   1. complete a five if possible
 *   2. block the opponent's five
 * Then per level:
 *   - easy:   mostly a random cell next to existing stones, sometimes the best-looking one
 *   - medium: threat rules — make an unstoppable threat, block the opponent's
 *             open threes / double threats, build own fours and threes, else best positional score
 *   - hard:   make an unstoppable threat, else alpha-beta search over the best candidates
 */

/** Upper bound on thinking time per move. The room manager subtracts it from the "thinking" delay. */
export const BOT_TIME_BUDGET_MS: Record<BotDifficulty, number> = { easy: 5, medium: 20, hard: 200 };

const HARD_LIMITS = { maxDepth: 10, rootWidth: 14, width: 9 };

export interface ChooseOptions {
  rng?: () => number;
  /** Overrides the difficulty's time budget (Hard only). */
  timeLimitMs?: number;
}

export function chooseBotMove(
  board: ReadonlyArray<Mark | null>,
  size: number,
  mark: Mark,
  difficulty: BotDifficulty,
  opts: ChooseOptions = {},
): number {
  const rng = opts.rng ?? Math.random;
  const pos = new Position(board, size);
  const me = sideOf(mark);
  const opp = other(me);

  const candidates = generateCandidateMoves(pos);
  if (candidates.length === 0) return board.findIndex((c) => c === null);
  if (pos.stones === 0) return candidates[0];

  // 1. Win now.
  const win = candidates.find((c) => pos.makesFive(c, me));
  if (win !== undefined) return win;

  // 2. Block the opponent's five. With several five-points the game is lost anyway; block the best one.
  const blocks = candidates.filter((c) => pos.makesFive(c, opp));
  if (blocks.length > 0) return rankMoves(pos, me, blocks)[0];

  switch (difficulty) {
    case 'easy':
      return easyMove(pos, me, candidates, rng);
    case 'medium':
      return mediumMove(pos, me, candidates, rng);
    case 'hard':
      return hardMove(pos, me, candidates, rng, opts.timeLimitMs ?? BOT_TIME_BUDGET_MS.hard);
  }
}

function easyMove(pos: Position, me: Side, candidates: number[], rng: () => number): number {
  if (rng() < 0.3) return pickNearBest(rankMoves(pos, me, candidates), pos, me, 0.5, rng);
  const adjacent = generateCandidateMoves(pos, 1);
  const pool = adjacent.length > 0 ? adjacent : candidates;
  return pool[Math.floor(rng() * pool.length)];
}

interface Threat {
  /** Five-points created through this move: 1 = four, 2 = open four. */
  fours: number;
  /** Directions in which this move makes an open three. */
  threes: number;
}

function threatOf(pos: Position, cell: number, side: Side): Threat {
  return { fours: pos.fivePointsAfter(cell, side), threes: pos.openThreesAfter(cell, side) };
}

/** Open four, four + open three, or double open three: the opponent cannot parry everything. */
const isDecisive = (t: Threat) => t.fours >= 2 || (t.fours === 1 && t.threes >= 1) || t.threes >= 2;

function mediumMove(pos: Position, me: Side, candidates: number[], rng: () => number): number {
  const opp = other(me);
  const ranked = rankMoves(pos, me, candidates);
  const mine = ranked.map((c) => ({ c, t: threatOf(pos, c, me) }));

  // 3. Create an unstoppable threat.
  const decisive = mine.find((x) => isDecisive(x.t));
  if (decisive) return decisive.c;

  // 4. Block the opponent's dangerous threats (their open threes about to become open fours, double threats).
  const danger = ranked.filter((c) => isDecisive(threatOf(pos, c, opp)));
  if (danger.length > 0) return danger[0];

  // 5. Build: a four or an open three.
  const attack = mine.find((x) => x.t.fours === 1 || x.t.threes === 1);
  if (attack) return attack.c;

  // 6. Best positional score, with a little variety among near-equal moves.
  return pickNearBest(ranked, pos, me, 0.85, rng);
}

function hardMove(pos: Position, me: Side, candidates: number[], rng: () => number, timeLimitMs: number): number {
  const ranked = rankMoves(pos, me, candidates, () => rng() * 0.5);

  // 3. An open four wins outright (the opponent has no five-point, or we'd have blocked it).
  const openFour = ranked.find((c) => pos.fivePointsAfter(c, me) >= 2);
  if (openFour !== undefined) return openFour;

  return searchBestMove(pos, me, ranked, { ...HARD_LIMITS, deadline: Date.now() + timeLimitMs }).move;
}

/** Random pick among the ranked moves whose gain is within `ratio` of the best. */
function pickNearBest(ranked: number[], pos: Position, side: Side, ratio: number, rng: () => number): number {
  const best = pos.gain(ranked[0], side);
  const pool = ranked.slice(0, 4).filter((c) => pos.gain(c, side) >= best * ratio);
  return pool[Math.floor(rng() * pool.length)];
}
