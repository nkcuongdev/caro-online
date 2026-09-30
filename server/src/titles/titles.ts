/**
 * The title catalogue: cosmetic badges shown next to a player's name.
 *
 * A title has no unlock condition of its own. It is a reward: achievements
 * (achievements/definitions.ts) list it in their `rewards`, and the reward
 * service grants it. Ownership is stored per user (`user_titles`), so other
 * sources (events, seasons, gifts) can grant titles later without touching
 * this file.
 *
 * Ids are stored in the database: never rename or reuse one.
 */

export const TITLE_RARITIES = ['common', 'rare', 'epic', 'legendary', 'secret'] as const;
export type TitleRarity = (typeof TITLE_RARITIES)[number];

/** Visual effects the client knows how to draw (client/src/components/titles). */
export const TITLE_EFFECTS = ['none', 'glow', 'gradient', 'shimmer', 'fire', 'lightning', 'shield', 'glitch'] as const;
export type TitleEffect = (typeof TITLE_EFFECTS)[number];

export interface TitleDefinition {
  id: string;
  name: string;
  description: string;
  /** An emoji. */
  icon: string;
  rarity: TitleRarity;
  effect: TitleEffect;
  /** Name, icon and description stay secret until the player owns it. Always true for `secret` rarity. */
  hidden?: boolean;
}

const defineTitles = <const T extends Record<string, Omit<TitleDefinition, 'id'>>>(defs: T) =>
  Object.fromEntries(Object.entries(defs).map(([id, d]) => [id, { id, ...d }])) as { [K in keyof T]: TitleDefinition & { id: K } };

export const TITLES = defineTitles({
  // ─── Tiến trình ────────────────────────────────────────────────────────────
  'tan-binh': { name: 'Tân Binh', description: 'Bước chân đầu tiên trên hành trình Caro.', icon: '🌱', rarity: 'common', effect: 'none' },
  'chien-binh': { name: 'Chiến Binh', description: 'Đã quen mùi thuốc súng trên bàn cờ.', icon: '⚔️', rarity: 'common', effect: 'none' },
  'dau-si': { name: 'Đấu Sĩ', description: 'Năm mươi trận đấu, không lùi bước.', icon: '🗡️', rarity: 'rare', effect: 'glow' },
  'nguoi-ben-bi': { name: 'Người Bền Bỉ', description: 'Một trăm ván cờ và vẫn muốn thêm ván nữa.', icon: '⏳', rarity: 'rare', effect: 'glow' },
  'khong-biet-met': { name: 'Không Biết Mệt', description: 'Năm trăm ván đấu. Bàn cờ là nhà.', icon: '♾️', rarity: 'epic', effect: 'gradient' },

  // ─── Chiến thắng ───────────────────────────────────────────────────────────
  'ke-chien-thang': { name: 'Kẻ Chiến Thắng', description: 'Mười chiến thắng đầu tiên, và còn nhiều nữa.', icon: '🏆', rarity: 'rare', effect: 'glow' },
  'cao-thu': { name: 'Cao Thủ', description: 'Năm mươi lần khiến đối thủ phải gật gù.', icon: '🎯', rarity: 'epic', effect: 'gradient' },
  'dai-cao-thu': { name: 'Đại Cao Thủ', description: 'Một trăm chiến thắng: đẳng cấp đã được khẳng định.', icon: '💎', rarity: 'epic', effect: 'shimmer' },
  'huyen-thoai': { name: 'Huyền Thoại Caro', description: 'Năm trăm chiến thắng. Tên bạn được kể lại ở mọi sảnh chờ.', icon: '👑', rarity: 'legendary', effect: 'shimmer' },

  // ─── Chuỗi thắng ───────────────────────────────────────────────────────────
  'phong-do-cao': { name: 'Phong Độ Cao', description: 'Đang vào guồng: ba trận thắng liền mạch.', icon: '⚡', rarity: 'rare', effect: 'glow' },
  'bat-bai': { name: 'Bất Bại', description: 'Danh hiệu dành cho người duy trì chuỗi chiến thắng.', icon: '🔥', rarity: 'epic', effect: 'fire' },
  'ke-huy-diet': { name: 'Kẻ Hủy Diệt', description: 'Mười trận liên tiếp không ai cản nổi.', icon: '🔥', rarity: 'legendary', effect: 'fire' },

  // ─── Kỹ năng & đối kháng ───────────────────────────────────────────────────
  'sat-thu-toc-do': { name: 'Sát Thủ Tốc Độ', description: 'Kết liễu ván đấu trước khi đối thủ kịp nhận ra.', icon: '⚡', rarity: 'epic', effect: 'lightning' },
  'buc-tuong': { name: 'Bức Tường', description: 'Đi sau vẫn thắng: phòng thủ vững như bàn thạch.', icon: '🛡️', rarity: 'epic', effect: 'shield' },
  'mat-dai-bang': { name: 'Mắt Đại Bàng', description: 'Không đường năm nào thoát khỏi tầm mắt.', icon: '👁️', rarity: 'epic', effect: 'shimmer' },
  'hoa-binh': { name: 'Hòa Bình Thế Giới', description: 'Không ai thắng, không ai thua, ai cũng vui.', icon: '🕊️', rarity: 'rare', effect: 'glow' },
  'ke-thach-dau': { name: 'Kẻ Thách Đấu', description: 'Đã hạ gục mười kỳ thủ khác nhau.', icon: '⚔️', rarity: 'rare', effect: 'glow' },

  // ─── Đặc biệt ──────────────────────────────────────────────────────────────
  'vo-dich': { name: 'Nhà Vô Địch', description: 'Đứng trên đỉnh của một giải đấu.', icon: '🥇', rarity: 'legendary', effect: 'shimmer' },
  'tu-than': { name: 'Tử Thần Caro', description: 'Năm nước đi. Năm quân. Không một nước thừa.', icon: '☠️', rarity: 'secret', effect: 'glitch', hidden: true },
});

export type TitleId = keyof typeof TITLES;

export const TITLE_LIST: readonly TitleDefinition[] = Object.values(TITLES);

export const isTitleId = (id: unknown): id is TitleId => typeof id === 'string' && Object.hasOwn(TITLES, id);

export const getTitle = (id: string | null | undefined): TitleDefinition | null => (id && isTitleId(id) ? TITLES[id] : null);

/** Secret titles keep their details to themselves until owned. */
export const isSecretTitle = (t: TitleDefinition) => t.rarity === 'secret' || !!t.hidden;

/** What clients see of a title: everything in the catalogue is public once the viewer may see it. */
export interface PublicTitle {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: TitleRarity;
  effect: TitleEffect;
}

export const toPublicTitle = (t: TitleDefinition): PublicTitle => ({
  id: t.id,
  name: t.name,
  description: t.description,
  icon: t.icon,
  rarity: t.rarity,
  effect: t.effect,
});

/** The public form of a stored title id, or null if the id is unknown (e.g. retired). */
export const publicTitleOf = (id: string | null | undefined): PublicTitle | null => {
  const t = getTitle(id);
  return t ? toPublicTitle(t) : null;
};
