import { generateCandidateMoves, rankMoves } from './candidates.js';
import { other, WIN_SCORE, type Position, type Side } from './evaluate.js';

/**
 * Negamax with alpha-beta pruning and iterative deepening, bounded three ways
 * so a 20×20 board stays cheap: a depth cap, a cap on moves tried per node
 * (the best by `gain`), and a wall-clock deadline.
 */

export interface SearchLimits {
  maxDepth: number;
  /** Moves tried at the root. */
  rootWidth: number;
  /** Moves tried at inner nodes. */
  width: number;
  /** Epoch ms; the search returns the deepest fully searched result by then. */
  deadline: number;
}

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
}

class Timeout extends Error {}

interface Ctx {
  nodes: number;
  deadline: number;
  width: number;
}

/**
 * Moves worth searching for `side`. If the opponent threatens a five, only
 * the blocking cells are legal in practice, which keeps forcing lines narrow
 * and lets the search see much deeper along them.
 */
export function orderMoves(pos: Position, side: Side, width: number): number[] {
  if (pos.fours[other(side)] > 0) {
    const blocks = pos.fivePoints(other(side));
    if (blocks.length > 0) return blocks;
  }
  return rankMoves(pos, side, generateCandidateMoves(pos)).slice(0, width);
}

function negamax(pos: Position, side: Side, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  // Side to move can complete a five: the game is won (faster wins score higher).
  if (pos.hasFive(side)) return WIN_SCORE - ply;
  if (depth === 0) return pos.evaluate(side);
  if ((++ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) throw new Timeout();

  const moves = orderMoves(pos, side, ctx.width);
  if (moves.length === 0) return 0;
  let best = -Infinity;
  for (const m of moves) {
    pos.place(m, side);
    let v: number;
    try {
      v = -negamax(pos, other(side), depth - 1, -beta, -alpha, ply + 1, ctx);
    } finally {
      pos.remove(m, side); // also on Timeout, so the caller gets its position back intact
    }
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** `rootMoves` should already be ordered best-first; they are all assumed legal. */
export function searchBestMove(pos: Position, side: Side, rootMoves: number[], limits: SearchLimits): SearchResult {
  const ctx: Ctx = { nodes: 0, deadline: limits.deadline, width: limits.width };
  let moves = rootMoves.slice(0, limits.rootWidth);
  let result: SearchResult = { move: moves[0], score: 0, depth: 0, nodes: 0 };

  for (let depth = 1; depth <= limits.maxDepth; depth++) {
    let bestMove = moves[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    try {
      for (const m of moves) {
        pos.place(m, side);
        let v: number;
        try {
          v = -negamax(pos, other(side), depth - 1, -Infinity, -alpha, 1, ctx);
        } finally {
          pos.remove(m, side);
        }
        if (v > bestScore) {
          bestScore = v;
          bestMove = m;
        }
        if (v > alpha) alpha = v;
      }
    } catch (err) {
      if (err instanceof Timeout) break;
      throw err;
    }
    result = { move: bestMove, score: bestScore, depth, nodes: ctx.nodes };
    // A forced win or loss is settled; searching deeper cannot change the verdict.
    if (Math.abs(bestScore) >= WIN_SCORE - 100) break;
    // Principal variation first on the next iteration.
    moves = [bestMove, ...moves.filter((m) => m !== bestMove)];
  }
  result.nodes = ctx.nodes;
  return result;
}
