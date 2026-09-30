/**
 * One rarity scale for achievements, titles, name styles and future cosmetics.
 * Mirror of server/src/cosmetics/rarity.ts. The look of each rarity is
 * `RARITY_STYLE` (components/achievements/rarity.ts), shared by every screen.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'secret'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Display names, the same on every screen. */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Thường',
  rare: 'Hiếm',
  epic: 'Sử thi',
  legendary: 'Huyền thoại',
  secret: 'Bí mật',
};

/** For sorting, rarest last. */
export const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3, secret: 4 };
