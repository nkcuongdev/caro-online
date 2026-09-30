/**
 * One rarity scale for everything collectible: achievements, titles, name
 * styles, avatar frames and whatever cosmetics come next. Mirrored in
 * client/src/lib/rarity.ts.
 *
 * `secret` is for things whose unlock stays hidden (a secret name style, a
 * hidden achievement's reward); they are never sold for coins.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'secret'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Kept for avatarFrames.ts: frames use the shared scale. */
export const AVATAR_FRAME_RARITIES = RARITIES;
export type AvatarFrameRarity = Rarity;
