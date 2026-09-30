import { RARITIES, RARITY_LABEL, type Rarity } from './rarity';

/**
 * Titles as the server reports them (server/src/titles/). The catalogue,
 * ownership and the equipped title all live on the server; the client never
 * decides what a player owns. Names, icons and looks arrive with each title,
 * so nothing here lists titles by id.
 */

/** Titles use the shared rarity scale (lib/rarity.ts). */
export type TitleRarity = Rarity;
export type TitleEffect = 'none' | 'glow' | 'gradient' | 'shimmer' | 'fire' | 'lightning' | 'shield' | 'glitch';

export interface PublicTitle {
  id: string;
  name: string;
  description: string;
  /** An emoji. */
  icon: string;
  rarity: TitleRarity;
  effect: TitleEffect;
}

/** The achievement that grants a title, masked by the server while it's secret. */
export interface TitleSource {
  achievementId: string;
  name: string;
  description: string;
  secret: boolean;
  unlocked: boolean;
  percentage: number;
}

/** One card of the collection. `title: null` = a secret title not owned yet. */
export interface TitleView {
  key: string;
  title: PublicTitle | null;
  rarity: TitleRarity;
  owned: boolean;
  equipped: boolean;
  unlockedAt: number | null;
  source: TitleSource | null;
}

export interface TitleCollection {
  titles: TitleView[];
  equippedTitleId: string | null;
  summary: { owned: number; total: number };
}

export const TITLE_RARITY_ORDER: readonly TitleRarity[] = RARITIES;

export const TITLE_EFFECT_LABEL: Record<TitleEffect, string> = {
  none: 'Tĩnh',
  glow: 'Tỏa sáng',
  gradient: 'Chuyển sắc',
  shimmer: 'Lấp lánh',
  fire: 'Lửa',
  lightning: 'Tia chớp',
  shield: 'Khiên',
  glitch: 'Nhiễu loạn',
};

export const TITLE_RARITY_LABEL: Record<TitleRarity, string> = RARITY_LABEL;
