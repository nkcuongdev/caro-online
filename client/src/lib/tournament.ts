import type { PublicMatch, PublicParticipant, TournamentSnapshot, TournamentWinReason } from './protocol';

// ─── Participant sessions ────────────────────────────────────────────────────
// Same idea as lib/session.ts for rooms: this tab's spot (sessionStorage) is
// retaken right away after a reload; spots saved in this browser (localStorage)
// are retaken only if that participant is offline, so a second tab can still
// join as someone else.

export interface TournamentSession {
  tournamentId: string;
  participantId: string;
  token: string;
  savedAt: number;
}

const TAB_KEY = (id: string) => `caro:tournament:tab:${id}`;
const ALL_KEY = 'caro:tournaments';
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readAll(): TournamentSession[] {
  return safe(() => {
    const list = JSON.parse(localStorage.getItem(ALL_KEY) ?? '[]') as TournamentSession[];
    return Array.isArray(list) ? list.filter((s) => Date.now() - s.savedAt < MAX_AGE_MS) : [];
  }, []);
}

const writeAll = (list: TournamentSession[]) => safe(() => localStorage.setItem(ALL_KEY, JSON.stringify(list.slice(-20))), undefined);

export function getTabTournamentSession(id: string): TournamentSession | null {
  return safe(() => JSON.parse(sessionStorage.getItem(TAB_KEY(id)) ?? 'null'), null);
}

export function getStoredTournamentSessions(id: string): TournamentSession[] {
  return readAll()
    .filter((s) => s.tournamentId === id)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveTournamentSession(tournamentId: string, participantId: string, token: string) {
  const entry: TournamentSession = { tournamentId, participantId, token, savedAt: Date.now() };
  safe(() => sessionStorage.setItem(TAB_KEY(tournamentId), JSON.stringify(entry)), undefined);
  writeAll([...readAll().filter((s) => s.token !== token), entry]);
}

export function forgetTournamentSession(tournamentId: string, token?: string) {
  const tab = getTabTournamentSession(tournamentId);
  if (!token || tab?.token === token) safe(() => sessionStorage.removeItem(TAB_KEY(tournamentId)), undefined);
  writeAll(readAll().filter((s) => (token ? s.token !== token : s.tournamentId !== tournamentId)));
}

// ─── Bracket helpers ─────────────────────────────────────────────────────────

/** "Chung kết", "Bán kết", "Tứ kết", "Vòng 1/8" from a 0-based round. */
export function roundName(round: number, totalRounds: number): string {
  const left = totalRounds - round;
  if (left === 1) return 'Chung kết';
  if (left === 2) return 'Bán kết';
  if (left === 3) return 'Tứ kết';
  return `Vòng 1/${2 ** (left - 1)}`;
}

/** "Một ván quyết định", "Thắng 2 trong 3 ván", "Thắng 3 trong 5 ván". */
export function bestOfHint(bestOf: number): string {
  return bestOf <= 1 ? 'Một ván quyết định' : `Thắng ${Math.floor(bestOf / 2) + 1} trong ${bestOf} ván`;
}

/** Compact label for tight spaces: "CK", "BK", "TK", "1/8". */
export function roundShort(round: number, totalRounds: number): string {
  const left = totalRounds - round;
  if (left === 1) return 'CK';
  if (left === 2) return 'BK';
  if (left === 3) return 'TK';
  return `1/${2 ** (left - 1)}`;
}

export const matchLabel =(m: PublicMatch, totalRounds: number) =>
  m.round === totalRounds - 1 ? 'Chung kết' : `${roundName(m.round, totalRounds)} · Trận ${m.index + 1}`;

export function participantMap(t: TournamentSnapshot): Map<string, PublicParticipant> {
  return new Map(t.participants.map((p) => [p.id, p]));
}

/** The undecided match this participant plays next (or is playing), if any. */
export function activeMatchOf(t: TournamentSnapshot, participantId: string | null): PublicMatch | null {
  if (!participantId) return null;
  for (const round of t.rounds) {
    for (const m of round) {
      if (m.status !== 'DONE' && (m.playerA === participantId || m.playerB === participantId)) return m;
    }
  }
  return null;
}

/** The round the bracket is currently playing (the earliest one with an undecided match). */
export function currentRound(t: TournamentSnapshot): number {
  const i = t.rounds.findIndex((round) => round.some((m) => m.status !== 'DONE'));
  return i === -1 ? t.rounds.length - 1 : i;
}

/** Last round a participant reached (for "stopped at the quarterfinal"). */
export function reachedRound(t: TournamentSnapshot, participantId: string): number {
  let reached = -1;
  for (const round of t.rounds) for (const m of round) if (m.playerA === participantId || m.playerB === participantId) reached = m.round;
  return reached;
}

export const opponentIn = (m: PublicMatch, participantId: string) => (m.playerA === participantId ? m.playerB : m.playerA);

export const REASON_LABEL: Record<TournamentWinReason, string> = {
  five: '5 quân liên tiếp',
  timeout: 'Đối thủ hết giờ',
  resign: 'Đối thủ đầu hàng',
  abandoned: 'Đối thủ mất kết nối',
  left: 'Đối thủ bỏ cuộc',
  draw: 'Hòa',
  walkover: 'Đối thủ vắng mặt',
  bye: 'Miễn đấu',
};

const NAME_PARTS = {
  first: ['Cúp', 'Giải', 'Đấu Trường', 'Siêu Cúp', 'Chung Kết'],
  second: ['Caro Mùa Thu', 'Ngũ Kỳ', 'Năm Quân', 'Bàn Cờ Vàng', 'Tia Chớp', 'Rồng Lửa', 'Kỳ Thủ Nhí', 'Mèo Đen'],
};

export function randomTournamentName(): string {
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(NAME_PARTS.first)} ${pick(NAME_PARTS.second)}`;
}
