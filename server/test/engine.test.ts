import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyMove, createGame, type EngineConfig } from '../src/game/gameEngine.js';
import { findWinningLine } from '../src/game/winChecker.js';
import type { Mark } from '../src/types.js';

const SIZE = 20;
const cfg: EngineConfig = { boardSize: SIZE, winLength: 5, turnMs: 30_000, moveGraceMs: 300 };
const at = (r: number, c: number) => r * SIZE + c;

function boardWith(cells: number[], mark: Mark = 'X') {
  const board = new Array<Mark | null>(SIZE * SIZE).fill(null);
  for (const i of cells) board[i] = mark;
  return board;
}

describe('winChecker', () => {
  it('detects horizontal, vertical, diagonal and anti-diagonal fives', () => {
    const lines = {
      horizontal: [0, 1, 2, 3, 4].map((c) => at(5, 3 + c)),
      vertical: [0, 1, 2, 3, 4].map((r) => at(2 + r, 7)),
      diagonal: [0, 1, 2, 3, 4].map((k) => at(10 + k, 10 + k)),
      antiDiagonal: [0, 1, 2, 3, 4].map((k) => at(4 + k, 15 - k)),
    };
    for (const [name, cells] of Object.entries(lines)) {
      const board = boardWith(cells);
      // The last move can be anywhere in the line, including the middle.
      for (const last of cells) {
        assert.deepEqual(findWinningLine(board, SIZE, last, 'X', 5), [...cells].sort((a, b) => a - b), name);
      }
    }
  });

  it('does not count four in a row', () => {
    const cells = [0, 1, 2, 3].map((c) => at(0, c));
    assert.equal(findWinningLine(boardWith(cells), SIZE, cells[3], 'X', 5), null);
  });

  it('does not wrap around the board edge', () => {
    // Three at the end of row 0 + two at the start of row 1 are contiguous indices but not a line.
    const cells = [at(0, 17), at(0, 18), at(0, 19), at(1, 0), at(1, 1)];
    assert.equal(findWinningLine(boardWith(cells), SIZE, at(1, 0), 'X', 5), null);
  });

  it('does not mix marks', () => {
    const board = boardWith([at(3, 0), at(3, 1), at(3, 3), at(3, 4)]);
    board[at(3, 2)] = 'O';
    assert.equal(findWinningLine(board, SIZE, at(3, 4), 'X', 5), null);
  });

  it('does not count a five blocked by the opponent at both ends', () => {
    const cells = [1, 2, 3, 4, 5].map((c) => at(6, c));
    const board = boardWith(cells);
    board[at(6, 0)] = 'O';
    board[at(6, 6)] = 'O';
    for (const last of cells) assert.equal(findWinningLine(board, SIZE, last, 'X', 5), null);

    const diagonal = [0, 1, 2, 3, 4].map((k) => at(8 + k, 8 + k));
    const diagBoard = boardWith(diagonal);
    diagBoard[at(7, 7)] = 'O';
    diagBoard[at(13, 13)] = 'O';
    assert.equal(findWinningLine(diagBoard, SIZE, at(10, 10), 'X', 5), null);
  });

  it('counts a five blocked at one end only', () => {
    const cells = [1, 2, 3, 4, 5].map((c) => at(6, c));
    const board = boardWith(cells);
    board[at(6, 0)] = 'O';
    assert.deepEqual(findWinningLine(board, SIZE, at(6, 3), 'X', 5), cells);
  });

  it('does not treat the board edge as a block', () => {
    const cells = [0, 1, 2, 3, 4].map((c) => at(2, c));
    const board = boardWith(cells);
    board[at(2, 5)] = 'O';
    assert.deepEqual(findWinningLine(board, SIZE, at(2, 4), 'X', 5), cells);
  });

  it('still wins in another direction when one line is blocked at both ends', () => {
    const row = [1, 2, 3, 4, 5].map((c) => at(6, c));
    const col = [2, 3, 4, 5].map((r) => at(r, 3));
    const board = boardWith([...row, ...col]);
    board[at(6, 0)] = 'O';
    board[at(6, 6)] = 'O';
    assert.deepEqual(findWinningLine(board, SIZE, at(6, 3), 'X', 5), [2, 3, 4, 5, 6].map((r) => at(r, 3)));
  });

  it('does not count an overline (6+)', () => {
    for (const length of [6, 7]) {
      const cells = Array.from({ length }, (_, c) => at(9, c + 2));
      for (const last of cells) assert.equal(findWinningLine(boardWith(cells), SIZE, last, 'X', 5), null, `${length} in a row`);
    }
  });

  it('still wins with an exact five in another direction through an overline move', () => {
    const row = [0, 1, 2, 3, 4, 5].map((c) => at(9, c + 2));
    const col = [5, 6, 7, 8].map((r) => at(r, 4));
    assert.deepEqual(findWinningLine(boardWith([...row, ...col]), SIZE, at(9, 4), 'X', 5), [5, 6, 7, 8, 9].map((r) => at(r, 4)));
  });
});

describe('gameEngine', () => {
  const start = 1_000;

  it('alternates turns and resets the deadline after each move', () => {
    const g = createGame(cfg, start);
    assert.equal(g.currentTurn, 'X');
    const r = applyMove(g, cfg, 'X', at(0, 0), 0, start + 5_000);
    assert.ok(r.ok);
    assert.equal(g.currentTurn, 'O');
    assert.equal(g.deadline, start + 5_000 + cfg.turnMs);
  });

  it('rejects out-of-turn, occupied, stale, early and late moves', () => {
    const g = createGame(cfg, start);
    assert.deepEqual(applyMove(g, cfg, 'X', 0, 0, start - 1), { ok: false, error: 'GAME_NOT_STARTED' });
    assert.deepEqual(applyMove(g, cfg, 'O', 0, 0, start), { ok: false, error: 'NOT_YOUR_TURN' });
    assert.ok(applyMove(g, cfg, 'X', 0, 0, start).ok);
    assert.deepEqual(applyMove(g, cfg, 'O', 0, 1, start), { ok: false, error: 'CELL_TAKEN' });
    assert.deepEqual(applyMove(g, cfg, 'O', 5, 0, start), { ok: false, error: 'STALE_MOVE' });
    assert.deepEqual(applyMove(g, cfg, 'O', 400, 1, start), { ok: false, error: 'INVALID_CELL' });
    assert.deepEqual(applyMove(g, cfg, 'O', 1.5, 1, start), { ok: false, error: 'INVALID_CELL' });
    const late = start + cfg.turnMs + cfg.moveGraceMs + 1;
    assert.deepEqual(applyMove(g, cfg, 'O', 5, 1, late), { ok: false, error: 'TIME_UP' });
  });

  it('accepts a move inside the latency grace window', () => {
    const g = createGame(cfg, start);
    assert.ok(applyMove(g, cfg, 'X', 0, 0, start + cfg.turnMs + cfg.moveGraceMs).ok);
  });

  it('finishes with the winning line and locks the board', () => {
    const g = createGame(cfg, start);
    let seq = 0;
    for (let i = 0; i < 4; i++) {
      assert.ok(applyMove(g, cfg, 'X', at(0, i), seq++, start).ok);
      assert.ok(applyMove(g, cfg, 'O', at(1, i), seq++, start).ok);
    }
    assert.ok(applyMove(g, cfg, 'X', at(0, 4), seq++, start).ok);
    assert.equal(g.finished, true);
    assert.equal(g.winner, 'X');
    assert.equal(g.loser, 'O');
    assert.equal(g.reason, 'five');
    assert.deepEqual(g.winLine, [0, 1, 2, 3, 4]);
    assert.deepEqual(applyMove(g, cfg, 'O', at(5, 5), seq, start), { ok: false, error: 'GAME_NOT_ACTIVE' });
  });

  it('declares a draw on a full board with no five', () => {
    const small: EngineConfig = { ...cfg, boardSize: 4, winLength: 5 };
    const g = createGame(small, start);
    for (let i = 0; i < 16; i++) {
      const mark: Mark = i % 2 === 0 ? 'X' : 'O';
      assert.ok(applyMove(g, small, mark, i, i, start).ok);
    }
    assert.equal(g.finished, true);
    assert.equal(g.reason, 'draw');
    assert.equal(g.winner, null);
  });
});
