/** Row/column steps for: horizontal, vertical, diagonal (↘), anti-diagonal (↙). */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Checks whether the piece just placed at `index` completes a line of exactly
 * `winLength` identical marks; an overline (winLength + 1 or more) does not win.
 * Only lines through the last move can be new wins, so this is O(winLength)
 * instead of scanning the whole board.
 *
 * A line whose cells just beyond both ends hold opponent pieces is "blocked at
 * both ends" and does not win. The board edge does not count as a block.
 *
 * Generic over the cell type so the bot can reuse it on its numeric board:
 * empty cells must be falsy (`null` / `0`), any other truthy value that is not
 * `mark` is the opponent.
 *
 * Returns the cell indices of the winning line (sorted), or null.
 */
export function findWinningLine<T>(
  board: ArrayLike<T>,
  size: number,
  index: number,
  mark: T,
  winLength: number,
): number[] | null {
  const row = Math.floor(index / size);
  const col = index % size;

  for (const [dr, dc] of DIRECTIONS) {
    const line = [index];
    let blockedEnds = 0;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === mark) {
        line.push(r * size + c);
        r += dr * sign;
        c += dc * sign;
      }
      if (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c]) blockedEnds++;
    }
    if (line.length === winLength && blockedEnds < 2) return line.sort((a, b) => a - b);
  }
  return null;
}
