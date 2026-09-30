import type { MatchResult, MatchSummary } from '../../lib/account';
import type { BotDifficulty, FinishReason, RoomMode } from '../../lib/protocol';
import { roundName } from '../../lib/tournament';

export const BOT_LEVEL: Record<BotDifficulty, string> = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };

export const MODE_LABEL: Record<RoomMode, string> = { pvp: 'Đối kháng', bot: 'Với Bot', tournament: 'Giải đấu' };

export const RESULT_STYLE: Record<MatchResult, { label: string; chip: string; bar: string; dot: string }> = {
  win: { label: 'Thắng', chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-400', dot: 'bg-emerald-400' },
  loss: { label: 'Thua', chip: 'bg-coral-100 text-coral-600 ring-coral-200', bar: 'bg-coral-400', dot: 'bg-coral-400' },
  draw: { label: 'Hòa', chip: 'bg-violet-100 text-violet-600 ring-violet-200', bar: 'bg-violet-400', dot: 'bg-violet-400' },
};

/** How the game ended, told from the player's side. */
export function reasonText(reason: FinishReason, result: MatchResult): string {
  const won = result === 'win';
  switch (reason) {
    case 'five':
      return won ? '5 quân liên tiếp' : 'Đối thủ nối 5';
    case 'timeout':
      return won ? 'Đối thủ hết giờ' : 'Bạn hết giờ';
    case 'resign':
      return won ? 'Đối thủ đầu hàng' : 'Bạn đầu hàng';
    case 'abandoned':
      return won ? 'Đối thủ mất kết nối' : 'Mất kết nối quá lâu';
    case 'left':
      return won ? 'Đối thủ rời phòng' : 'Bạn rời phòng';
    case 'draw':
      return 'Bàn cờ đầy';
  }
}

export function matchContext(m: MatchSummary): string {
  if (m.mode === 'bot') return `Bot ${BOT_LEVEL[m.botDifficulty ?? 'medium']}`;
  if (m.mode === 'tournament') {
    const round = m.tournamentRound != null && m.tournamentTotalRounds ? roundName(m.tournamentRound, m.tournamentTotalRounds) : 'Giải đấu';
    return m.tournamentName ? `${m.tournamentName} · ${round}` : round;
  }
  return 'Đối kháng';
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h} giờ ${m % 60} phút`;
}

/** Total play time, compact: "3 giờ 12 phút", "45 phút". */
export function formatPlayTime(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return ms > 0 ? '< 1 phút' : '0 phút';
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60 ? `${m % 60} phút` : ''}`.trim();
}

export function relativeTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Hôm qua';
  if (d < 7) return `${d} ngày trước`;
  return new Date(at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const formatDate = (at: number) => new Date(at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
