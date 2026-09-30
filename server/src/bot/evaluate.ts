import { findWinningLine } from '../game/winChecker.js';
import type { Mark } from '../types.js';

/**
 * Board model for the bot. Every line of 5 consecutive cells on the board is a
 * "window"; a window only counts for a side while the other side has no stone
 * in it. Scores are kept per window and updated incrementally, so placing or
 * removing a stone costs O(20) instead of rescanning the board. That is what
 * lets the Hard search run on a 20×20 board within its time budget.
 */

/** 1 = X, 2 = O. Cells hold 0 for empty. */
export type Side = 1 | 2;
export const sideOf = (mark: Mark): Side => (mark === 'X' ? 1 : 2);
export const other = (side: Side): Side => (side === 1 ? 2 : 1);

export const WIN_LENGTH = 5;
/** Value of a live window holding n stones of one side. Index 5 is a completed five. */
export const WINDOW_SCORE = [0, 1, 12, 150, 2_500, 10_000_000] as const;
export const WIN_SCORE = 1_000_000_000;
/** Candidate moves are empty cells within this Chebyshev distance of a stone. */
export const NEAR_RADIUS = 2;

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

interface WindowTable {
  /** Cells of window w are `cells[w * 5 … w * 5 + 4]`. */
  cells: Int16Array;
  /** Direction (0‥3) of window w. */
  dir: Uint8Array;
  /** Windows containing each cell (at most 20). */
  byCell: Int32Array[];
  count: number;
}

const tables = new Map<number, WindowTable>();

function windowTable(size: number): WindowTable {
  const cached = tables.get(size);
  if (cached) return cached;
  const cells: number[] = [];
  const dir: number[] = [];
  const byCell: number[][] = Array.from({ length: size * size }, () => []);
  DIRECTIONS.forEach(([dr, dc], d) => {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const endR = r + dr * (WIN_LENGTH - 1);
        const endC = c + dc * (WIN_LENGTH - 1);
        if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;
        const w = dir.length;
        dir.push(d);
        for (let k = 0; k < WIN_LENGTH; k++) {
          const cell = (r + dr * k) * size + (c + dc * k);
          cells.push(cell);
          byCell[cell].push(w);
        }
      }
    }
  });
  const table: WindowTable = {
    cells: Int16Array.from(cells),
    dir: Uint8Array.from(dir),
    byCell: byCell.map((ws) => Int32Array.from(ws)),
    count: dir.length,
  };
  tables.set(size, table);
  return table;
}

export class Position {
  readonly size: number;
  readonly cells: Int8Array;
  /** Stones within NEAR_RADIUS of each cell. */
  readonly near: Uint8Array;
  stones = 0;
  /** Sum of window scores per side (index 1 = X, 2 = O). */
  readonly score = [0, 0, 0];
  /**
   * Live windows with 4 stones per side. 0 means that side cannot complete a
   * five next move; > 0 means it probably can, unless every such five would be
   * blocked at both ends (see `hasFive`).
   */
  readonly fours = [0, 0, 0];
  private readonly t: WindowTable;
  private readonly counts: [Uint8Array, Uint8Array, Uint8Array];

  constructor(board: ReadonlyArray<Mark | null>, size: number) {
    this.size = size;
    this.t = windowTable(size);
    this.cells = new Int8Array(size * size);
    this.near = new Uint8Array(size * size);
    this.counts = [new Uint8Array(0), new Uint8Array(this.t.count), new Uint8Array(this.t.count)];
    board.forEach((m, i) => m && this.place(i, sideOf(m)));
  }

  /** Static evaluation from `side`'s point of view. */
  evaluate(side: Side): number {
    return this.score[side] - this.score[other(side)];
  }

  place(cell: number, side: Side): void {
    const opp = other(side);
    const mine = this.counts[side];
    const theirs = this.counts[opp];
    for (const w of this.t.byCell[cell]) {
      const a = mine[w];
      const b = theirs[w];
      if (b === 0) {
        this.score[side] += WINDOW_SCORE[a + 1] - WINDOW_SCORE[a];
        if (a === 3) this.fours[side]++;
        else if (a === 4) this.fours[side]--;
      } else if (a === 0) {
        this.score[opp] -= WINDOW_SCORE[b];
        if (b === 4) this.fours[opp]--;
      }
      mine[w] = a + 1;
    }
    this.cells[cell] = side;
    this.stones++;
    this.updateNear(cell, 1);
  }

  remove(cell: number, side: Side): void {
    const opp = other(side);
    const mine = this.counts[side];
    const theirs = this.counts[opp];
    for (const w of this.t.byCell[cell]) {
      const a = mine[w] - 1;
      const b = theirs[w];
      mine[w] = a;
      if (b === 0) {
        this.score[side] -= WINDOW_SCORE[a + 1] - WINDOW_SCORE[a];
        if (a === 3) this.fours[side]--;
        else if (a === 4) this.fours[side]++;
      } else if (a === 0) {
        this.score[opp] += WINDOW_SCORE[b];
        if (b === 4) this.fours[opp]++;
      }
    }
    this.cells[cell] = 0;
    this.stones--;
    this.updateNear(cell, -1);
  }

  /**
   * How much `side`'s evaluation improves by playing `cell`: its own lines
   * grow (attack) and the opponent's lines through the cell die (defence).
   */
  gain(cell: number, side: Side): number {
    const mine = this.counts[side];
    const theirs = this.counts[other(side)];
    let g = 0;
    for (const w of this.t.byCell[cell]) {
      const a = mine[w];
      const b = theirs[w];
      if (b === 0) g += WINDOW_SCORE[a + 1] - WINDOW_SCORE[a];
      else if (a === 0) g += WINDOW_SCORE[b];
    }
    return g;
  }

  /** True if `side` playing `cell` completes a winning five (not blocked at both ends). */
  makesFive(cell: number, side: Side): boolean {
    const mine = this.counts[side];
    const theirs = this.counts[other(side)];
    for (const w of this.t.byCell[cell]) if (mine[w] === 4 && theirs[w] === 0) return this.winsAt(cell, side);
    return false;
  }

  /** True if `side` can complete a winning five next move. */
  hasFive(side: Side): boolean {
    return this.fours[side] > 0 && this.fivePoints(side).length > 0;
  }

  /** Every empty cell where `side` would complete a winning five right now. */
  fivePoints(side: Side): number[] {
    const mine = this.counts[side];
    const theirs = this.counts[other(side)];
    const points = new Set<number>();
    for (let w = 0; w < this.t.count; w++) {
      if (mine[w] !== 4 || theirs[w] !== 0) continue;
      const e = this.emptyIn(w);
      if (!points.has(e) && this.winsAt(e, side)) points.add(e);
    }
    return [...points];
  }

  /**
   * After `side` plays `cell`, how many distinct cells would then complete a
   * five through it. 1 = a four (forces a block), ≥ 2 = an open four (unstoppable).
   * `dir` restricts the count to one direction.
   */
  fivePointsAfter(cell: number, side: Side, dir = -1): number {
    this.place(cell, side);
    const mine = this.counts[side];
    const theirs = this.counts[other(side)];
    let first = -1;
    let n = 0;
    for (const w of this.t.byCell[cell]) {
      if (mine[w] !== 4 || theirs[w] !== 0 || (dir >= 0 && this.t.dir[w] !== dir)) continue;
      const e = this.emptyIn(w);
      if (e !== first && this.winsAt(e, side)) {
        if (first === -1) first = e;
        n = n === 0 ? 1 : 2;
        if (n === 2) break;
      }
    }
    this.remove(cell, side);
    return n;
  }

  /**
   * Number of directions in which `side` playing `cell` makes an open three:
   * a line that one more stone turns into an open four.
   */
  openThreesAfter(cell: number, side: Side): number {
    this.place(cell, side);
    const mine = this.counts[side];
    const theirs = this.counts[other(side)];
    let dirs = 0;
    for (const w of this.t.byCell[cell]) {
      const d = this.t.dir[w];
      if (mine[w] !== 3 || theirs[w] !== 0 || dirs & (1 << d)) continue;
      for (let k = 0; k < WIN_LENGTH; k++) {
        const e = this.t.cells[w * WIN_LENGTH + k];
        if (this.cells[e] === 0 && this.fivePointsAfter(e, side, d) >= 2) {
          dirs |= 1 << d;
          break;
        }
      }
    }
    this.remove(cell, side);
    return (dirs & 1) + ((dirs >> 1) & 1) + ((dirs >> 2) & 1) + ((dirs >> 3) & 1);
  }

  /** Whether `side` playing the empty `cell` wins under the game's rule (five, not blocked at both ends). */
  private winsAt(cell: number, side: Side): boolean {
    this.cells[cell] = side;
    const win = findWinningLine(this.cells, this.size, cell, side, WIN_LENGTH) !== null;
    this.cells[cell] = 0;
    return win;
  }

  private emptyIn(w: number): number {
    for (let k = 0; k < WIN_LENGTH; k++) {
      const cell = this.t.cells[w * WIN_LENGTH + k];
      if (this.cells[cell] === 0) return cell;
    }
    return -1;
  }

  private updateNear(cell: number, delta: 1 | -1) {
    const size = this.size;
    const r0 = Math.floor(cell / size);
    const c0 = cell % size;
    for (let r = Math.max(0, r0 - NEAR_RADIUS); r <= Math.min(size - 1, r0 + NEAR_RADIUS); r++) {
      for (let c = Math.max(0, c0 - NEAR_RADIUS); c <= Math.min(size - 1, c0 + NEAR_RADIUS); c++) {
        this.near[r * size + c] += delta;
      }
    }
  }
}

/**
 * Full-board static evaluation for `mark`: the sum of its live windows minus
 * the opponent's. Positive means `mark` stands better.
 */
export function evaluateBoard(board: ReadonlyArray<Mark | null>, size: number, mark: Mark): number {
  return new Position(board, size).evaluate(sideOf(mark));
}
