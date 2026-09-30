import { customAlphabet, nanoid } from 'nanoid';
import { BOT_AVATARS } from '../avatars/avatars.js';
import { DEFAULT_AVATAR_FRAME, resolveAvatarFrameId } from '../cosmetics/avatarFrames.js';
import { DEFAULT_NAME_STYLE, resolveNameStyleId } from '../cosmetics/nameStyles.js';
import type { AppConfig } from '../config.js';
import { BOT_TIME_BUDGET_MS, chooseBotMove } from '../bot/botEngine.js';
import { applyMove, createGame, finishGame, opposite, pauseClock, resumeClock, type EngineConfig } from '../game/gameEngine.js';
import type { ErrorCode } from '../protocol.js';
import type { TimerManager } from '../timer/timerManager.js';
import type {
  BoardSize,
  BotDifficulty,
  BotSettings,
  FinishReason,
  Mark,
  Move,
  Player,
  Room,
  RoomMode,
  RoomSettings,
  RoomTournamentLink,
} from '../types.js';
import type { PublicTitle } from '../titles/titles.js';
import { sanitizeName } from './names.js';
import { toPublicPlayer } from './serialize.js';
import type { RoomRepository } from './roomRepository.js';

/** No 0/O, 1/l/I: room IDs are read aloud and typed by hand. */
export const ROOM_ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const makeRoomId = customAlphabet(ROOM_ID_ALPHABET, 6);

const BOT_NAMES: Record<BotDifficulty, string> = { easy: 'Bot Dễ', medium: 'Bot Trung Bình', hard: 'Bot Khó' };

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'Phòng này không tồn tại hoặc đã hết hạn.',
  INVALID_SESSION: 'Phiên chơi của bạn trong phòng này không còn hợp lệ.',
  SESSION_ACTIVE: 'Ghế này đang được kết nối từ một tab khác.',
  NOT_IN_ROOM: 'Bạn không ở trong phòng này.',
  NOT_A_PLAYER: 'Chỉ người chơi mới làm được việc này.',
  GAME_NOT_ACTIVE: 'Ván đấu không diễn ra.',
  GAME_NOT_STARTED: 'Ván đấu chưa bắt đầu.',
  TIME_UP: 'Đã hết thời gian của lượt này.',
  NOT_YOUR_TURN: 'Chưa đến lượt của bạn.',
  INVALID_CELL: 'Ô này không tồn tại.',
  STALE_MOVE: 'Bàn cờ đã thay đổi trước khi nước đi của bạn tới máy chủ.',
  CELL_TAKEN: 'Ô này đã có quân.',
  REMATCH_UNAVAILABLE: 'Hiện không thể chơi lại.',
  READY_UNAVAILABLE: 'Chỉ xác nhận sẵn sàng được khi phòng đủ hai người và chưa vào trận.',
  INVALID_PAYLOAD: 'Yêu cầu không hợp lệ.',
  RATE_LIMITED: 'Chậm lại một chút nhé.',
  NO_OPPONENT: 'Đối thủ hiện không có mặt.',
  TOURNAMENT_NOT_FOUND: 'Giải đấu này không tồn tại hoặc đã hết hạn.',
  TOURNAMENT_FULL: 'Giải đấu đã đủ người.',
  TOURNAMENT_STARTED: 'Giải đấu đã bắt đầu, không thể thay đổi nữa.',
  NOT_HOST: 'Chỉ chủ giải mới làm được việc này.',
  NOT_ENOUGH_PLAYERS: 'Chưa đủ người để bắt đầu giải.',
  NOT_IN_TOURNAMENT: 'Bạn không tham gia giải đấu này.',
  MATCH_NOT_READY: 'Trận đấu này hiện không chờ xác nhận sẵn sàng.',
  AUTH_INVALID: 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.',
  INTERNAL: 'Máy chủ gặp sự cố.',
};

export class GameError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'GameError';
  }
}

export interface FinishedResult {
  roomId: string;
  round: number;
  /** Bot games are unranked: reward/rating hooks should skip or discount them. */
  mode: RoomMode;
  winner: Mark | null;
  loser: Mark | null;
  reason: FinishReason;
  winLine: number[] | null;
  /** Players as they were when the game ended (a player who left is no longer in the room). */
  players: { id: string; name: string; avatar: string | null; mark: Mark | null; wins: number; title: PublicTitle | null; nameStyle: string; avatarFrame: string }[];
}

/** Domain events. The socket layer turns these into Socket.IO emits. */
export interface RoomEventSink {
  state(room: Room): void;
  playerJoined(room: Room, player: Player): void;
  gameStarted(room: Room): void;
  move(room: Room, move: Move, player: Player): void;
  turn(room: Room): void;
  timer(room: Room): void;
  finished(room: Room, result: FinishedResult): void;
  playerDisconnected(room: Room, player: Player): void;
  playerReconnected(room: Room, player: Player): void;
  closed(roomId: string): void;
}

/** Per-operation unit of work: events are only flushed after the room is persisted. */
class Tx {
  changed = true;
  deleted = false;
  error: GameError | null = null;
  readonly events: Array<() => void> = [];
  emit(fn: () => void) {
    this.events.push(fn);
  }
}

export type JoinResult =
  | { role: 'player'; room: Room; player: Player }
  | { role: 'spectator'; room: Room };

/** One bracket match to be played in its own room. Seats are pre-assigned to these participants. */
export interface TournamentRoomSpec {
  link: RoomTournamentLink;
  boardSize: BoardSize;
  turnMs: number;
  /** Time until the first legal move (covers navigation + the 3-2-1 countdown). */
  startDelayMs: number;
  /** `id`/`token` are the participant's, so the tournament session also unlocks the seat. */
  players: { id: string; token: string; name: string; avatar: string | null; nameStyle?: string; avatarFrame?: string }[];
}

/** Server-only view of a seat at the end of a game: `token` and `userId` must never reach clients. */
export interface FinishedSeat {
  id: string;
  token: string;
  userId: string | null;
  name: string;
  avatar: string | null;
  mark: Mark | null;
  isBot: boolean;
}

/** What a seat shows of its account's collection. */
export interface SeatCosmetics {
  titleId: string | null;
  /** Always a catalogue id (`default` when none). */
  nameStyle: string;
  /** Always a catalogue id (`frame_default` when none). */
  avatarFrame: string;
}

const NO_COSMETICS: SeatCosmetics = { titleId: null, nameStyle: DEFAULT_NAME_STYLE, avatarFrame: DEFAULT_AVATAR_FRAME };
const sameCosmetics = (p: SeatCosmetics, c: SeatCosmetics) => p.titleId === c.titleId && p.nameStyle === c.nameStyle && p.avatarFrame === c.avatarFrame;

export type RoomFinishListener = (room: Room, result: FinishedResult, seats: FinishedSeat[]) => void;

export class RoomManager {
  private locks = new Map<string, Promise<void>>();
  private finishListeners: RoomFinishListener[] = [];
  /** Looks up an account's equipped cosmetics. Set by the app; without it seats simply show none. */
  private cosmeticsOf: (userId: string) => SeatCosmetics = () => NO_COSMETICS;

  constructor(
    private readonly repo: RoomRepository,
    private readonly timers: TimerManager,
    private readonly sink: RoomEventSink,
    private readonly cfg: AppConfig,
    private readonly now: () => number = Date.now,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Where seats get their account's equipped title, name style and avatar frame from (the accounts database). */
  setCosmeticsResolver(resolve: (userId: string) => SeatCosmetics) {
    this.cosmeticsOf = resolve;
  }

  /**
   * An account changed an equipped cosmetic (title, name style, avatar frame): every seat it
   * holds shows the new look at once (a room:state broadcast reaches opponents
   * and spectators). Cosmetic only; the game, clock and turn are untouched.
   */
  async refreshCosmetics(userId: string) {
    const next = this.lookupCosmetics(userId);
    const stale = (p: Player) => p.userId === userId && !sameCosmetics(p, next);
    for (const room of await this.repo.list()) {
      if (!room.players.some(stale)) continue;
      await this.withRoom(room.id, (r, tx) => {
        const seats = r.players.filter(stale);
        tx.changed = seats.length > 0;
        for (const p of seats) Object.assign(p, next);
      }).catch((err) => {
        if (!(err instanceof GameError)) console.error('[room] cosmetics refresh failed', err);
      });
    }
  }

  /** `avatar` must already be normalized (see avatars/avatars.ts). */
  async createRoom(
    name: string | undefined,
    socketId: string,
    settings: Partial<RoomSettings> = {},
    avatar: string | null = null,
    userId: string | null = null,
  ) {
    let id = makeRoomId();
    while (await this.repo.exists(id)) id = makeRoomId();
    const now = this.now();
    const player = this.seatAccount(this.newPlayer(name, socketId, now, avatar), userId);
    const room: Room = {
      id,
      mode: 'pvp',
      bot: null,
      ...this.settingsOrDefaults(settings),
      version: 1,
      status: 'WAITING',
      round: 0,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      players: [player],
      game: null,
      rematchVotes: [],
      readyVotes: [],
      spectators: [],
    };
    await this.repo.save(room);
    return { room, player };
  }

  /** A private room against the server-side bot. The game starts right away. */
  async createBotRoom(
    name: string | undefined,
    socketId: string,
    bot: BotSettings,
    settings: Partial<RoomSettings> = {},
    avatar: string | null = null,
    userId: string | null = null,
  ) {
    let id = makeRoomId();
    while (await this.repo.exists(id)) id = makeRoomId();
    const now = this.now();
    const player = this.seatAccount(this.newPlayer(name, socketId, now, avatar), userId);
    const botPlayer: Player = { ...this.newPlayer(BOT_NAMES[bot.difficulty], null, now, BOT_AVATARS[bot.difficulty]), isBot: true };
    const room: Room = {
      id,
      mode: 'bot',
      bot: { ...bot },
      ...this.settingsOrDefaults(settings),
      version: 1,
      status: 'WAITING',
      round: 0,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      players: [player, botPlayer],
      game: null,
      rematchVotes: [],
      readyVotes: [],
      spectators: [],
    };
    this.startRound(room, 'fresh');
    await this.repo.save(room);
    return { room, player };
  }

  /**
   * A bracket match. Both seats belong to the given participants (their
   * tournament token reclaims the seat), and the round starts right away: a
   * player who doesn't show up gets the usual disconnect-forfeit countdown.
   */
  async createTournamentRoom(spec: TournamentRoomSpec) {
    let id = makeRoomId();
    while (await this.repo.exists(id)) id = makeRoomId();
    const now = this.now();
    const room: Room = {
      id,
      mode: 'tournament',
      bot: null,
      boardSize: spec.boardSize,
      turnMs: spec.turnMs,
      version: 1,
      status: 'WAITING',
      round: 0,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      players: spec.players.map((p) => ({
        ...this.newPlayer(p.name, null, now, p.avatar),
        // What the participant wore in the lobby, until their own socket takes the seat.
        nameStyle: resolveNameStyleId(p.nameStyle),
        avatarFrame: resolveAvatarFrameId(p.avatarFrame),
        id: p.id,
        token: p.token,
        online: false,
        disconnectedAt: now,
      })),
      game: null,
      rematchVotes: [],
      readyVotes: [],
      spectators: [],
      tournament: { ...spec.link },
    };
    this.startRound(room, 'fresh', spec.startDelayMs);
    await this.repo.save(room);
    return room;
  }

  /** Called with every finished game, after the room is persisted. The tournament bracket listens here. */
  onRoomFinished(listener: RoomFinishListener) {
    this.finishListeners.push(listener);
  }

  /** A drawn bracket match can't send anyone through: play again with sides swapped. */
  replayTournamentRound(roomId: string) {
    return this.withRoom(roomId, (room, tx) => {
      if (room.mode !== 'tournament' || room.status !== 'FINISHED' || room.players.length < 2) {
        tx.changed = false;
        return false;
      }
      this.startRound(room, 'swap');
      return true;
    });
  }

  joinRoom(roomId: string, name: string | undefined, socketId: string, avatar: string | null = null, userId: string | null = null): Promise<JoinResult> {
    return this.withRoom(roomId, (room, tx): JoinResult => {
      // Tournament seats are assigned by the bracket: everyone else watches.
      if (room.players.length >= 2 || room.mode === 'tournament') {
        if (!room.spectators.includes(socketId)) room.spectators.push(socketId);
        return { role: 'spectator', room };
      }
      const player = this.seatAccount(this.newPlayer(name, socketId, this.now(), avatar), userId);
      room.players.push(player);
      room.spectators = room.spectators.filter((s) => s !== socketId);
      if (room.status === 'FINISHED') {
        // Previous opponent left; the remaining player gets a fresh opponent.
        room.status = 'WAITING';
        room.game = null;
        room.rematchVotes = [];
      }
      // A new opponent: everyone confirms again.
      room.readyVotes = [];
      tx.emit(() => this.sink.playerJoined(room, player));
      this.maybeStart(room);
      return { role: 'player', room, player };
    });
  }

  /**
   * `avatar` (normalized) is the browser's current choice, which may have changed since the seat was taken.
   * `userId` is who the reconnecting socket is signed in as now (null = guest).
   */
  reconnect(roomId: string, token: string, socketId: string, takeover: boolean, avatar: string | null = null, userId: string | null = null) {
    return this.withRoom(roomId, (room, tx) => {
      const player = room.players.find((p) => p.token === token);
      if (!player) throw new GameError('INVALID_SESSION');
      const connectedElsewhere = player.online && player.socketId !== null && player.socketId !== socketId;
      if (connectedElsewhere && !takeover) throw new GameError('SESSION_ACTIVE');

      const replacedSocketId = connectedElsewhere ? player.socketId : null;
      const wasOffline = !player.online;
      player.online = true;
      player.socketId = socketId;
      player.disconnectedAt = null;
      player.forfeitAt = null;
      if (avatar) player.avatar = avatar;
      this.seatAccount(player, userId);
      this.timers.clear(this.forfeitKey(room.id, player.id));
      room.spectators = room.spectators.filter((s) => s !== socketId);
      this.syncTurnClock(room);

      if (wasOffline) tx.emit(() => this.sink.playerReconnected(room, player));
      this.maybeStart(room);
      return { room, player, replacedSocketId };
    });
  }

  move(roomId: string, playerId: string, index: number, seq: number) {
    return this.withRoom(roomId, (room, tx) => {
      const player = this.requirePlayer(room, playerId);
      if (room.status !== 'PLAYING' || !room.game || !player.mark) throw new GameError('GAME_NOT_ACTIVE');
      return this.commitMove(room, tx, player, index, seq);
    });
  }

  resign(roomId: string, playerId: string) {
    return this.withRoom(roomId, (room, tx) => {
      const player = this.requirePlayer(room, playerId);
      const game = room.game;
      if (room.status !== 'PLAYING' || !game || game.finished || !player.mark) {
        throw new GameError('GAME_NOT_ACTIVE');
      }
      finishGame(game, opposite(player.mark), 'resign', this.now());
      this.onFinished(room, tx);
    });
  }

  /**
   * Pre-match ready check of a pvp room: the first round starts only once both
   * seated players have confirmed (and are online). `ready: false` withdraws.
   */
  setReady(roomId: string, playerId: string, ready: boolean) {
    return this.withRoom(roomId, (room, tx) => {
      this.requirePlayer(room, playerId);
      if (room.mode !== 'pvp' || room.status !== 'WAITING' || room.players.length < 2) {
        throw new GameError('READY_UNAVAILABLE');
      }
      const was = room.readyVotes.includes(playerId);
      tx.changed = was !== ready;
      room.readyVotes = room.readyVotes.filter((id) => id !== playerId);
      if (ready) room.readyVotes.push(playerId);
      return { started: this.maybeStart(room) };
    });
  }

  rematch(roomId: string, playerId: string, accept: boolean) {
    return this.withRoom(roomId, (room) => {
      this.requirePlayer(room, playerId);
      // The bracket decides what comes after a tournament match.
      if (room.status !== 'FINISHED' || room.players.length < 2 || room.mode === 'tournament') {
        throw new GameError('REMATCH_UNAVAILABLE');
      }
      room.rematchVotes = room.rematchVotes.filter((id) => id !== playerId);
      if (accept) room.rematchVotes.push(playerId);
      // The bot is always up for another round.
      for (const p of room.players) if (accept && p.isBot && !room.rematchVotes.includes(p.id)) room.rematchVotes.push(p.id);
      const everyoneAgreed = room.players.every((p) => room.rematchVotes.includes(p.id));
      if (everyoneAgreed) this.startRound(room, 'swap');
      return { started: everyoneAgreed };
    });
  }

  /** Resolves true when leaving forfeited a game in progress (decided under the room lock). */
  leave(roomId: string, playerId: string) {
    return this.withRoom(roomId, (room, tx) => {
      const idx = room.players.findIndex((p) => p.id === playerId);
      if (idx === -1) throw new GameError('NOT_A_PLAYER');
      const player = room.players[idx];
      const game = room.game;
      const forfeited = !!(room.status === 'PLAYING' && game && !game.finished && player.mark);
      if (forfeited) {
        finishGame(game!, opposite(player.mark!), 'left', this.now());
        this.onFinished(room, tx);
      }
      this.timers.clear(this.forfeitKey(room.id, player.id));
      room.players.splice(idx, 1);
      room.rematchVotes = room.rematchVotes.filter((id) => id !== playerId);
      // Whoever joins next is a new opponent: the one who stays confirms again too.
      room.readyVotes = [];
      // Nobody left to play: a bot room without its person is closed too.
      if (room.players.every((p) => p.isBot)) {
        tx.deleted = true;
        tx.emit(() => this.sink.closed(room.id));
      }
      return forfeited;
    });
  }

  rename(roomId: string, playerId: string, name: string) {
    return this.withRoom(roomId, (room) => {
      const player = this.requirePlayer(room, playerId);
      player.name = sanitizeName(name);
      return player.name;
    });
  }

  /** Cosmetic only: never touches the game, the clock or the turn. The room:state broadcast reaches spectators too. */
  setAvatar(roomId: string, playerId: string, avatar: string) {
    return this.withRoom(roomId, (room, tx) => {
      const player = this.requirePlayer(room, playerId);
      tx.changed = player.avatar !== avatar;
      player.avatar = avatar;
      return player.avatar;
    });
  }

  /**
   * The player signed in or out while seated. Games from now on (including the
   * one in progress) are recorded for the new account; nothing else changes.
   */
  setAccount(roomId: string, playerId: string, userId: string | null) {
    return this.withRoom(roomId, (room, tx) => {
      const player = this.requirePlayer(room, playerId);
      const before = [player.userId, player.titleId, player.nameStyle, player.avatarFrame].join();
      this.seatAccount(player, userId);
      tx.changed = [player.userId, player.titleId, player.nameStyle, player.avatarFrame].join() !== before;
    });
  }

  handleDisconnect(roomId: string, playerId: string, socketId: string) {
    return this.withRoom(roomId, (room, tx) => {
      const player = room.players.find((p) => p.id === playerId);
      // A stale socket (replaced by a newer tab/reload) must not mark the player offline.
      if (!player || player.socketId !== socketId) {
        tx.changed = false;
        return;
      }
      const now = this.now();
      player.online = false;
      player.socketId = null;
      player.disconnectedAt = now;
      // Coming back shouldn't drop them straight into a countdown they didn't confirm.
      room.readyVotes = room.readyVotes.filter((id) => id !== player.id);
      if (room.status === 'PLAYING' && room.game && !room.game.finished) {
        this.startForfeitCountdown(room, player, now);
        this.syncTurnClock(room);
      }
      tx.emit(() => this.sink.playerDisconnected(room, player));
    });
  }

  removeSpectator(roomId: string, socketId: string) {
    return this.withRoom(roomId, (room, tx) => {
      const before = room.spectators.length;
      room.spectators = room.spectators.filter((s) => s !== socketId);
      tx.changed = room.spectators.length !== before;
    });
  }

  async getRoom(roomId: string) {
    return this.repo.get(roomId);
  }

  /** Broadcasts authoritative remaining time for all running games. */
  async tick() {
    const now = this.now();
    for (const room of await this.repo.list()) {
      const g = room.game;
      if (room.status === 'PLAYING' && g && !g.finished && now >= g.startAt) this.sink.timer(room);
    }
  }

  /** Deletes rooms nobody has been connected to for `roomIdleTtlMs`. */
  async sweep() {
    for (const room of await this.repo.list()) {
      if (!this.isIdle(room)) continue;
      await this.lock(room.id, async () => {
        const fresh = await this.repo.get(room.id);
        if (!fresh || !this.isIdle(fresh)) return;
        await this.repo.delete(room.id);
        this.timers.clearPrefix(`${room.id}:`);
        this.sink.closed(room.id);
      });
    }
  }

  async stats() {
    const rooms = await this.repo.list();
    return {
      rooms: rooms.length,
      playing: rooms.filter((r) => r.status === 'PLAYING').length,
      playersOnline: rooms.reduce((n, r) => n + r.players.filter((p) => p.online && !p.isBot).length, 0),
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private isIdle(room: Room) {
    const someoneHere = room.players.some((p) => p.online && !p.isBot) || room.spectators.length > 0;
    return !someoneHere && this.now() - room.lastActiveAt > this.cfg.roomIdleTtlMs;
  }

  private settingsOrDefaults(s: Partial<RoomSettings>): RoomSettings {
    return { boardSize: s.boardSize ?? this.cfg.boardSize, turnMs: s.turnMs ?? this.cfg.turnMs };
  }

  /** Game rules for this room: the server-wide ones plus the host's choices. */
  private engineConfig(room: Room): EngineConfig {
    return { ...this.cfg, boardSize: room.boardSize, turnMs: room.turnMs };
  }

  private newPlayer(name: string | undefined, socketId: string | null, now: number, avatar: string | null): Player {
    return {
      id: nanoid(10),
      token: nanoid(32),
      name: sanitizeName(name),
      avatar,
      mark: null,
      wins: 0,
      online: true,
      socketId,
      disconnectedAt: null,
      forfeitAt: null,
      joinedAt: now,
      isBot: false,
      userId: null,
      titleId: null,
      nameStyle: DEFAULT_NAME_STYLE,
      avatarFrame: DEFAULT_AVATAR_FRAME,
    };
  }

  /** Binds a seat to an account (or to nobody), picking up that account's cosmetics. Guests get none. */
  private seatAccount(player: Player, userId: string | null): Player {
    player.userId = userId;
    Object.assign(player, userId ? this.lookupCosmetics(userId) : NO_COSMETICS);
    return player;
  }

  private lookupCosmetics(userId: string): SeatCosmetics {
    try {
      const c = this.cosmeticsOf(userId);
      return { titleId: c.titleId, nameStyle: resolveNameStyleId(c.nameStyle), avatarFrame: resolveAvatarFrameId(c.avatarFrame) };
    } catch (err) {
      // A cosmetic lookup must never block joining a game.
      console.error('[room] cosmetics lookup failed', err);
      return NO_COSMETICS;
    }
  }

  private requirePlayer(room: Room, playerId: string): Player {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new GameError('NOT_A_PLAYER');
    return player;
  }

  /** A match only starts once both seats are filled and both players are connected and ready. Returns whether it started. */
  private maybeStart(room: Room) {
    const go =
      room.status === 'WAITING' &&
      room.players.length === 2 &&
      room.players.every((p) => p.online && (p.isBot || room.readyVotes.includes(p.id)));
    if (go) this.startRound(room, 'fresh');
    return go;
  }

  private assignMarks(room: Room, mode: 'fresh' | 'swap') {
    const [a, b] = room.players;
    if (room.bot) {
      // Bot rooms honour the chosen first mover every round (X moves first).
      const [human, bot] = a.isBot ? [b, a] : [a, b];
      const first = room.bot.firstMove;
      human.mark = first === 'human' || (first === 'random' && Math.random() < 0.5) ? 'X' : 'O';
      bot.mark = opposite(human.mark);
      return;
    }
    if (mode === 'swap' && a.mark && b.mark && a.mark !== b.mark) {
      a.mark = opposite(a.mark);
      b.mark = opposite(b.mark);
    } else if (a.mark && !b.mark) {
      b.mark = opposite(a.mark);
    } else if (!a.mark && b.mark) {
      a.mark = opposite(b.mark);
    } else if (!(a.mark && b.mark && a.mark !== b.mark)) {
      const first: Mark = Math.random() < 0.5 ? 'X' : 'O';
      a.mark = first;
      b.mark = opposite(first);
    }
  }

  private startRound(room: Room, mode: 'fresh' | 'swap', startDelayMs = this.cfg.startCountdownMs) {
    this.assignMarks(room, mode);
    const now = this.now();
    room.round += 1;
    room.status = 'PLAYING';
    room.rematchVotes = [];
    room.readyVotes = [];
    room.game = createGame(this.engineConfig(room), now + startDelayMs);

    const round = room.round;
    this.timers.schedule(this.key(room.id, 'start'), room.game.startAt, () => {
      this.run(room.id, (r, tx) => {
        tx.changed = false;
        if (r.round === round && r.status === 'PLAYING' && r.game && !r.game.finished) {
          tx.emit(() => this.sink.gameStarted(r));
        }
      });
    });
    this.syncTurnClock(room);
    this.scheduleBotMove(room);
    for (const p of room.players) if (!p.online) this.startForfeitCountdown(room, p, now);
  }

  /** Applies one move for `player` and advances the turn. Shared by people and the bot. */
  private commitMove(room: Room, tx: Tx, player: Player, index: number, seq: number): Move | null {
    const game = room.game!;
    const now = this.now();
    const result = applyMove(game, this.engineConfig(room), player.mark!, index, seq, now);
    if (!result.ok) {
      if (result.error === 'TIME_UP') {
        // The timeout timer hasn't fired yet (event loop was busy); settle it now.
        finishGame(game, opposite(game.currentTurn), 'timeout', now);
        this.onFinished(room, tx);
        tx.error = new GameError('TIME_UP');
        return null;
      }
      throw new GameError(result.error);
    }

    tx.emit(() => this.sink.move(room, result.move, player));
    if (game.finished) {
      this.onFinished(room, tx);
    } else {
      this.syncTurnClock(room);
      this.scheduleBotMove(room);
      tx.emit(() => this.sink.turn(room));
    }
    return result.move;
  }

  /**
   * On the bot's turn, plays after a short "thinking" pause. The pause includes
   * the bot's compute budget, so the move lands within [botMinDelayMs,
   * botMaxDelayMs] of the turn starting. Meanwhile the person can't move: it
   * isn't their turn, so the engine rejects it.
   */
  private scheduleBotMove(room: Room) {
    const game = room.game;
    const bot = room.players.find((p) => p.isBot);
    if (!room.bot || !game || game.finished || !bot || bot.mark !== game.currentTurn) return;

    const { difficulty } = room.bot;
    const budget = BOT_TIME_BUDGET_MS[difficulty];
    const { botMinDelayMs: min, botMaxDelayMs: max } = this.cfg;
    const delay = min + Math.random() * Math.max(0, max - budget - min);
    const round = room.round;
    const seq = game.moves.length;
    this.timers.schedule(this.key(room.id, 'bot'), Math.max(this.now(), game.startAt) + delay, () => {
      this.run(room.id, (r, tx) => {
        const g = r.game;
        const b = r.players.find((p) => p.isBot);
        // Guard against a timer that outlived its turn.
        if (r.round !== round || !g || g.finished || g.moves.length !== seq || !b?.mark || b.mark !== g.currentTurn) {
          tx.changed = false;
          return;
        }
        const index = chooseBotMove(g.board, g.size, b.mark, difficulty, { timeLimitMs: budget });
        this.commitMove(r, tx, b, index, seq);
      });
    });
  }

  /**
   * The turn clock only runs while the player on turn is connected: when they
   * drop it freezes with their remaining time (the disconnect-forfeit countdown
   * still runs), and it picks up where it left off once they're back. Call
   * after anything that changes who is on turn or who is online.
   */
  private syncTurnClock(room: Room) {
    const game = room.game;
    if (room.status !== 'PLAYING' || !game || game.finished) return;
    const now = this.now();
    const onTurn = room.players.find((p) => p.mark === game.currentTurn);
    // A turn already past its deadline (timer due within the latency grace) can't be rescued by dropping.
    const canPause = game.pausedRemainingMs !== null || game.deadline > now;
    if (onTurn && !onTurn.online && canPause) {
      pauseClock(game, now);
      this.timers.clear(this.key(room.id, 'turn'));
    } else {
      resumeClock(game, now);
      this.scheduleTurnTimer(room);
    }
  }

  private scheduleTurnTimer(room: Room) {
    const game = room.game!;
    const round = room.round;
    const seq = game.moves.length;
    this.timers.schedule(this.key(room.id, 'turn'), game.deadline + this.cfg.moveGraceMs, () => {
      this.run(room.id, (r, tx) => {
        const g = r.game;
        // Guard against a timer that outlived its turn (or a clock that has since been paused).
        if (r.round !== round || !g || g.finished || g.moves.length !== seq || g.pausedRemainingMs !== null) {
          tx.changed = false;
          return;
        }
        finishGame(g, opposite(g.currentTurn), 'timeout', this.now());
        this.onFinished(r, tx);
      });
    });
  }

  private startForfeitCountdown(room: Room, player: Player, now: number) {
    const round = room.round;
    player.forfeitAt = now + this.cfg.disconnectForfeitMs;
    this.timers.schedule(this.forfeitKey(room.id, player.id), player.forfeitAt, () => {
      this.run(room.id, (r, tx) => {
        const p = r.players.find((x) => x.id === player.id);
        const g = r.game;
        if (!p || p.online || !p.mark || r.round !== round || !g || g.finished) {
          tx.changed = false;
          return;
        }
        finishGame(g, opposite(p.mark), 'abandoned', this.now());
        this.onFinished(r, tx);
      });
    });
  }

  private onFinished(room: Room, tx: Tx) {
    const game = room.game!;
    room.status = 'FINISHED';
    room.rematchVotes = [];
    this.timers.clear(this.key(room.id, 'turn'));
    this.timers.clear(this.key(room.id, 'start'));
    this.timers.clear(this.key(room.id, 'bot'));
    for (const p of room.players) {
      this.timers.clear(this.forfeitKey(room.id, p.id));
      p.forfeitAt = null;
    }
    if (game.winner) {
      const winner = room.players.find((p) => p.mark === game.winner);
      if (winner) winner.wins += 1;
    }
    const result: FinishedResult = {
      roomId: room.id,
      round: room.round,
      mode: room.mode,
      winner: game.winner,
      loser: game.loser,
      reason: game.reason!,
      winLine: game.winLine,
      players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, mark: p.mark, wins: p.wins, title: toPublicPlayer(p).title, nameStyle: p.nameStyle, avatarFrame: p.avatarFrame })),
    };
    const seats: FinishedSeat[] = room.players.map((p) => ({
      id: p.id,
      token: p.token,
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      mark: p.mark,
      isBot: p.isBot,
    }));
    tx.emit(() => this.sink.finished(room, result));
    for (const listener of this.finishListeners) {
      tx.emit(() => {
        try {
          listener(room, result, seats);
        } catch (err) {
          console.error('[room] finish listener failed', err);
        }
      });
    }
  }

  private key(roomId: string, kind: 'turn' | 'start' | 'bot') {
    return `${roomId}:${kind}`;
  }

  private forfeitKey(roomId: string, playerId: string) {
    return `${roomId}:forfeit:${playerId}`;
  }

  /** Fire-and-forget variant for timer callbacks. */
  private run(roomId: string, fn: (room: Room, tx: Tx) => void) {
    this.withRoom(roomId, fn).catch((err) => {
      if (!(err instanceof GameError)) console.error('[room timer]', err);
    });
  }

  /**
   * Loads the room, runs `fn` under the room's lock, persists, then flushes
   * events. All mutations of a room go through here, which is what makes
   * concurrent socket events (spam clicks, simultaneous moves) safe.
   */
  private withRoom<T>(roomId: string, fn: (room: Room, tx: Tx) => T | Promise<T>): Promise<T> {
    return this.lock(roomId, async () => {
      const room = await this.repo.get(roomId);
      if (!room) throw new GameError('ROOM_NOT_FOUND');
      const tx = new Tx();
      const result = await fn(room, tx);

      if (tx.deleted) {
        await this.repo.delete(roomId);
        this.timers.clearPrefix(`${roomId}:`);
      } else if (tx.changed) {
        const now = this.now();
        room.version += 1;
        room.updatedAt = now;
        room.lastActiveAt = now;
        await this.repo.save(room);
        tx.emit(() => this.sink.state(room));
      }
      for (const emit of tx.events) emit();
      if (tx.error) throw tx.error;
      return result;
    });
  }

  private lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
