/**
 * Wire protocol shared with the client (mirrored in client/src/lib/protocol.ts).
 */
import type { PublicTitle } from './titles/titles.js';
import type { BotSettings, FinishReason, Mark, RoomMode, RoomStatus, RoomTournamentLink } from './types.js';

export type { PublicTitle };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'INVALID_SESSION'
  | 'SESSION_ACTIVE'
  | 'NOT_IN_ROOM'
  | 'NOT_A_PLAYER'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_NOT_STARTED'
  | 'TIME_UP'
  | 'NOT_YOUR_TURN'
  | 'INVALID_CELL'
  | 'STALE_MOVE'
  | 'CELL_TAKEN'
  | 'REMATCH_UNAVAILABLE'
  | 'READY_UNAVAILABLE'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'NO_OPPONENT'
  | 'TOURNAMENT_NOT_FOUND'
  | 'TOURNAMENT_FULL'
  | 'TOURNAMENT_STARTED'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_IN_TOURNAMENT'
  | 'MATCH_NOT_READY'
  | 'AUTH_INVALID'
  | 'INTERNAL';

export interface PublicPlayer {
  id: string;
  name: string;
  /** `preset:<id>`, an uploaded image URL, or null (client falls back to a default). */
  avatar: string | null;
  mark: Mark | null;
  wins: number;
  online: boolean;
  forfeitAt: number | null;
  isBot: boolean;
  /** Signed in to an account (its games go to their history). Never says which account. */
  registered: boolean;
  /** The account's equipped title (cosmetic). null for guests, bots and players without one. */
  title: PublicTitle | null;
  /** Equipped name style id (cosmetic, see cosmetics/nameStyles.ts). `default` for guests, bots and players without one. */
  nameStyle: string;
  /**
   * Equipped avatar frame id (cosmetic, see cosmetics/avatarFrames.ts). Only the
   * id travels; clients look the look up in their own catalogue.
   * `frame_default` for guests, bots and players without one.
   */
  avatarFrame: string;
}

export interface PublicGame {
  /** Board encoded as a string of `.`, `X`, `O` (row-major). */
  board: string;
  moveCount: number;
  lastMove: { index: number; mark: Mark } | null;
  currentTurn: Mark;
  startAt: number;
  turnStartedAt: number;
  deadline: number;
  /** Set while the clock is frozen because the player on turn is offline: the time they have left. */
  pausedRemainingMs: number | null;
  finished: boolean;
  winner: Mark | null;
  loser: Mark | null;
  reason: FinishReason | null;
  winLine: number[] | null;
  finishedAt: number | null;
}

export interface PublicConfig {
  boardSize: number;
  winLength: number;
  turnMs: number;
  startCountdownMs: number;
  disconnectForfeitMs: number;
}

export interface RoomSnapshot {
  id: string;
  mode: RoomMode;
  bot: BotSettings | null;
  version: number;
  status: RoomStatus;
  round: number;
  players: PublicPlayer[];
  game: PublicGame | null;
  rematchVotes: string[];
  /** Players who confirmed they're ready while the room is WAITING. */
  readyVotes: string[];
  spectatorCount: number;
  serverNow: number;
  config: PublicConfig;
  /** Set for tournament rooms: the bracket match this room plays. */
  tournament: RoomTournamentLink | null;
}

// ─── Tournaments ─────────────────────────────────────────────────────────────

export type TournamentStatus = 'LOBBY' | 'RUNNING' | 'FINISHED';
export type TournamentMatchStatus = 'PENDING' | 'READY_CHECK' | 'LIVE' | 'DONE';
/** How a match was decided: a game result, a no-show at the ready check, or an empty bracket slot. */
export type TournamentWinReason = FinishReason | 'walkover' | 'bye';

export interface PublicParticipant {
  id: string;
  name: string;
  avatar: string | null;
  /** 1 = top seed. Assigned when the host starts the tournament. */
  seed: number | null;
  online: boolean;
  isHost: boolean;
  /** Lost a match (or left) after the start. */
  eliminated: boolean;
  left: boolean;
  /** Equipped name style id of the participant's account; `default` for guests. */
  nameStyle: string;
  /** Equipped avatar frame id of the participant's account; `frame_default` for guests. */
  avatarFrame: string;
  /** Equipped title of the participant's account; null for guests and accounts without one. */
  title: PublicTitle | null;
}

export interface PublicMatch {
  id: string;
  /** 0-based; the last round is the final. */
  round: number;
  /** Position within the round, top to bottom. */
  index: number;
  playerA: string | null;
  playerB: string | null;
  status: TournamentMatchStatus;
  /** Participants who confirmed the ready check. */
  ready: string[];
  readyDeadline: number | null;
  /** Game room playing this match, once it's LIVE. */
  roomId: string | null;
  winnerId: string | null;
  reason: TournamentWinReason | null;
  /** Games played in the room, draws included. */
  games: number;
  /** Series score: games won by playerA / playerB. */
  scoreA: number;
  scoreB: number;
  /** Between games of a series: when the next game starts. */
  nextGameAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TournamentSnapshot {
  id: string;
  name: string;
  version: number;
  status: TournamentStatus;
  /** Bracket size: 4, 8 or 16. */
  size: number;
  /** Players needed before the host can start; missing seats become byes. */
  minPlayers: number;
  hostId: string | null;
  participants: PublicParticipant[];
  /** rounds[0] is the first round; each round has half the matches of the previous one. */
  rounds: PublicMatch[][];
  championId: string | null;
  spectatorCount: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  serverNow: number;
  /** `bestOf`: games per match (1, 3 or 5). */
  config: { boardSize: number; turnMs: number; readyCheckMs: number; bestOf: number };
}

export interface TimerPayload {
  roomId: string;
  round: number;
  currentTurn: Mark;
  deadline: number;
  pausedRemainingMs: number | null;
  remainingMs: number;
  serverNow: number;
}

export type AckFailure = { ok: false; error: ErrorCode; message: string };

// ─── In-match communication (chat, reactions, voice signaling) ───────────────

export interface ChatMessage {
  id: string;
  roomId: string;
  playerId: string;
  /** Sender's name when the message was sent. */
  name: string;
  /** Sender's avatar when the message was sent (clients prefer the live one). */
  avatar: string | null;
  /** Plain text. Clients must render it as text, never as HTML. */
  text: string;
  /** Set for sticker messages (then `text` is empty): an id from comms/stickers.ts. */
  sticker?: string;
  at: number;
}

export interface ReactionEvent {
  id: string;
  roomId: string;
  playerId: string;
  emoji: string;
  at: number;
}

export interface VoiceState {
  enabled: boolean;
  muted: boolean;
}

export interface VoiceStateEvent extends VoiceState {
  roomId: string;
  playerId: string;
}

/** WebRTC signaling, relayed verbatim to the opponent. The server never touches media. */
export type VoiceSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null };

export interface VoiceSignalEvent {
  roomId: string;
  from: string;
  signal: VoiceSignal;
}

/** An RTCIceServer entry (STUN or TURN) handed to a player for their peer connection. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** `voice:ice` reply. `null` = no TURN configured (or it's unreachable); the client uses its built-in STUN list. */
export interface VoiceIceResponse {
  iceServers: IceServer[] | null;
}

/** A spectator in the stands. `id` is per connection and never a player id. */
export interface StandsViewer {
  id: string;
  name: string;
  avatar: string | null;
}

/** An emoji or sticker from the stands, floating over the board for everyone (players included). */
export interface StandsHype {
  id: string;
  roomId: string;
  viewerId: string;
  name: string;
  emoji?: string;
  sticker?: string;
  /** Player the sender cheers for, so clients can float it from that player's side. */
  supports?: string | null;
  at: number;
}

/** Fans per player id. */
export interface StandsCheers {
  roomId: string;
  cheers: Record<string, number>;
}

export interface CommsSync {
  messages: ChatMessage[];
  voice: Record<string, VoiceState>;
}
