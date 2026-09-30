import type { AchievementCategory } from '../../lib/achievements';
import { RARITY_LABEL, type Rarity } from '../../lib/rarity';

/**
 * Rarity → look, for everything that has a rarity (achievements, titles, name
 * styles). Colours come from the `--color-rarity-*` theme tokens (index.css),
 * so a card never picks its own colours.
 */
export interface RarityStyle {
  label: string;
  /** Small pill with the rarity name. */
  chip: string;
  /** Unlocked card: outline and tint. */
  card: string;
  /** Icon tile behind the sticker. */
  tile: string;
  /** Progress bar fill. */
  bar: string;
  /** Popup outline. */
  ring: string;
  /** Halo colour (CSS value) for `.ach-halo`. */
  glow: string;
  /** Accent text (popup heading). */
  text: string;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: {
    label: RARITY_LABEL.common,
    chip: 'bg-slate-100 text-slate-600 ring-slate-200',
    card: 'ring-rarity-common/50 bg-gradient-to-br from-white to-slate-50',
    tile: 'bg-gradient-to-br from-slate-50 to-slate-100 ring-rarity-common/40',
    bar: 'bg-gradient-to-r from-slate-300 to-rarity-common',
    ring: 'ring-rarity-common/50',
    glow: 'color-mix(in srgb, var(--color-rarity-common) 55%, transparent)',
    text: 'text-slate-500',
  },
  rare: {
    label: RARITY_LABEL.rare,
    chip: 'bg-rarity-rare/10 text-brand-600 ring-rarity-rare/30',
    card: 'ring-rarity-rare/45 bg-gradient-to-br from-white to-brand-50',
    tile: 'bg-gradient-to-br from-brand-50 to-brand-100 ring-rarity-rare/40',
    bar: 'bg-gradient-to-r from-brand-300 to-rarity-rare',
    ring: 'ring-rarity-rare/50',
    glow: 'color-mix(in srgb, var(--color-rarity-rare) 60%, transparent)',
    text: 'text-brand-600',
  },
  epic: {
    label: RARITY_LABEL.epic,
    chip: 'bg-rarity-epic/10 text-violet-600 ring-rarity-epic/30',
    card: 'ring-rarity-epic/45 bg-gradient-to-br from-white to-violet-50',
    tile: 'bg-gradient-to-br from-violet-50 to-violet-100 ring-rarity-epic/40',
    bar: 'bg-gradient-to-r from-violet-300 to-rarity-epic',
    ring: 'ring-rarity-epic/55',
    glow: 'color-mix(in srgb, var(--color-rarity-epic) 60%, transparent)',
    text: 'text-violet-600',
  },
  legendary: {
    label: RARITY_LABEL.legendary,
    chip: 'bg-rarity-legendary/15 text-amber-700 ring-rarity-legendary/40',
    card: 'ring-rarity-legendary/55 bg-gradient-to-br from-white to-amber-50',
    tile: 'bg-gradient-to-br from-amber-50 to-amber-100 ring-rarity-legendary/50',
    bar: 'bg-gradient-to-r from-amber-300 to-rarity-legendary',
    ring: 'ring-rarity-legendary/60',
    glow: 'color-mix(in srgb, var(--color-rarity-legendary) 65%, transparent)',
    text: 'text-amber-600',
  },
  secret: {
    label: RARITY_LABEL.secret,
    chip: 'bg-slate-900 text-fuchsia-200 ring-rarity-secret/60',
    card: 'ring-rarity-secret/50 bg-gradient-to-br from-white to-fuchsia-50',
    tile: 'bg-gradient-to-br from-slate-800 to-slate-900 ring-rarity-secret/50',
    bar: 'bg-gradient-to-r from-fuchsia-300 to-rarity-secret',
    ring: 'ring-rarity-secret/60',
    glow: 'color-mix(in srgb, var(--color-rarity-secret) 60%, transparent)',
    text: 'text-fuchsia-600',
  },
};

export const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  progress: 'Tiến trình',
  battle: 'Chiến đấu',
  skill: 'Kỹ năng',
  bot: 'Bot',
  collection: 'Sưu tầm',
  special: 'Đặc biệt',
};

/** Filter tabs on the achievements page, in order. `null` = all. */
export const CATEGORY_FILTERS: (AchievementCategory | null)[] = [null, 'progress', 'battle', 'skill', 'bot', 'special'];

export const formatCoins = (n: number) => n.toLocaleString('vi-VN');
