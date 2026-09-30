import type { Rarity } from '../cosmetics/rarity.js';
import { avatarFrame, coins, nameStyle, title, type Reward } from '../rewards/rewardService.js';

/**
 * The achievement catalogue: plain data, evaluated by AchievementManager.
 *
 * Adding an achievement is adding an entry here. Most only name a stat and a
 * target (`stat >= target`, or `stat <= target` for lower-is-better stats such
 * as the fastest win); anything a single stat can't express uses `custom`.
 * Ids are stored in the database: never rename or reuse one.
 *
 * Achievements own the conditions; `rewards` is what completing one grants
 * (coins, a title from titles/titles.ts, …), paid out by the reward service.
 */

/** Numbers AchievementManager can check. Derived from the match history (see `toAchievementStats`). */
export const STAT_KEYS = [
  'gamesPlayed',
  'totalWins',
  'totalLosses',
  'totalDraws',
  /** Wins against people: pvp rooms and tournament matches. */
  'winsVsPlayer',
  'winsVsBot',
  'winsVsHardBot',
  'currentWinStreak',
  'maxWinStreak',
  /** Fewest of your own moves in a five-in-a-row win. 0 = no such win yet. */
  'fastestWinMoves',
  /** Your own moves, summed over every game. */
  'totalMovesPlayed',
  /** Most moves (both players) in a single game. */
  'longestGameMoves',
  'tournamentTitles',
  /** Wins by five in a row, as opposed to timeouts and resignations. */
  'winsByFive',
  /** Wins playing O: the second mover, who starts on the defence. */
  'winsAsO',
  /** Different signed-in opponents beaten. Only accounts count: guests have no reliable identity. */
  'distinctOpponentsBeaten',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type AchievementStats = Record<StatKey, number>;

export const ACHIEVEMENT_CATEGORIES = ['progress', 'battle', 'skill', 'bot', 'collection', 'special'] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/** The rarity scale shared with titles and cosmetics. */
export { RARITIES, type Rarity } from '../cosmetics/rarity.js';

/** What completing an achievement grants. The reward service is the only place these are paid. */
export type AchievementReward = Reward;

export interface Progress {
  current: number;
  target: number;
  done: boolean;
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  /** A sticker id (`fluent:trophy`, `noto:fire`, … see client/src/lib/stickers.ts). */
  icon: string;
  category: AchievementCategory;
  rarity: Rarity;
  /** Name, description and condition stay secret until unlocked. */
  hidden?: boolean;
  rewards?: AchievementReward[];
  stat?: StatKey;
  target?: number;
  /** `gte` (default): reach the target. `lte`: get down to it; a stat of 0 means "not yet". */
  comparison?: 'gte' | 'lte';
  /** For conditions one stat can't express. Takes precedence over `stat` / `target`. */
  custom?: (stats: AchievementStats) => Progress;
}

/** A win in this many of your own moves (or fewer) is a "fast" win. Five is the minimum possible. */
export const FAST_WIN_MOVES = 9;
/** A game with this many moves (both players together) is a long one. */
export const LONG_GAME_MOVES = 100;

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // ─── Tiến trình ────────────────────────────────────────────────────────────
  { id: 'games-1', name: 'Trận đầu tiên', description: 'Chơi trận Caro đầu tiên', icon: 'fluent:gamepad', category: 'progress', rarity: 'common', stat: 'gamesPlayed', target: 1, rewards: [coins(20), title('tan-binh')] },
  { id: 'games-10', name: 'Người mới nhập cuộc', description: 'Chơi 10 trận', icon: 'noto:wave', category: 'progress', rarity: 'common', stat: 'gamesPlayed', target: 10, rewards: [coins(50), title('chien-binh')] },
  { id: 'games-50', name: 'Kỳ thủ chăm chỉ', description: 'Chơi 50 trận', icon: 'noto:muscle', category: 'progress', rarity: 'rare', stat: 'gamesPlayed', target: 50, rewards: [coins(150), title('dau-si')] },
  { id: 'games-100', name: 'Kỳ thủ kỳ cựu', description: 'Chơi 100 trận', icon: 'fluent:hourglass', category: 'progress', rarity: 'epic', stat: 'gamesPlayed', target: 100, rewards: [coins(300), title('nguoi-ben-bi'), nameStyle('galaxy')] },
  { id: 'games-500', name: 'Huyền thoại bàn cờ', description: 'Chơi 500 trận', icon: 'fluent:crown', category: 'progress', rarity: 'legendary', stat: 'gamesPlayed', target: 500, rewards: [coins(1000), title('khong-biet-met')] },

  // ─── Chiến thắng ───────────────────────────────────────────────────────────
  { id: 'wins-1', name: 'Chiến thắng đầu tiên', description: 'Thắng trận đầu tiên', icon: 'fluent:thumbs-up', category: 'battle', rarity: 'common', stat: 'totalWins', target: 1, rewards: [coins(30)] },
  { id: 'wins-10', name: 'Bắt đầu quen tay', description: 'Thắng 10 trận', icon: 'noto:clap', category: 'battle', rarity: 'common', stat: 'totalWins', target: 10, rewards: [coins(80), title('ke-chien-thang')] },
  { id: 'wins-50', name: 'Cao thủ Caro', description: 'Thắng 50 trận', icon: 'fluent:gold-medal', category: 'battle', rarity: 'rare', stat: 'totalWins', target: 50, rewards: [coins(200), title('cao-thu')] },
  { id: 'wins-100', name: 'Bậc thầy Caro', description: 'Thắng 100 trận', icon: 'fluent:trophy', category: 'battle', rarity: 'epic', stat: 'totalWins', target: 100, rewards: [coins(400), title('dai-cao-thu'), nameStyle('rainbow'), avatarFrame('frame_crystal')] },
  { id: 'wins-500', name: 'Huyền thoại Caro', description: 'Thắng 500 trận', icon: 'fluent:crown', category: 'battle', rarity: 'legendary', stat: 'totalWins', target: 500, rewards: [coins(1500), title('huyen-thoai'), avatarFrame('frame_champion')] },

  // ─── Chuỗi thắng ───────────────────────────────────────────────────────────
  { id: 'streak-3', name: 'Nóng máy', description: 'Thắng liên tiếp 3 trận', icon: 'noto:fire', category: 'battle', rarity: 'common', stat: 'maxWinStreak', target: 3, rewards: [coins(60), title('phong-do-cao')] },
  { id: 'streak-5', name: 'Bất Bại', description: 'Thắng liên tiếp 5 trận', icon: 'fluent:rocket', category: 'battle', rarity: 'rare', stat: 'maxWinStreak', target: 5, rewards: [coins(300), title('bat-bai')] },
  { id: 'streak-10', name: 'Không thể cản phá', description: 'Thắng liên tiếp 10 trận', icon: 'fluent:flex', category: 'battle', rarity: 'epic', stat: 'maxWinStreak', target: 10, rewards: [coins(600), title('ke-huy-diet')] },
  { id: 'streak-20', name: 'Thống trị', description: 'Thắng liên tiếp 20 trận', icon: 'fluent:boom', category: 'battle', rarity: 'legendary', stat: 'maxWinStreak', target: 20, rewards: [coins(1500)] },

  // ─── Đối kháng (người thật: phòng thường + giải đấu) ────────────────────────
  { id: 'pvp-1', name: 'Đối thủ thực sự', description: 'Thắng một người chơi thật', icon: 'fluent:handshake', category: 'battle', rarity: 'common', stat: 'winsVsPlayer', target: 1, rewards: [coins(40)] },
  { id: 'pvp-25', name: 'Chiến binh PvP', description: 'Thắng 25 trận trước người chơi thật', icon: 'noto:cool', category: 'battle', rarity: 'rare', stat: 'winsVsPlayer', target: 25, rewards: [coins(250)] },
  { id: 'pvp-100', name: 'Cao thủ đối kháng', description: 'Thắng 100 trận trước người chơi thật', icon: 'fluent:smug-cat', category: 'battle', rarity: 'epic', stat: 'winsVsPlayer', target: 100, rewards: [coins(600)] },
  { id: 'rivals-10', name: 'Kẻ thách đấu', description: 'Thắng 10 đối thủ khác nhau (có tài khoản)', icon: 'noto:smirk', category: 'battle', rarity: 'rare', stat: 'distinctOpponentsBeaten', target: 10, rewards: [coins(250), title('ke-thach-dau')] },
  { id: 'draws-5', name: 'Hòa cả làng', description: 'Hòa 5 trận', icon: 'noto:pray', category: 'battle', rarity: 'rare', stat: 'totalDraws', target: 5, rewards: [coins(150), title('hoa-binh')] },

  // ─── Bot ───────────────────────────────────────────────────────────────────
  { id: 'bot-1', name: 'Đánh bại máy', description: 'Thắng Bot lần đầu', icon: 'fluent:robot', category: 'bot', rarity: 'common', stat: 'winsVsBot', target: 1, rewards: [coins(20)] },
  { id: 'bot-20', name: 'Thợ săn AI', description: 'Thắng Bot 20 trận', icon: 'fluent:monocle', category: 'bot', rarity: 'rare', stat: 'winsVsBot', target: 20, rewards: [coins(150), nameStyle('ice_glow')] },
  { id: 'bot-100', name: 'Kẻ hủy diệt AI', description: 'Thắng Bot 100 trận', icon: 'fluent:bomb', category: 'bot', rarity: 'epic', stat: 'winsVsBot', target: 100, rewards: [coins(400)] },
  { id: 'bot-hard-1', name: 'Vượt mặt siêu máy', description: 'Thắng Bot cấp Khó', icon: 'fluent:brain', category: 'bot', rarity: 'epic', stat: 'winsVsHardBot', target: 1, rewards: [coins(350)] },

  // ─── Kỹ năng (số nước đi được ghi đầy đủ cho mọi ván) ────────────────────────
  { id: 'fast-win', name: 'Nhanh như chớp', description: `Thắng bằng 5 quân liên tiếp trong ${FAST_WIN_MOVES} nước đi của bạn trở xuống`, icon: 'fluent:alarm', category: 'skill', rarity: 'rare', stat: 'fastestWinMoves', target: FAST_WIN_MOVES, comparison: 'lte', rewards: [coins(150), title('sat-thu-toc-do')] },
  { id: 'five-50', name: 'Tinh mắt', description: 'Thắng 50 ván bằng 5 quân liên tiếp', icon: 'noto:eyes', category: 'skill', rarity: 'epic', stat: 'winsByFive', target: 50, rewards: [coins(400), title('mat-dai-bang')] },
  { id: 'o-wins-25', name: 'Hậu phương vững chắc', description: 'Thắng 25 trận khi cầm quân O (đi sau)', icon: 'noto:thinking', category: 'skill', rarity: 'epic', stat: 'winsAsO', target: 25, rewards: [coins(300), title('buc-tuong')] },
  { id: 'long-game', name: 'Bền bỉ', description: `Chơi một ván kéo dài từ ${LONG_GAME_MOVES} nước đi trở lên`, icon: 'fluent:snail', category: 'skill', rarity: 'rare', stat: 'longestGameMoves', target: LONG_GAME_MOVES, rewards: [coins(150)] },
  { id: 'moves-1000', name: 'Nghìn nước cờ', description: 'Đi tổng cộng 1.000 nước', icon: 'fluent:nerd', category: 'skill', rarity: 'rare', stat: 'totalMovesPlayed', target: 1000, rewards: [coins(200)] },

  // ─── Đặc biệt ──────────────────────────────────────────────────────────────
  { id: 'champion-1', name: 'Nhà vô địch', description: 'Vô địch một giải đấu', icon: 'fluent:party-popper', category: 'special', rarity: 'epic', stat: 'tournamentTitles', target: 1, rewards: [coins(500), title('vo-dich'), nameStyle('golden_shimmer'), avatarFrame('frame_crown')] },
  { id: 'perfect-five', name: 'Thần tốc', description: 'Thắng chỉ với đúng 5 nước đi, không một nước thừa', icon: 'fluent:sparkles', category: 'special', rarity: 'legendary', hidden: true, stat: 'fastestWinMoves', target: 5, comparison: 'lte', rewards: [coins(800), title('tu-than'), nameStyle('void')] },
  { id: 'marathon', name: 'Marathon trên bàn cờ', description: 'Chơi một ván kéo dài từ 200 nước đi trở lên', icon: 'fluent:alien', category: 'special', rarity: 'epic', hidden: true, stat: 'longestGameMoves', target: 200, rewards: [coins(400), avatarFrame('frame_nebula')] },
];
