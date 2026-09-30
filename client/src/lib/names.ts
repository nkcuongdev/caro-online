// Mirrored in server/src/rooms/names.ts. Vietnamese word order: animal first, then the adjective ("Mèo Lanh Lợi").
const ANIMALS = [
  'Mèo', 'Cáo', 'Gấu', 'Hổ', 'Thỏ', 'Cú', 'Rùa', 'Sóc', 'Cá Heo', 'Voi',
  'Khỉ', 'Nai', 'Chim Sẻ', 'Vịt', 'Gà Con', 'Cún', 'Ngựa', 'Sư Tử', 'Gấu Trúc', 'Nhím',
];
const ADJECTIVES = [
  'Lanh Lợi', 'Dũng Cảm', 'Vui Vẻ', 'Nhanh Nhẹn', 'Tinh Nghịch', 'Thông Minh', 'May Mắn', 'Điềm Tĩnh',
  'Hài Hước', 'Mạnh Mẽ', 'Siêu Tốc', 'Đáng Yêu', 'Tài Ba', 'Bình Tĩnh', 'Láu Lỉnh', 'Hăng Hái',
];

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** A guest name, picked here (not by the server) so it can be saved and kept across rooms. */
export function randomName(avoid?: string): string {
  let name: string;
  do name = `${pick(ANIMALS)} ${pick(ADJECTIVES)}`;
  while (name === avoid);
  return name;
}
