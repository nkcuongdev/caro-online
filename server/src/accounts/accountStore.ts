import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { RewardSource } from '../rewards/rewardService.js';
import type { BotDifficulty, FinishReason, Mark, RoomMode } from '../types.js';

/**
 * Durable storage for accounts, login sessions and match history: one SQLite
 * file via Node's built-in `node:sqlite` (no native addon to build on deploy).
 *
 * Rooms and timers stay in memory as before; only finished games and profiles
 * are written here. Queries are tiny and indexed, so the synchronous driver
 * costs well under a millisecond per call.
 *
 * The file is opened on first use, so a server (or test) that never touches
 * accounts never creates it.
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

type Row = Record<string, SQLInputValue>;

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
  private handle: DatabaseSync | null = null;
  private txDepth = 0;

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens (and migrates) the database. Called lazily; call it at boot to fail fast. */
  open(): DatabaseSync {
    if (this.handle) return this.handle;
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    const db = new DatabaseSync(this.path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    if (this.path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[v]);
        db.exec(`PRAGMA user_version = ${v}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    this.handle = db;
    return db;
  }

  close() {
    this.handle?.close();
    this.handle = null;
  }

  private get db() {
    return this.open();
  }

  /**
   * Runs `fn` in one write transaction (committed if it returns, rolled back if
   * it throws). Nested calls join the outer transaction.
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    this.txDepth++;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  // ─── Meta ──────────────────────────────────────────────────────────────────

  /** A random value generated once and kept in the database (used as the JWT key when JWT_SECRET is unset). */
  persistentSecret(key: string): string {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    if (row) return row.value;
    const value = randomBytes(48).toString('base64url');
    this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, value);
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string }).value;
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  /** Returns null when the email is already taken. */
  createUser(input: { email: string; passwordHash: string; nickname: string; avatar: string | null }): UserRow | null {
    const now = this.now();
    const id = nanoid(16);
    try {
      this.db
        .prepare(
          `INSERT INTO users (id, email, password_hash, nickname, avatar, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.email, input.passwordHash, input.nickname, input.avatar, now, now, now);
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
    return this.getUser(id);
  }

  getUser(id: string): UserRow | null {
    return toUser(this.db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as Row | undefined);
  }

  findUserByEmail(email: string): UserRow | null {
    return toUser(this.db.prepare(`${USER_SELECT} WHERE u.email = ?`).get(email) as Row | undefined);
  }

  updateProfile(id: string, patch: { nickname?: string; avatar?: string | null }): UserRow | null {
    const sets: string[] = [];
    const values: SQLInputValue[] = [];
    if (patch.nickname !== undefined) sets.push('nickname = ?') && values.push(patch.nickname);
    if (patch.avatar !== undefined) sets.push('avatar = ?') && values.push(patch.avatar);
    if (sets.length) {
      this.db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
    }
    return this.getUser(id);
  }

  setPasswordHash(id: string, passwordHash: string) {
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, this.now(), id);
  }

  touchLogin(id: string) {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(this.now(), id);
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  createSession(userId: string, ttlMs: number, userAgent: string | null): SessionRow {
    const now = this.now();
    const row: SessionRow = { id: nanoid(24), userId, createdAt: now, expiresAt: now + ttlMs };
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, userId, now, row.expiresAt, now, userAgent?.slice(0, 200) ?? null);
    return row;
  }

  getSession(id: string): SessionRow | null {
    const r = this.db.prepare('SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?').get(id) as Row | undefined;
    if (!r || Number(r.expires_at) <= this.now()) return null;
    return { id: String(r.id), userId: String(r.user_id), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at) };
  }

  deleteSession(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  pruneSessions() {
    if (!this.handle) return;
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
  }

  // ─── Matches ───────────────────────────────────────────────────────────────

  /** Idempotent: the same game is stored at most once per user. Returns whether a row was added. */
  recordMatch(userId: string, m: MatchRecord): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO matches (
          user_id, room_id, round, mode, result, reason, my_mark, my_name, my_avatar,
          opponent_name, opponent_avatar, opponent_is_bot, opponent_user_id, bot_difficulty,
          board_size, turn_ms, move_count, moves, win_line, started_at, finished_at,
          tournament_id, tournament_name, tournament_round, tournament_total_rounds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    return Number(res.changes) > 0;
  }

  /** Newest first. `before` is the id of the last match of the previous page. */
  listMatches(userId: string, opts: { limit: number; before?: number; mode?: RoomMode }): StoredMatch[] {
    const where = ['user_id = ?'];
    const values: SQLInputValue[] = [userId];
    if (opts.before) where.push('id < ?') && values.push(opts.before);
    if (opts.mode) where.push('mode = ?') && values.push(opts.mode);
    const rows = this.db
      .prepare(`SELECT * FROM matches WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...values, opts.limit) as Row[];
    return rows.map(toMatch);
  }

  getMatch(userId: string, id: number): StoredMatch | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined;
    return row ? toMatch(row) : null;
  }

  stats(userId: string): PlayerStats {
    const byMode: Record<RoomMode, ModeStats> = { pvp: emptyMode(), bot: emptyMode(), tournament: emptyMode() };
    const overall = emptyMode();
    const counts = this.db
      .prepare('SELECT mode, result, COUNT(*) AS n FROM matches WHERE user_id = ? GROUP BY mode, result')
      .all(userId) as { mode: RoomMode; result: MatchResult; n: number }[];
    let xp = 0;
    for (const { mode, result, n } of counts) {
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
    const botRows = this.db
      .prepare(`SELECT bot_difficulty AS d, COUNT(*) AS n FROM matches WHERE user_id = ? AND mode = 'bot' AND result = 'win' GROUP BY d`)
      .all(userId) as { d: BotDifficulty | null; n: number }[];
    for (const { d, n } of botRows) if (d && d in botWins) botWins[d] = n;

    const agg = this.db
      .prepare(
        `SELECT
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
      )
      .get(userId) as {
      moves: number;
      ownMoves: number;
      longest: number;
      playMs: number;
      titles: number | null;
      fastest: number | null;
      byFive: number | null;
      asO: number | null;
      rivals: number;
    };

    const fav = this.db
      .prepare('SELECT board_size AS size, COUNT(*) AS n FROM matches WHERE user_id = ? GROUP BY board_size ORDER BY n DESC, size ASC LIMIT 1')
      .get(userId) as { size: number } | undefined;

    // Streaks need the whole sequence; a player's history is small enough to walk.
    const sequence = (this.db.prepare('SELECT result FROM matches WHERE user_id = ? ORDER BY finished_at ASC, id ASC').all(userId) as {
      result: MatchResult;
    }[]).map((r) => r.result);
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

  listAchievements(userId: string): UserAchievementRow[] {
    const rows = this.db
      .prepare('SELECT achievement_id, unlocked_at, reward_claimed, reward_coins FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at ASC')
      .all(userId) as Row[];
    return rows.map(toUserAchievement);
  }

  /**
   * Marks an achievement unlocked. Returns false if it already was: the primary
   * key makes an unlock one-shot, and callers pay rewards only when this returns
   * true (in the same transaction), so a reward can't be paid twice even if two
   * checks race. `rewardCoins` is recorded for reference; the reward service pays.
   */
  insertAchievementUnlock(userId: string, achievementId: string, rewardCoins: number): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, reward_claimed, reward_coins) VALUES (?, ?, ?, 1, ?)')
      .run(userId, achievementId, this.now(), Math.max(0, Math.floor(rewardCoins)));
    return Number(res.changes) > 0;
  }

  /** Only the reward service calls this. */
  addCoins(userId: string, amount: number) {
    this.db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(Math.floor(amount), userId);
  }

  coins(userId: string): number {
    const row = this.db.prepare('SELECT coins FROM users WHERE id = ?').get(userId) as { coins: number } | undefined;
    return Number(row?.coins ?? 0);
  }

  // ─── Titles ────────────────────────────────────────────────────────────────

  /** Oldest first. */
  listTitles(userId: string): UserTitleRow[] {
    const rows = this.db
      .prepare('SELECT title_id, unlocked_at, source_type, source_id FROM user_titles WHERE user_id = ? ORDER BY unlocked_at ASC, title_id ASC')
      .all(userId) as Row[];
    return rows.map((r) => ({
      titleId: String(r.title_id),
      unlockedAt: Number(r.unlocked_at),
      sourceType: String(r.source_type),
      sourceId: strOrNull(r.source_id),
    }));
  }

  /** Idempotent: returns whether the title was newly added. Only the reward service calls this. */
  grantTitle(userId: string, titleId: string, source: RewardSource): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO user_titles (user_id, title_id, unlocked_at, source_type, source_id) VALUES (?, ?, ?, ?, ?)')
      .run(userId, titleId, this.now(), source.type, source.id);
    return Number(res.changes) > 0;
  }

  /**
   * Equips a title the user owns, or clears it with null. The ownership check
   * is part of the UPDATE, so it can't be skipped or raced. Returns false when
   * the user doesn't own the title (or doesn't exist).
   */
  setEquippedTitle(userId: string, titleId: string | null): boolean {
    const res =
      titleId === null
        ? this.db.prepare('UPDATE users SET equipped_title_id = NULL WHERE id = ?').run(userId)
        : this.db
            .prepare('UPDATE users SET equipped_title_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM user_titles WHERE user_id = ? AND title_id = ?)')
            .run(titleId, userId, userId, titleId);
    return Number(res.changes) > 0;
  }

  equippedTitleId(userId: string): string | null {
    const row = this.db.prepare('SELECT equipped_title_id FROM users WHERE id = ?').get(userId) as Row | undefined;
    return row ? strOrNull(row.equipped_title_id) : null;
  }

  // ─── Cosmetics (name styles, …) ────────────────────────────────────────────

  /** Owned items of one kind, oldest first. */
  listCosmetics(userId: string, kind: CosmeticKind): UserCosmeticRow[] {
    const rows = this.db
      .prepare('SELECT item_id, acquired_at, source_type, source_id, cost FROM user_cosmetics WHERE user_id = ? AND kind = ? ORDER BY acquired_at ASC, item_id ASC')
      .all(userId, kind) as Row[];
    return rows.map((r) => ({
      itemId: String(r.item_id),
      acquiredAt: Number(r.acquired_at),
      sourceType: String(r.source_type),
      sourceId: strOrNull(r.source_id),
      cost: Number(r.cost),
    }));
  }

  /** Idempotent: returns whether the item was newly added. Only the reward service calls this. */
  grantCosmetic(userId: string, kind: CosmeticKind, itemId: string, source: RewardSource): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type, source_id, cost) VALUES (?, ?, ?, ?, ?, ?, 0)')
      .run(userId, kind, itemId, this.now(), source.type, source.id);
    return Number(res.changes) > 0;
  }

  /**
   * Buys an item: takes the coins and adds it to the inventory in one
   * transaction. The coin UPDATE only matches while the balance covers the
   * price, and the insert only succeeds once per item, so neither a double
   * click nor two racing requests can buy twice or push the balance below 0.
   * `price` must come from the catalogue, never from a request.
   */
  purchaseCosmetic(userId: string, kind: CosmeticKind, itemId: string, price: number): PurchaseOutcome {
    const cost = Math.max(0, Math.floor(price));
    return this.transaction((): PurchaseOutcome => {
      const owned = this.db.prepare('SELECT 1 FROM user_cosmetics WHERE user_id = ? AND kind = ? AND item_id = ?').get(userId, kind, itemId);
      if (owned) return 'ALREADY_OWNED';
      const paid = this.db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(cost, userId, cost);
      if (Number(paid.changes) === 0) return 'NOT_ENOUGH_COIN';
      this.db
        .prepare('INSERT INTO user_cosmetics (user_id, kind, item_id, acquired_at, source_type, source_id, cost) VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .run(userId, kind, itemId, this.now(), 'coin', cost);
      return 'OK';
    });
  }

  /**
   * Stores the equipped name style (null = default). Callers check ownership
   * first (NameStyleService); reads re-check it anyway (USER_SELECT).
   */
  setNameStyle(userId: string, nameStyleId: string | null) {
    this.db.prepare('UPDATE users SET name_style_id = ?, updated_at = ? WHERE id = ?').run(nameStyleId, this.now(), userId);
  }

  /**
   * Stores the equipped avatar frame (null = `frame_default`). Callers check
   * ownership first (AvatarFrameService); reads re-check it anyway (USER_SELECT).
   */
  setAvatarFrame(userId: string, avatarFrameId: string | null) {
    this.db.prepare('UPDATE users SET avatar_frame_id = ?, updated_at = ? WHERE id = ?').run(avatarFrameId, this.now(), userId);
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
  const e = err as { errcode?: number; message?: string };
  // SQLITE_CONSTRAINT_UNIQUE = 2067, SQLITE_CONSTRAINT_PRIMARYKEY = 1555.
  return e?.errcode === 2067 || e?.errcode === 1555 || /UNIQUE constraint failed/.test(e?.message ?? '');
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

const csv = (v: SQLInputValue) => (v == null || v === '' ? [] : String(v).split(',').map(Number));
const numOrNull = (v: SQLInputValue) => (v == null ? null : Number(v));
const strOrNull = (v: SQLInputValue) => (v == null ? null : String(v));

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
