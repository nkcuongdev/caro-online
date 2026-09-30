/**
 * Heuristic: does a stands comment look like it tells a player where to move?
 *
 * Such comments still reach the other spectators; they are only kept from the
 * players while a game is live (they can read them after the game). It errs
 * on the side of hiding: any digit is enough, since every way of naming a cell
 * ("h8", "5-6", "hàng 5 cột 6", "ô 12", keycap emoji) needs one. Directions
 * only count together with a move verb, so "chặn hay quá!" still gets through
 * but "chặn bên trái đi" does not.
 */

/** Whole-word match that understands Vietnamese letters (`\b` only knows ASCII). */
const words = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

const DIGIT = /\p{Nd}/u;
const NUMBER_WORD = words(['một', 'hai', 'ba', 'bốn', 'tư', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười', 'mươi', 'lăm']);
const GRID_WORD = words(['hàng', 'cột', 'dòng', 'ô', 'toạ độ', 'tọa độ']);
const MOVE_VERB = words(['đánh', 'đi', 'chặn', 'đặt', 'thả', 'vào']);
const DIRECTION = words(['trái', 'phải', 'trên', 'dưới', 'chéo', 'ngang', 'dọc', 'góc', 'giữa', 'cạnh']);

export function mayCoach(text: string): boolean {
  const t = text.normalize('NFC');
  if (DIGIT.test(t)) return true;
  if (GRID_WORD.test(t) && (NUMBER_WORD.test(t) || DIRECTION.test(t) || MOVE_VERB.test(t))) return true;
  return MOVE_VERB.test(t) && DIRECTION.test(t);
}
