/**
 * Emoji players may send as quick reactions (mirrored in client/src/lib/comms.ts).
 * A whitelist, so a reaction can never carry arbitrary text. All of these are
 * Emoji 11 or older, so they render on Windows 10 / older Android too.
 */
export const REACTIONS = [
  '👍', '😂', '😱', '🔥', '😭', '👏', '❤️', '😎',
  '🤣', '😅', '🤔', '😡', '🥳', '🤯', '😏', '🙏',
  '💪', '👀', '🎉', '😴', '🤝', '😬', '😤', '💀',
  '😍', '🙈', '👋', '💯', '🥺', '😇', '🤡', '👎',
] as const;

export const REACTION_SET: ReadonlySet<string> = new Set(REACTIONS);
