import { type Position, type Side } from './evaluate.js';

/**
 * Empty cells worth considering: those within `radius` (Chebyshev distance)
 * of a stone already on the board. On an empty board, the centre.
 * Never scans beyond the neighbourhood of played stones for radius 2, which
 * `Position` tracks incrementally.
 */
export function generateCandidateMoves(pos: Position, radius: 1 | 2 = 2): number[] {
  const { size, cells, near } = pos;
  if (pos.stones === 0) return [(size >> 1) * size + (size >> 1)];
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0 || near[i] === 0) continue;
    if (radius === 1 && !hasNeighbour(pos, i)) continue;
    out.push(i);
  }
  return out;
}

function hasNeighbour({ size, cells }: Position, cell: number): boolean {
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  for (let r = Math.max(0, r0 - 1); r <= Math.min(size - 1, r0 + 1); r++) {
    for (let c = Math.max(0, c0 - 1); c <= Math.min(size - 1, c0 + 1); c++) {
      if (cells[r * size + c] !== 0) return true;
    }
  }
  return false;
}

/** Candidates sorted by `pos.gain` (attack + defence), best first. `noise` breaks ties randomly. */
export function rankMoves(pos: Position, side: Side, moves: number[], noise?: () => number): number[] {
  const scored = moves.map((m) => ({ m, g: pos.gain(m, side) + (noise ? noise() : 0) }));
  scored.sort((a, b) => b.g - a.g);
  return scored.map((s) => s.m);
}
