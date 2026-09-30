/** Chat / reaction rules shared by the UI (the server enforces its own copy). */

/** Mirror of server/src/comms/reactions.ts. Emoji 11 or older, so Windows 10 renders them all. */
export const REACTIONS = [
  '👍', '😂', '😱', '🔥', '😭', '👏', '❤️', '😎',
  '🤣', '😅', '🤔', '😡', '🥳', '🤯', '😏', '🙏',
  '💪', '👀', '🎉', '😴', '🤝', '😬', '😤', '💀',
  '😍', '🙈', '👋', '💯', '🥺', '😇', '🤡', '👎',
] as const;

/** Shown first / in the compact mobile row. */
export const QUICK_REACTIONS = REACTIONS.slice(0, 8);

export const CHAT_MAX_LENGTH = 200;
/** Client-side pacing; the server allows 5 messages per 5s. */
export const CHAT_MIN_INTERVAL_MS = 600;
export const REACTION_COOLDOWN_MS = 1_500;
export const REACTION_VISIBLE_MS = 2_000;

export const chatLength = (text: string) => Array.from(text).length;
