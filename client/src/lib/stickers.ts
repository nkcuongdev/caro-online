/**
 * Sticker catalogue (ids mirrored in server/src/comms/stickers.ts).
 *
 * - `noto`: animated Noto Emoji © Google, CC BY 4.0 (resized, re-encoded).
 * - `fluent`: Fluent Emoji 3D © Microsoft Corporation, MIT.
 * - `caro`: drawn for this game (components/comms/CaroSticker.tsx).
 * Licence texts: client/public/stickers/LICENSES.md.
 */
export type StickerPack = 'noto' | 'fluent' | 'caro';

export interface StickerDef {
  id: string;
  pack: StickerPack;
  label: string;
  /** Image URL; Caro stickers are inline SVG and have none. */
  src?: string;
}

const NOTO: Record<string, string> = {
  joy: 'Cười ra nước mắt', rofl: 'Cười lăn lộn', 'heart-eyes': 'Mê quá', cool: 'Ngầu', thinking: 'Suy nghĩ',
  scream: 'Hoảng hốt', sob: 'Khóc to', rage: 'Tức giận', party: 'Quẩy lên', 'mind-blown': 'Nổ não', smirk: 'Nhếch mép',
  'sweat-smile': 'Cười trừ', sleeping: 'Buồn ngủ', pleading: 'Năn nỉ', kiss: 'Hôn gió', zany: 'Lầy lội',
  'in-love': 'Yêu thương', skull: 'Chết cười', fire: 'Cháy', heart: 'Trái tim', 'thumbs-up': 'Like',
  clap: 'Vỗ tay', tada: 'Chúc mừng', hundred: '100 điểm', eyes: 'Nhìn kìa', pray: 'Cầu xin', muscle: 'Khỏe',
  wave: 'Vẫy tay', clown: 'Hề', ghost: 'Ma',
};

const FLUENT: Record<string, string> = {
  trophy: 'Cúp vô địch', crown: 'Vương miện', 'gold-medal': 'Huy chương vàng', rocket: 'Tên lửa', brain: 'Bộ não',
  bomb: 'Bom', boom: 'Bùm', sparkles: 'Lấp lánh', 'crystal-ball': 'Tiên tri', hourglass: 'Hết giờ', alarm: 'Báo thức',
  dice: 'Xúc xắc', gamepad: 'Tay cầm', 'party-popper': 'Pháo giấy', hundred: '100', robot: 'Robot', alien: 'Người ngoài hành tinh',
  'smug-cat': 'Mèo gian', monocle: 'Soi kỹ', nerd: 'Mọt sách', 'eye-roll': 'Lườm', yawn: 'Ngáp', 'thumbs-up': 'Tuyệt',
  handshake: 'Bắt tay', flex: 'Gồng', snail: 'Chậm như rùa',
};

export const CARO_STICKERS: Record<string, string> = {
  gg: 'GG!',
  nice: 'Nước hay!',
  hurry: 'Nhanh lên!',
  oops: 'Toang rồi!',
  rematch: 'Làm ván nữa?',
  thinking: 'Để nghĩ đã…',
  easy: 'Dễ ợt!',
  lucky: 'Hên thôi!',
  block: 'Chặn!',
  sad: 'Thua rồi…',
};

export const STICKERS: StickerDef[] = [
  ...Object.entries(NOTO).map(([slug, label]) => ({ id: `noto:${slug}`, pack: 'noto' as const, label, src: `/stickers/noto/${slug}.webp` })),
  ...Object.entries(FLUENT).map(([slug, label]) => ({ id: `fluent:${slug}`, pack: 'fluent' as const, label, src: `/stickers/fluent/${slug}.webp` })),
  ...Object.entries(CARO_STICKERS).map(([slug, label]) => ({ id: `caro:${slug}`, pack: 'caro' as const, label })),
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));
export const stickerById = (id: string | undefined | null) => (id ? BY_ID.get(id) : undefined);

export const STICKER_PACKS: { pack: StickerPack; label: string; credit?: string }[] = [
  { pack: 'noto', label: 'Động', credit: 'Noto Emoji © Google · CC BY 4.0' },
  { pack: 'caro', label: 'Caro' },
  { pack: 'fluent', label: '3D', credit: 'Fluent Emoji © Microsoft · MIT' },
];
