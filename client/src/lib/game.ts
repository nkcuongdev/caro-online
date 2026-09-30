import type { FinishedResult, Mark, PublicPlayer, RoomSnapshot } from './protocol';

export const opposite = (m: Mark): Mark => (m === 'X' ? 'O' : 'X');

/** Player X always sits left, Player O right. Unassigned players fill the free seats in join order. */
export function seatPlayers(players: PublicPlayer[]): Record<Mark, PublicPlayer | null> {
  const seats: Record<Mark, PublicPlayer | null> = { X: null, O: null };
  for (const p of players) if (p.mark && !seats[p.mark]) seats[p.mark] = p;
  for (const p of players) {
    if (p.mark && seats[p.mark] === p) continue;
    if (!seats.X) seats.X = p;
    else if (!seats.O) seats.O = p;
  }
  return seats;
}

const REASON_TEXT: Record<FinishedResult['reason'], (loser: string) => string> = {
  five: () => '5 quân liên tiếp!',
  timeout: (loser) => `${loser} đã hết thời gian.`,
  resign: (loser) => `${loser} đã đầu hàng.`,
  abandoned: (loser) => `${loser} mất kết nối quá lâu.`,
  left: (loser) => `${loser} đã rời phòng.`,
  draw: () => 'bàn cờ đã đầy.',
};

/** VD: "Người chơi X thắng — Người chơi O đã hết thời gian." */
export function resultLine(result: Pick<FinishedResult, 'winner' | 'loser' | 'reason'>): string {
  if (!result.winner) return 'Hòa — bàn cờ đã đầy.';
  const loser = `Người chơi ${result.loser}`;
  return `Người chơi ${result.winner} thắng — ${REASON_TEXT[result.reason](loser)}`;
}

/** Rebuilds the result from a snapshot, for clients that (re)joined after the game ended. */
export function resultFromSnapshot(room: RoomSnapshot): FinishedResult | null {
  const g = room.game;
  if (!g?.finished || !g.reason) return null;
  return {
    roomId: room.id,
    round: room.round,
    mode: room.mode,
    winner: g.winner,
    loser: g.loser,
    reason: g.reason,
    winLine: g.winLine,
    players: room.players.map(({ id, name, avatar, mark, wins }) => ({ id, name, avatar, mark, wins })),
  };
}

export const formatClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function parseRoomInput(raw: string): string | null {
  const text = raw.trim();
  const fromUrl = text.match(/\/game\/([A-Za-z0-9]{4,16})/);
  const id = fromUrl ? fromUrl[1] : text;
  return /^[A-Za-z0-9]{4,16}$/.test(id) ? id : null;
}
