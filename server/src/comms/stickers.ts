/**
 * Sticker ids players may send (mirrored in client/src/lib/stickers.ts, which
 * maps each id to its artwork). A whitelist: a sticker message carries an id,
 * never a URL, so nobody can make the other player load an arbitrary image.
 */
const NOTO = [
  'joy', 'rofl', 'heart-eyes', 'cool', 'thinking', 'scream', 'sob', 'rage', 'party', 'mind-blown',
  'smirk', 'sweat-smile', 'sleeping', 'pleading', 'kiss', 'zany', 'in-love', 'skull', 'fire', 'heart',
  'thumbs-up', 'clap', 'tada', 'hundred', 'eyes', 'pray', 'muscle', 'wave', 'clown', 'ghost',
];
const FLUENT = [
  'trophy', 'crown', 'gold-medal', 'rocket', 'brain', 'bomb', 'boom', 'sparkles', 'crystal-ball',
  'hourglass', 'alarm', 'dice', 'gamepad', 'party-popper', 'hundred', 'robot', 'alien', 'smug-cat',
  'monocle', 'nerd', 'eye-roll', 'yawn', 'thumbs-up', 'handshake', 'flex', 'snail',
];
const CARO = ['gg', 'nice', 'hurry', 'oops', 'rematch', 'thinking', 'easy', 'lucky', 'block', 'sad'];

export const STICKER_IDS: readonly string[] = [
  ...NOTO.map((s) => `noto:${s}`),
  ...FLUENT.map((s) => `fluent:${s}`),
  ...CARO.map((s) => `caro:${s}`),
];

export const STICKER_SET: ReadonlySet<string> = new Set(STICKER_IDS);
