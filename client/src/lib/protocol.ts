/** Mirror of server/src/protocol.ts — keep in sync. */
import type { PublicTitle } from './titles';

export type Mark = 'X' | 'O';
export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';
export type FinishReason = 'five' | 'timeout' | 'resign' | 'abandoned' | 'left' | 'draw';
export type RoomMode = 'pvp' | 'bot' | 'tournament';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type BotFirstMove = 'human' | 'bot' | 'random';

/** Board sizes a room can be created with (server validates the same list). */
export const BOARD_SIZES = [15, 20, 30] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];
export const DEFAULT_BOARD_SIZE: BoardSize = 20;

/** Seconds per turn a room can be created with (server validates the same list). */
export const TURN_SECONDS = [15, 30, 60] as const;
export type TurnSeconds = (typeof TURN_SECONDS)[number];
export const DEFAULT_TURN_SECONDS: TurnSeconds = 30;

export interface BotSettings {
  difficulty: BotDifficulty;
  firstMove: BotFirstMove;
}

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
  | 'INTERNAL'
  | 'TIMEOUT';

export interface PublicPlayer {
  id: string;
  name: string;
  /** See lib/avatar.ts. `null` = show the player's default (from their id). */
  avatar: string | null;
  mark: Mark | null;
  wins: number;
  online: boolean;
  forfeitAt: number | null;
  isBot: boolean;
  /** Signed in to an account (their games go to their history). */
  registered: boolean;
  /** Equipped title (cosmetic). Missing from servers older than titles. */
  title?: PublicTitle | null;
  /** Equipped name style id (see lib/nameStyles.ts). Missing from servers older than name styles (= default). */
  nameStyle?: string;
  /** Equipped avatar frame id (see lib/avatarFrames.ts). Missing from servers older than frames (= no frame). */
  avatarFrame?: string;
}

export interface PublicGame {
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
  /** Players who confirmed they're ready while the room is WAITING (pvp: both must before the match starts). */
  readyVotes: string[];
  spectatorCount: number;
  serverNow: number;
  config: {
    boardSize: number;
    winLength: number;
    turnMs: number;
    startCountdownMs: number;
    disconnectForfeitMs: number;
  };
  /** Set for tournament rooms: the bracket match this room plays. */
  tournament?: RoomTournamentLink | null;
}

export interface RoomTournamentLink {
  id: string;
  name: string;
  matchId: string;
  /** 0-based; `totalRounds - 1` is the final. */
  round: number;
  totalRounds: number;
  /** Games in the series; the room players' `wins` are the series score. */
  bestOf: number;
}

// ─── Tournaments ─────────────────────────────────────────────────────────────

export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
/** Games per match (server validates the same list). */
export const BEST_OF = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OF)[number];
export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;
export type TournamentStatus = 'LOBBY' | 'RUNNING' | 'FINISHED';
export type TournamentMatchStatus = 'PENDING' | 'READY_CHECK' | 'LIVE' | 'DONE';
export type TournamentWinReason = FinishReason | 'walkover' | 'bye';

export interface PublicParticipant {
  id: string;
  name: string;
  avatar: string | null;
  seed: number | null;
  online: boolean;
  isHost: boolean;
  eliminated: boolean;
  left: boolean;
  /** Equipped name style id of the participant's account. Missing = default. */
  nameStyle?: string;
  /** Equipped avatar frame id of the participant's account. Missing = no frame. */
  avatarFrame?: string;
  /** Equipped title of the participant's account. Missing (older server) = none. */
  title?: PublicTitle | null;
}

export interface PublicMatch {
  id: string;
  round: number;
  index: number;
  playerA: string | null;
  playerB: string | null;
  status: TournamentMatchStatus;
  ready: string[];
  readyDeadline: number | null;
  roomId: string | null;
  winnerId: string | null;
  reason: TournamentWinReason | null;
  /** Games played, draws included. */
  games: number;
  /** Series score: games won by playerA / playerB. */
  scoreA: number;
  scoreB: number;
  /** Between games of a series: when the next one starts. */
  nextGameAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TournamentSnapshot {
  id: string;
  name: string;
  version: number;
  status: TournamentStatus;
  size: number;
  minPlayers: number;
  hostId: string | null;
  participants: PublicParticipant[];
  rounds: PublicMatch[][];
  championId: string | null;
  spectatorCount: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  serverNow: number;
  config: { boardSize: number; turnMs: number; readyCheckMs: number; bestOf: number };
}

export interface FinishedResult {
  roomId: string;
  round: number;
  mode: RoomMode;
  winner: Mark | null;
  loser: Mark | null;
  reason: FinishReason;
  winLine: number[] | null;
  players: { id: string; name: string; avatar: string | null; mark: Mark | null; wins: number; title?: PublicTitle | null; nameStyle?: string; avatarFrame?: string }[];
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

export interface MovePayload {
  roomId: string;
  round: number;
  index: number;
  mark: Mark;
  seq: number;
  playerId: string;
}

export type AckFailure = { ok: false; error: ErrorCode; message: string };
export type Ack<T> = ({ ok: true } & T) | AckFailure;

export interface SessionAck {
  role: 'player' | 'spectator';
  playerId?: string;
  token?: string;
  state: RoomSnapshot;
}

// ─── In-match communication ──────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  roomId: string;
  playerId: string;
  name: string;
  /** Sender's avatar when sent; prefer the live one from the room. */
  avatar: string | null;
  /** Plain text: always render as a text node, never as HTML. */
  text: string;
  /** Sticker id (see lib/stickers.ts); `text` is empty then. */
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

export type VoiceSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit | null };

export interface VoiceSignalEvent {
  roomId: string;
  from: string;
  signal: VoiceSignal;
}

/** `voice:ice` reply. `null` = the server has no TURN configured; use the built-in list. */
export interface VoiceIceResponse {
  iceServers: RTCIceServer[] | null;
}

/** A spectator in the stands. `id` is per connection, never a player id. */
export interface StandsViewer {
  id: string;
  name: string;
  avatar: string | null;
}

/** An emoji or sticker from the stands, floating over the board for everyone. */
export interface StandsHype {
  id: string;
  roomId: string;
  viewerId: string;
  name: string;
  emoji?: string;
  sticker?: string;
  /** Player the sender cheers for (their reactions float from that side). */
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
