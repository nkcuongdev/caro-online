import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient, type Client, type InArgs, type InValue, type Transaction, type Value } from '@libsql/client';
import { nanoid } from 'nanoid';
import type { RewardSource } from '../rewards/rewardService.js';
import type { BotDifficulty, FinishReason, Mark, RoomMode } from '../types.js';

/**
 * Durable storage for accounts, login sessions and match history, in SQLite
 * through libSQL: a Turso database in production (`libsql://…` URL plus an auth
 * token), a local file (`data/caro.db`) or `:memory:` in development and tests.
 * The SQL is the same everywhere.
 *
 * Rooms and timers stay in memory as before; only finished games and profiles
 * are written here. Every call is async because a Turso query is a network
 * round trip; `transaction()` groups writes that must land together.
 *
 * The database is opened on first use, so a server (or test) that never
 * touches accounts never creates it.
 */

export type MatchResult = 'win' | 'loss' | 'draw';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  nickname: string;
  avatar: string | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  /** Soft currency. Only ever changed server-side (achievement rewards). */
  coins: number;
  /** Title shown next to the name. Always one the user owns (enforced when it is set). */
  equippedTitleId: string | null;
  /**
   * Equipped name style id, or null (= `default`). Only set when the user owns
   * that style: the read checks `user_cosmetics`, so a stale id never shows.
   * It may still name a retired style; resolve it through the catalogue.
   */
  nameStyleId: string | null;
  /**
   * Equipped avatar frame id, or null (= `frame_default`). Same rule as
   * `nameStyleId`: only set while the user owns that frame (USER_SELECT checks
   * `user_cosmetics`); it may still name a retired frame, so resolve it through
   * the catalogue.
   */
  avatarFrameId: string | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/** One finished game from one player's point of view. */
export interface MatchRecord {
  roomId: string;
  round: number;
  mode: RoomMode;
  result: MatchResult;
  reason: FinishReason;
  myMark: Mark | null;
  myName: string;
  myAvatar: string | null;
  opponentName: string | null;
  opponentAvatar: string | null;
  opponentIsBot: boolean;
  /** Set when the opponent was signed in too. Never sent to clients. */
  opponentUserId: string | null;
  botDifficulty: BotDifficulty | null;
  boardSize: number;
  turnMs: number;
  /** Cell indices in play order; X always moves first. */
  moves: number[];
  winLine: number[] | null;
  startedAt: number;
  finishedAt: number;
  tournamentId: string | null;
  tournamentName: string | null;
  tournamentRound: number | null;
  tournamentTotalRounds: number | null;
}

export interface StoredMatch extends MatchRecord {
  id: number;
}

export interface ModeStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** 0–100, rounded to one decimal. 0 with no games. */
  winRate: number;
}

export interface PlayerStats {
  overall: ModeStats;
  byMode: Record<RoomMode, ModeStats>;
  botWins: Record<BotDifficulty, number>;
  currentStreak: { result: MatchResult | null; count: number };
  bestWinStreak: number;
  tournamentTitles: number;
  /** Moves by both players, summed over every game. */
  totalMoves: number;
  /** Your own moves, summed over every game. */
  movesPlayed: number;
  /** Most moves (both players) in a single game. */
  longestGameMoves: number;
  totalPlayMs: number;
  /** Fewest of your own moves in a five-in-a-row win. */
  fastestWinMoves: number | null;
  /** Wins by five in a row (not by timeout, resignation, …). */
  winsByFive: number;
  /** Wins playing O, the side that moves second. */
  winsAsO: number;
  /** Different signed-in opponents beaten (guests have no identity to count). */
  distinctOpponentsBeaten: number;
  favoriteBoardSize: number | null;
  /** Most recent first, at most 10. */
  recentForm: MatchResult[];
  xp: number;
  level: number;
  /** XP at the start of this level and at the next one. */
  levelFloorXp: number;
  nextLevelXp: number;
}

const SCHEMA_VERSION = 5;

/** Exported for the upgrade tests (an old database must migrate in place). */
export const MIGRATIONS: Readonly<Record<number, string>> = {
  1: `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX sessions_by_user ON sessions(user_id);
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      reason TEXT NOT NULL,
      my_mark TEXT,
      my_name TEXT NOT NULL,
      my_avatar TEXT,
      opponent_name TEXT,
      opponent_avatar TEXT,
      opponent_is_bot INTEGER NOT NULL DEFAULT 0,
      opponent_user_id TEXT,
      bot_difficulty TEXT,
      board_size INTEGER NOT NULL,
      turn_ms INTEGER NOT NULL,
      move_count INTEGER NOT NULL,
      moves TEXT NOT NULL,
      win_line TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      tournament_id TEXT,
      tournament_name TEXT,
      tournament_round INTEGER,
      tournament_total_rounds INTEGER,
      UNIQUE (user_id, room_id, round, started_at)
    );
    CREATE INDEX matches_by_user ON matches(user_id, finished_at DESC, id DESC);
  `,
  // Achievements + the coin balance they reward. Existing users start at 0 coins;
  // their achievements are backfilled from the match history on the next check.
  2: `
    ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE user_achievements (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      reward_claimed INTEGER NOT NULL DEFAULT 0,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, achievement_id)
    );
  `,
  // Titles. Ownership is its own table (achievements are only one way to get a
  // title); only ids are stored, the catalogue holds names and looks. Existing
  // users start with no titles and nothing equipped; titles for achievements
  // they already completed are backfilled on their next achievement check.
  3: `
    ALTER TABLE users ADD COLUMN equipped_title_id TEXT;
    CREATE TABLE user_titles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      PRIMARY KEY (user_id, title_id)
    );
  `,
  // Name styles. Ownership lives in a general cosmetics inventory (`kind` says
  // which catalogue `item_id` belongs to), so later cosmetics reuse the table.
  // `default` is owned by everyone and has no row. NULL name_style_id = default,
  // so existing accounts need no data change.
  4: `
    ALTER TABLE users ADD COLUMN name_style_id TEXT;
    CREATE TABLE user_cosmetics (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      cost INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, kind, item_id)
    );
  `,
  // Avatar frames. Owned frames reuse `user_cosmetics` (kind `avatar_frame`);
  // `frame_default` is owned by everyone and has no row. NULL avatar_frame_id =
  // `frame_default`, so existing accounts (and their history) need no data change.
  5: `
    ALTER TABLE users ADD COLUMN avatar_frame_id TEXT;
  `,
};

/** Catalogues whose items live in `user_cosmetics`. */
export type CosmeticKind = 'name_style' | 'avatar_frame';

export interface UserCosmeticRow {
  itemId: string;
  acquiredAt: number;
  /** `coin`, `achievement`, … */
  sourceType: string;
  sourceId: string | null;
  /** Coins paid (0 when granted). */
  cost: number;
}

export type PurchaseOutcome = 'OK' | 'ALREADY_OWNED' | 'NOT_ENOUGH_COIN';

/** Users plus whether their stored name style / avatar frame is actually owned (see UserRow.nameStyleId, avatarFrameId). */
const USER_SELECT = `SELECT u.*, EXISTS (
    SELECT 1 FROM user_cosmetics c WHERE c.user_id = u.id AND c.kind = 'name_style' AND c.item_id = u.name_style_id
  ) AS name_style_owned, EXISTS (
    SELECT 1 FROM user_cosmetics c WHERE c.user_id = u.id AND c.kind = 'avatar_frame' AND c.item_id = u.avatar_frame_id
  ) AS avatar_frame_owned FROM users u`;

type Row = Record<string, Value>;
type Stmt = { sql: string; args?: InArgs };

/**
 * Serializes async work: each `run` starts once the previous one settled. A
 * local libSQL database refuses a statement while a transaction holds its
 * connection (it doesn't queue), so local access goes through one of these.
 */
class Lock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

/** `libsql://…`, `https://…`, `wss://…`, `file:…` pass through; `:memory:` and plain paths are local. */
function toUrl(location: string): { url: string; local: boolean } {
  if (location === ':memory:') return { url: ':memory:', local: true };
  if (/^file:/i.test(location)) return { url: location, local: true };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return { url: location, local: false };
  mkdirSync(dirname(location), { recursive: true });
  return { url: `file:${location}`, local: true };
}

const emptyMode = (): ModeStats => ({ games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });

export interface UserAchievementRow {
  achievementId: string;
  unlockedAt: number;
  rewardClaimed: boolean;
  rewardCoins: number;
}

export interface UserTitleRow {
  titleId: string;
  unlockedAt: number;
  sourceType: string;
  sourceId: string | null;
}

/** Casual progression: every game earns something, wins the most. Bot games count half. */
const XP = { win: 30, draw: 15, loss: 10 } as const;
/** Level n starts at 50·n·(n−1) XP: 0, 100, 300, 600, 1000, … */
export const levelFloor = (level: number) => 50 * level * (level - 1);
export function levelFor(xp: number) {
  let level = 1;
  while (levelFloor(level + 1) <= xp) level += 1;
  return level;
}

export class AccountStore {
  private client: Client | null = null;
  private opening: Promise<Client> | null = null;
  private readonly local: boolean;
  private readonly url: string;
  /** The transaction the current async call chain runs in, if any (see `transaction`). */
  private readonly tx = new AsyncLocalStorage<Transaction>();
  /** Transactions run one at a time; locally, plain statements wait for them too (see Lock). */
  private readonly lock = new Lock();

  constructor(
    /** `libsql://…` (Turso), `file:…`, `:memory:` or a file path. */
    location: string,
    private readonly now: () => number = Date.now,
    /** Turso auth token for a remote database. */
    private readonly authToken?: string,
  ) {
    ({ url: this.url, local: this.local } = toUrl(location));
  }

  /** Where the database lives, for the boot log (the token is never included). */
  get location() {
    return this.url;
  }

  /** Opens (and migrates) the database. Called lazily; call it at boot to fail fast. */
  open(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.opening ??= this.connect().then(
      (client) => (this.client = client),
      (err) => {
        this.opening = null;
        throw err;
      },
    );
    return this.opening;
  }

  private async connect(): Promise<Client> {
    const client = createClient({ url: this.url, authToken: this.authToken, intMode: 'number' });
    try {
      if (this.local) {
        await client.execute('PRAGMA foreign_keys = ON');
        if (this.url !== ':memory:') await client.execute('PRAGMA journal_mode = WAL');
      }
      for (let v = (await this.schemaVersion(client)) + 1; v <= SCHEMA_VERSION; v++) {
        const tx = await client.transaction('write');
        try {
          await tx.executeMultiple(MIGRATIONS[v]);
          await tx.execute({ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", args: [String(v)] });
          await tx.commit();
        } finally {
          tx.close();
        }
      }
      return client;
    } catch (err) {
      client.close();
      throw err;
    }
  }

  /**
   * The applied migration, kept in `meta` (a Turso database may not persist
   * `PRAGMA user_version`). Local files created before this read it from
   * `user_version`, where the synchronous store used to keep it.
   */
  private async schemaVersion(client: Client): Promise<number> {
    const hasMeta = (await client.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")).rows.length > 0;
    if (hasMeta) {
      const row = (await client.execute("SELECT value FROM meta WHERE key = 'schema_version'")).rows[0];
      if (row) return Number(row.value);
    }
    try {
      return Number((await client.execute('PRAGMA user_version')).rows[0]?.user_version ?? 0);
    } catch {
      return 0;
    }
  }

  async close() {
    const client = this.client ?? (await this.opening?.catch(() => null));
    this.client = null;
    this.opening = null;
    client?.close();
  }

  /**
   * Runs `fn` in one write transaction (committed if it resolves, rolled back if
   * it throws). Every store call awaited inside it joins the transaction, and
   * so do nested `transaction` calls. Await only store calls inside: the
   * transaction holds the write lock until `fn` settles.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const client = await this.open();
    return this.lock.run(async () => {
      const tx = await client.transaction('write');
      try {
        const result = await this.tx.run(tx, fn);
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    });
  }

  private async execute(sql: string, args: InValue[] = []) {
    const inTx = this.tx.getStore();
    if (inTx) return inTx.execute({ sql, args });
    const client = await this.open();
    return this.local ? this.lock.run(() => client.execute({ sql, args })) : client.execute({ sql, args });
  }

  /** Several reads in one round trip (a Turso batch), or in order inside a transaction. */
  private async readMany(stmts: Stmt[]) {
    const inTx = this.tx.getStore();
    if (inTx) {
      const out = [];
      for (const s of stmts) out.push(await inTx.execute(s));
      return out;
    }
    const client = await this.open();
    return this.local ? this.lock.run(() => client.batch(stmts, 'read')) : client.batch(stmts, 'read');
  }

  private async one(sql: string, args: InValue[] = []): Promise<Row | undefined> {
    return (await this.execute(sql, args)).rows[0] as Row | undefined;
  }

  private async all(sql: string, args: InValue[] = []): Promise<Row[]> {
    return (await this.execute(sql, args)).rows as unknown as Row[];
  }

  private async changes(sql: string, args: InValue[] = []): Promise<number> {
    return (await this.execute(sql, args)).rowsAffected;
  }

  // ─── Meta ──────────────────────────────────────────────────────────────────

  /** A random value generated once and kept in the database (used as the JWT key when JWT_SECRET is unset). */
  async persistentSecret(key: string): Promise<string> {
    const row = await this.one('SELECT value FROM meta WHERE key = ?', [key]);
    if (row) return String(row.value);
    await this.execute('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [key, randomBytes(48).toString('base64url')]);
    return String((await this.one('SELECT value FROM meta WHERE key = ?', [key]))!.value);
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  /** Returns null when the email is already taken. */
  async createUser(input: { email: string; passwordHash: string; nickname: string; avatar: string | null }): Promise<UserRow | null> {
    const now = this.now();
    const id = nanoid(16);
    try {
      await this.execute(
        `INSERT INTO users (id, email, password_hash, nickname, avatar, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.email, input.passwordHash, input.nickname, input.avatar, now, now, now],
      );
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
    return this.getUser(id);
  }

  async getUser(id: string): Promise<UserRow | null> {
    return toUser(await this.one(`${USER_SELECT} WHERE u.id = ?`, [id]));
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    return toUser(await this.one(`${USER_SELECT} WHERE u.email = ?`, [email]));
  }

  async updateProfile(id: string, patch: { nickname?: string; avatar?: string | null }): Promise<UserRow | null> {
    const sets: string[] = [];
    const values: InValue[] = [];
    if (patch.nickname !== undefined) sets.push('nickname = ?') && values.push(patch.nickname);
    if (patch.avatar !== undefined) sets.push('avatar = ?') && values.push(patch.avatar);
    if (sets.length) await this.execute(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, this.now(), id]);
    return this.getUser(id);
  }

  async setPasswordHash(id: string, passwordHash: string) {
    await this.execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, this.now(), id]);
  }

  async touchLogin(id: string) {
    await this.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [this.now(), id]);
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  async createSession(userId: string, ttlMs: number, userAgent: string | null): Promise<SessionRow> {
    const now = this.now();
    const row: SessionRow = { id: nanoid(24), userId, createdAt: now, expiresAt: now + ttlMs };
    await this.execute('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)', [
      row.id,
      userId,
      now,
      row.expiresAt,
      now,
      userAgent?.slice(0, 200) ?? null,
    ]);
    return row;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const r = await this.one('SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?', [id]);
    if (!r || Number(r.expires_at) <= this.now()) return null;
    return { id: String(r.id), userId: String(r.user_id), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at) };
  }

  async deleteSession(id: string) {
    await this.execute('DELETE FROM sessions WHERE id = ?', [id]);
  }

  async pruneSessions() {
    if (!this.client) return;
    await this.execute('DELETE FROM sessions WHERE expires_at <= ?', [this.now()]);
  }

  // ─── Matches ───────────────────────────────────────────────────────────────

  /** Idempotent: the same game is stored at most once per user. Returns whether a row was added. */
  async recordMatch(userId: string, m: MatchRecord): Promise<boolean> {
    const added = await this.changes(
      `INSERT OR IGNORE INTO matches (
        user_id, room_id, round, mode, result, reason, my_mark, my_name, my_avatar,
        opponent_name, opponent_avatar, opponent_is_bot, opponent_user_id, bot_difficulty,
        board_size, turn_ms, move_count, moves, win_line, started_at, finished_at,
        tournament_id, tournament_name, tournament_round, tournament_total_rounds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        m.roomId,
        m.round,
        m.mode,
        m.result,
        m.reason,
        m.myMark,
        m.myName,
        m.myAvatar,
        m.opponentName,
        m.opponentAvatar,
        m.opponentIsBot ? 1 : 0,
        m.opponentUserId,
        m.botDifficulty,
        m.boardSize,
        m.turnMs,
        m.moves.length,
        m.moves.join(','),
        m.winLine ? m.winLine.join(',') : null,
        m.startedAt,
        m.finishedAt,
        m.tournamentId,
        m.tournamentName,
        m.tournamentRound,
        m.tournamentTotalRounds,
      ],
    );
    return added > 0;
  }

  /** Newest first. `before` is the id of the last match of the previous page. */
  async listMatches(userId: string, opts: { limit: number; before?: number; mode?: RoomMode }): Promise<StoredMatch[]> {
    const where = ['user_id = ?'];
    const values: InValue[] = [userId];
    if (opts.before) where.push('id < ?') && values.push(opts.before);
    if (opts.mode) where.push('mode = ?') && values.push(opts.mode);
    const rows = await this.all(`SELECT * FROM matches WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, [...values, opts.limit]);
    return rows.map(toMatch);
  }

  async getMatch(userId: string, id: number): Promise<StoredMatch | null> {
    const row = await this.one('SELECT * FROM matches WHERE user_id = ? AND id = ?', [userId, id]);
    return row ? toMatch(row) : null;
  }

  async stats(userId: string): Promise<PlayerStats> {
    // One round trip on Turso: the five reads go out as a single batch.
    const [countsRs, botRs, aggRs, favRs, seqRs] = await this.readMany([
      { sql: 'SELECT mode, result, COUNT(*) AS n FROM matches WHERE user_id = ? GROUP BY mode, result', args: [userId] },
      { sql: `SELECT bot_difficulty AS d, COUNT(*) AS n FROM matches WHERE user_id = ? AND mode = 'bot' AND result = 'win' GROUP BY d`, args: [userId] },
      {
        sql: `SELECT
           COALESCE(SUM(move_count), 0) AS moves,
           -- X moves first, so X made ceil(n/2) of the n moves and O floor(n/2).
           COALESCE(SUM(CASE WHEN my_mark = 'O' THEN move_count / 2 ELSE (move_count + 1) / 2 END), 0) AS ownMoves,
           COALESCE(MAX(move_count), 0) AS longest,
           COALESCE(SUM(MAX(finished_at - started_at, 0)), 0) AS playMs,
           SUM(CASE WHEN mode = 'tournament' AND result = 'win' AND tournament_round = tournament_total_rounds - 1 THEN 1 ELSE 0 END) AS titles,
           MIN(CASE WHEN result = 'win' AND reason = 'five' THEN (move_count + 1) / 2 END) AS fastest,
           SUM(CASE WHEN result = 'win' AND reason = 'five' THEN 1 ELSE 0 END) AS byFive,
           SUM(CASE WHEN result = 'win' AND my_mark = 'O' THEN 1 ELSE 0 END) AS asO,
           COUNT(DISTINCT CASE WHEN result = 'win' THEN opponent_user_id END) AS rivals
         FROM matches WHERE user_id = ?`,
        args: [userId],
      },
      { sql: 'SELECT board_size AS size, COUNT(*) AS n FROM matches WHERE user_id = ? GROUP BY board_size ORDER BY n DESC, size ASC LIMIT 1', args: [userId] },
      // Streaks need the whole sequence; a player's history is small enough to walk.
      { sql: 'SELECT result FROM matches WHERE user_id = ? ORDER BY finished_at ASC, id ASC', args: [userId] },
    ]);

    const byMode: Record<RoomMode, ModeStats> = { pvp: emptyMode(), bot: emptyMode(), tournament: emptyMode() };
    const overall = emptyMode();
    let xp = 0;
    for (const row of countsRs.rows) {
      const mode = String(row.mode) as RoomMode;
      const result = String(row.result) as MatchResult;
      const n = Number(row.n);
      const bucket = byMode[mode] ?? (byMode[mode] = emptyMode());
      for (const s of [bucket, overall]) {
        s.games += n;
        if (result === 'win') s.wins += n;
        else if (result === 'loss') s.losses += n;
        else s.draws += n;
      }
      xp += (XP[result] ?? 0) * n * (mode === 'bot' ? 0.5 : 1);
    }
    for (const s of [overall, ...Object.values(byMode)]) s.winRate = s.games ? Math.round((s.wins / s.games) * 1000) / 10 : 0;

    const botWins: Record<BotDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (const row of botRs.rows) {
      const d = row.d == null ? null : (String(row.d) as BotDifficulty);
      if (d && d in botWins) botWins[d] = Number(row.n);
    }

    const agg = aggRs.rows[0] as Row;
    const fav = favRs.rows[0] as Row | undefined;
    const sequence = seqRs.rows.map((r) => String(r.result) as MatchResult);
    let best = 0;
    let run = 0;
    for (const r of sequence) {
      run = r === 'win' ? run + 1 : 0;
      best = Math.max(best, run);
    }
    const last = sequence[sequence.length - 1] ?? null;
    let count = 0;
    for (let i = sequence.length - 1; i >= 0 && sequence[i] === last; i--) count++;

    const level = levelFor(Math.floor(xp));
    return {
      overall,
      byMode,
      botWins,
      currentStreak: { result: last, count },
      bestWinStreak: best,
      tournamentTitles: Number(agg.titles ?? 0),
      totalMoves: Number(agg.moves),
      movesPlayed: Number(agg.ownMoves),
      longestGameMoves: Number(agg.longest),
      totalPlayMs: Number(agg.playMs),
      fastestWinMoves: agg.fastest == null ? null : Number(agg.fastest),
      winsByFive: Number(agg.byFive ?? 0),
      winsAsO: Number(agg.asO ?? 0),
      distinctOpponentsBeaten: Number(agg.rivals ?? 0),
      favoriteBoardSize: fav ? Number(fav.size) : null,
      recentForm: sequence.slice(-10).reverse(),
      xp: Math.floor(xp),
      level,
      levelFloorXp: levelFloor(level),
      nextLevelXp: levelFloor(level + 1),
    };
  }

  // ─── Achievements ──────────────────────────────────────────────────────────

  async listAchievements(userId: string): Promise<UserAchievementRow[]> {
    const rows = await this.all(
      'SELECT achievement_id, unlocked_at, reward_claimed, reward_coins FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at ASC',
      [userId],
    );
    return rows.map(toUserAchievement);
  }

  /**
   * Marks an achievement unlocked. Returns false if it already was: the primary
   * key makes an unlock one-shot, and callers pay rewards only when this returns
   * true (in the same transaction), so a reward can't be paid twice even if two
   * checks race. `rewardCoins` is recorded for reference; the reward service pays.
   */
  async insertAchievementUnlock(userId: string, achievementId: string, rewardCoins: number): Promise<boolean> {
    const added = await this.changes(
      'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, reward_claimed, reward_coins) VALUES (?, ?, ?, 1, ?)',
      [userId, achievementId, this.now(), Math.max(0, Math.floor(rewardCoins))],
    );
    return added > 0;
  }

  /** Only the reward service calls this. */
  async addCoins(userId: string, amount: number) {
    await this.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [Math.floor(amount), userId]);
  }

  async coins(userId: string): Promise<number> {
    const row = await this.one('SELECT coins FROM users WHERE id = ?', [userId]);
    return Number(row?.coins ?? 0);
  }

  // ─── Titles ────────────────────────────────────────────────────────────────

  /** Oldest first. */
  async listTitles(userId: string): Promise<UserTitleRow[]> {
    const rows = await this.all(
      'SELECT title_id, unlocked_at, source_type, source_id FROM user_titles WHERE user_id = ? ORDER BY unlocked_at ASC, title_id ASC',
      [userId],
    );
    return rows.map((r) => ({
      titleId: String(r.title_id),
      unlockedAt: Number(r.unlocked_at),
      sourceType: String(r.source_type),
      sourceId: strOrNull(r.source_id),
    }));
  }

  /** Idempotent: returns whether the title was newly added. Only the reward service calls this. */
  async grantTitle(userId: string, titleId: string, source: RewardSource): Promise<boolean> {
    const added = await this.changes('INSERT OR IGNORE INTO user_titles (user_id, title_id, unlocked_at, source_type, source_id) VALUES (?, ?, ?, ?, ?)', [
      userId,
      titleId,
      this.now(),
      source.type,
      source.id,
    ]);
    return added > 0;
  }

  /**
   * Equips a title the user owns, or clears it with null. The ownership check
   * is part of the UPDATE, so it can't be skipped or raced. Returns false when
   * the user doesn't own the title (or doesn't exist).
   */
  async setEquippedTitle(userId: string, titleId: string | null): Promise<boolean> {
    const changed =
      titleId === null
        ? await this.changes('UPDATE users SET equipped_title_id = NULL WHERE id = ?', [userId])
        : await this.changes('UPDATE users SET equipped_title_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM user_titles WHERE user_id = ? AND title_id = ?)', [
            titleId,
            userId,
            userId,
            titleId,
          ]);
    return changed > 0;
  }

  async equippedTitleId(userId: string): Promise<string | null> {
    const row = await this.one('SELECT equipped_title_id FROM users WHERE id = ?', [userId]);
    return row ? strOrNull(row.equipped_title_id) : null;
  }

  // ─── Cosmetics (name styles, …) ────────────────────────────────────────────

  /** Owned items of one kind, oldest first. */
  async listCosmetics(userId: string, kind: CosmeticKind): Promise<UserCosmeticRow[]> {
    const rows = await this.all(
      'SELECT item_id, acquired_at, source_type, source_id, cost FROM user_cosmetics WHERE user_id = ? AND kind = ? ORDER BY acquired_at ASC, item_id ASC',
      [userId, kind],
    );
    return rows.map((r) => ({
      itemId: String(r.item_id),
      acquiredAt: Number(r.acquired_at),
      sourceType: String(r.source_type),
      sourceId: strOrNull(r.source_id),
      cost: Number(r.cost),
    }));
  }

  /** Idempotent: returns whether the item was newly added. Only the reward service calls this. */
  async grantCosmetic(userId: string, kind: CosmeticKind, itemId: string, source: RewardSource): Promise<boolean> {
    const added = await this.changes(
      'INSERT OR IGNORE INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type, source_id, cost) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [userId, kind, itemId, this.now(), source.type, source.id],
    );
    return added > 0;
  }

  /**
   * Buys an item: takes the coins and adds it to the inventory in one
   * transaction. The coin UPDATE only matches while the balance covers the
   * price, and the insert only succeeds once per item, so neither a double
   * click nor two racing requests can buy twice or push the balance below 0.
   * `price` must come from the catalogue, never from a request.
   */
  purchaseCosmetic(userId: string, kind: CosmeticKind, itemId: string, price: number): Promise<PurchaseOutcome> {
    const cost = Math.max(0, Math.floor(price));
    return this.transaction(async (): Promise<PurchaseOutcome> => {
      const owned = await this.one('SELECT 1 FROM user_cosmetics WHERE user_id = ? AND kind = ? AND item_id = ?', [userId, kind, itemId]);
      if (owned) return 'ALREADY_OWNED';
      const paid = await this.changes('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', [cost, userId, cost]);
      if (paid === 0) return 'NOT_ENOUGH_COIN';
      await this.execute(
        'INSERT INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type, source_id, cost) VALUES (?, ?, ?, ?, ?, NULL, ?)',
        [userId, kind, itemId, this.now(), 'coin', cost],
      );
      return 'OK';
    });
  }

  /**
   * Stores the equipped name style (null = default). Callers check ownership
   * first (NameStyleService); reads re-check it anyway (USER_SELECT).
   */
  async setNameStyle(userId: string, nameStyleId: string | null) {
    await this.execute('UPDATE users SET name_style_id = ?, updated_at = ? WHERE id = ?', [nameStyleId, this.now(), userId]);
  }

  /**
   * Stores the equipped avatar frame (null = `frame_default`). Callers check
   * ownership first (AvatarFrameService); reads re-check it anyway (USER_SELECT).
   */
  async setAvatarFrame(userId: string, avatarFrameId: string | null) {
    await this.execute('UPDATE users SET avatar_frame_id = ?, updated_at = ? WHERE id = ?', [avatarFrameId, this.now(), userId]);
  }
}

function toUserAchievement(r: Row): UserAchievementRow {
  return {
    achievementId: String(r.achievement_id),
    unlockedAt: Number(r.unlocked_at),
    rewardClaimed: Number(r.reward_claimed) === 1,
    rewardCoins: Number(r.reward_coins),
  };
}

function isUniqueViolation(err: unknown) {
  const e = err as { extendedCode?: string; rawCode?: number; message?: string };
  // SQLITE_CONSTRAINT_UNIQUE = 2067, SQLITE_CONSTRAINT_PRIMARYKEY = 1555.
  return (
    e?.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e?.extendedCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    e?.rawCode === 2067 ||
    e?.rawCode === 1555 ||
    /UNIQUE constraint failed/.test(e?.message ?? '')
  );
}

function toUser(r: Row | undefined): UserRow | null {
  if (!r) return null;
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    nickname: String(r.nickname),
    avatar: r.avatar == null ? null : String(r.avatar),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    lastLoginAt: r.last_login_at == null ? null : Number(r.last_login_at),
    coins: Number(r.coins ?? 0),
    equippedTitleId: r.equipped_title_id == null ? null : String(r.equipped_title_id),
    // Trusted only with its ownership row (USER_SELECT); a raw SELECT * reads as default.
    nameStyleId: r.name_style_id != null && Number(r.name_style_owned ?? 0) === 1 ? String(r.name_style_id) : null,
    avatarFrameId: r.avatar_frame_id != null && Number(r.avatar_frame_owned ?? 0) === 1 ? String(r.avatar_frame_id) : null,
  };
}

const csv = (v: Value) => (v == null || v === '' ? [] : String(v).split(',').map(Number));
const numOrNull = (v: Value) => (v == null ? null : Number(v));
const strOrNull = (v: Value) => (v == null ? null : String(v));

function toMatch(r: Row): StoredMatch {
  return {
    id: Number(r.id),
    roomId: String(r.room_id),
    round: Number(r.round),
    mode: String(r.mode) as RoomMode,
    result: String(r.result) as MatchResult,
    reason: String(r.reason) as FinishReason,
    myMark: strOrNull(r.my_mark) as Mark | null,
    myName: String(r.my_name),
    myAvatar: strOrNull(r.my_avatar),
    opponentName: strOrNull(r.opponent_name),
    opponentAvatar: strOrNull(r.opponent_avatar),
    opponentIsBot: Number(r.opponent_is_bot) === 1,
    opponentUserId: strOrNull(r.opponent_user_id),
    botDifficulty: strOrNull(r.bot_difficulty) as BotDifficulty | null,
    boardSize: Number(r.board_size),
    turnMs: Number(r.turn_ms),
    moves: csv(r.moves),
    winLine: r.win_line == null ? null : csv(r.win_line),
    startedAt: Number(r.started_at),
    finishedAt: Number(r.finished_at),
    tournamentId: strOrNull(r.tournament_id),
    tournamentName: strOrNull(r.tournament_name),
    tournamentRound: numOrNull(r.tournament_round),
    tournamentTotalRounds: numOrNull(r.tournament_total_rounds),
  };
}
