// Vietnamese word order: animal first, then the adjective ("Mèo Lanh Lợi").
const ANIMALS = [
  'Mèo', 'Cáo', 'Gấu', 'Hổ', 'Thỏ', 'Cú', 'Rùa', 'Sóc', 'Cá Heo', 'Voi',
  'Khỉ', 'Nai', 'Chim Sẻ', 'Vịt', 'Gà Con', 'Cún', 'Ngựa', 'Sư Tử', 'Gấu Trúc', 'Nhím',
];
const ADJECTIVES = [
  'Lanh Lợi', 'Dũng Cảm', 'Vui Vẻ', 'Nhanh Nhẹn', 'Tinh Nghịch', 'Thông Minh', 'May Mắn', 'Điềm Tĩnh',
  'Hài Hước', 'Mạnh Mẽ', 'Siêu Tốc', 'Đáng Yêu', 'Tài Ba', 'Bình Tĩnh', 'Láu Lỉnh', 'Hăng Hái',
];

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export const randomName = () => `${pick(ANIMALS)} ${pick(ADJECTIVES)}`;

export const MAX_NAME_LENGTH = 20;

/** Strips control characters and angle brackets, collapses whitespace, and falls back to a random name. */
export function sanitizeName(raw: string | undefined | null): string {
  const cleaned = (raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned || randomName();
}
