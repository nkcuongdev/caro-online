/**
 * Internal (server-only) domain model. Never sent to clients as-is:
 * see `rooms/serialize.ts` for the public snapshot.
 */

export type Mark = 'X' | 'O';
export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';
export type FinishReason = 'five' | 'timeout' | 'resign' | 'abandoned' | 'left' | 'draw';
/**
 * `pvp`: two people. `bot`: one person against the server-side bot (unranked).
 * `tournament`: one match of a tournament bracket; both seats are assigned by the server.
 */
export type RoomMode = 'pvp' | 'bot' | 'tournament';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
/** Who plays X (X always moves first) in each round of a bot room. */
export type BotFirstMove = 'human' | 'bot' | 'random';

/** Board sizes a room can be created with. Chosen by the host; fixed for the room's lifetime. */
export const BOARD_SIZES = [15, 20, 30] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

/** Seconds per turn a room can be created with. */
export const TURN_SECONDS = [15, 30, 60] as const;
export type TurnSeconds = (typeof TURN_SECONDS)[number];

/** Chosen by the host when the room is created; fixed for the room's lifetime. */
export interface RoomSettings {
  boardSize: BoardSize;
  turnMs: number;
}

export interface BotSettings {
  difficulty: BotDifficulty;
  firstMove: BotFirstMove;
}

export interface Move {
  index: number;
  mark: Mark;
  seq: number;
  at: number;
}

export interface GameState {
  size: number;
  board: (Mark | null)[];
  moves: Move[];
  currentTurn: Mark;
  /** Epoch ms when moves become legal (end of the 3-2-1 countdown). */
  startAt: number;
  turnStartedAt: number;
  /** Epoch ms when the current player's turn expires. Meaningless while `pausedRemainingMs` is set. */
  deadline: number;
  /**
   * Set while the clock is frozen because the player on turn is offline: the
   * turn time they still have. The disconnect-forfeit countdown keeps running.
   */
  pausedRemainingMs: number | null;
  finished: boolean;
  winner: Mark | null;
  loser: Mark | null;
  reason: FinishReason | null;
  winLine: number[] | null;
  finishedAt: number | null;
}

export interface Player {
  id: string;
  /** Secret reconnect credential. Only ever sent to the player who owns it. */
  token: string;
  name: string;
  /** See avatars/avatars.ts for the format. `null` = client picks a default from the player id. */
  avatar: string | null;
  mark: Mark | null;
  wins: number;
  online: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
  /** When an offline player automatically forfeits the running game. */
  forfeitAt: number | null;
  joinedAt: number;
  /** Server-controlled seat: always online, never has a socket, moves on its own. */
  isBot: boolean;
  /**
   * Account of the person in this seat, if they're signed in (null = guest).
   * Follows the socket's identity: set on create/join/reconnect and when the
   * player logs in or out mid-room. Server-only; clients just see `registered`.
   */
  userId: string | null;
  /** Equipped title of that account (cosmetic, public). Follows `userId` and live equip changes. */
  titleId: string | null;
  /** Equipped name style id of that account (cosmetic, public). Always a catalogue id: `default` for guests and bots. */
  nameStyle: string;
  /** Equipped avatar frame id of that account (cosmetic, public). Always a catalogue id: `frame_default` for guests and bots. */
  avatarFrame: string;
}

export interface Room {
  id: string;
  mode: RoomMode;
  /** Set when `mode` is `bot`. */
  bot: BotSettings | null;
  /** Side length of the board, the same for every round played in this room. */
  boardSize: BoardSize;
  /** Time each player has per move. */
  turnMs: number;
  /** Monotonic counter, bumped on every committed change. Lets clients drop stale snapshots. */
  version: number;
  status: RoomStatus;
  round: number;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  players: Player[];
  game: GameState | null;
  rematchVotes: string[];
  /** Players who pressed "ready" while the room is WAITING. A pvp match starts once both have. */
  readyVotes: string[];
  spectators: string[];
  /** Set when `mode` is `tournament`: which bracket match this room plays. */
  tournament?: RoomTournamentLink | null;
}

export interface RoomTournamentLink {
  id: string;
  name: string;
  matchId: string;
  /** 0-based round of the match, out of `totalRounds` (the last one is the final). */
  round: number;
  totalRounds: number;
  /** Games in the series (1, 3 or 5): first to win a majority takes the match. Room `wins` are the series score. */
  bestOf: number;
}
