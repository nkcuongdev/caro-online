import { z } from 'zod';
import { BOARD_SIZES, TURN_SECONDS } from '../types.js';

const roomId = z.string().regex(/^[A-Za-z0-9]{4,16}$/);
const name = z.string().max(64).optional();
/** Omitted = the server's default size. */
const boardSize = z.union(BOARD_SIZES.map((n) => z.literal(n))).optional();
/** Omitted = the server's default turn time. */
const turnSeconds = z.union(TURN_SECONDS.map((n) => z.literal(n))).optional();
/** Shape only; `normalizeAvatar` decides whether the server accepts the value. */
const avatar = z.string().max(300).optional();

export const schemas = {
  create: z.object({ name, boardSize, turnSeconds, avatar }),
  createBot: z.object({
    name,
    boardSize,
    turnSeconds,
    avatar,
    difficulty: z.enum(['easy', 'medium', 'hard']),
    firstMove: z.enum(['human', 'bot', 'random']).optional().default('random'),
  }),
  join: z.object({ roomId, name, avatar }),
  reconnect: z.object({
    roomId,
    token: z.string().min(16).max(64),
    takeover: z.boolean().optional().default(false),
    avatar,
  }),
  avatar: z.object({ roomId, avatar: z.string().min(1).max(300) }),
  move: z.object({
    roomId,
    index: z.number().int().min(0).max(10_000),
    seq: z.number().int().min(0).max(10_000),
  }),
  roomOnly: z.object({ roomId }),
  rematch: z.object({ roomId, accept: z.boolean().optional().default(true) }),
  ready: z.object({ roomId, ready: z.boolean().optional().default(true) }),
  rename: z.object({ roomId, name: z.string().min(1).max(64) }),
  timeSync: z.object({ t0: z.number().optional() }),
  /** A login token, or null to sign out. */
  identify: z.object({ token: z.string().min(1).max(2048).nullable() }),

  // In-match communication. Loose upper bounds here; the comms hub applies the real rules.
  chat: z.object({ roomId, text: z.string().max(1_000) }),
  sticker: z.object({ roomId, sticker: z.string().max(40) }),
  standsJoin: z.object({ roomId, name, avatar }),
  standsCheer: z.object({ roomId, playerId: z.string().max(32).nullable() }),
  reaction: z.object({ roomId, emoji: z.string().max(16) }),
  voiceState: z.object({ roomId, enabled: z.boolean(), muted: z.boolean().optional().default(false) }),
  voiceSignal: z.object({
    roomId,
    signal: z.discriminatedUnion('type', [
      z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(12_000) }),
      z.object({
        type: z.literal('ice'),
        candidate: z
          .object({
            candidate: z.string().max(1_000),
            sdpMid: z.string().max(64).nullish(),
            sdpMLineIndex: z.number().int().min(0).max(64).nullish(),
            usernameFragment: z.string().max(256).nullish(),
          })
          .nullable(),
      }),
    ]),
  }),
};

/** Sliding-window limiter, one per socket. Returns false once the budget is spent. */
export function createRateLimiter(maxEvents: number, windowMs: number) {
  const hits: number[] = [];
  return () => {
    const now = Date.now();
    while (hits.length && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= maxEvents) return false;
    hits.push(now);
    return true;
  };
}
