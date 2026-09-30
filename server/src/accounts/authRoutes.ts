import express, { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { z } from 'zod';
import { createIpLimiter } from '../avatars/avatarRoutes.js';
import { normalizeAvatar, type AvatarStorage } from '../avatars/avatars.js';
import type { AchievementManager, EvaluateResult } from '../achievements/achievementManager.js';
import type { AccountsConfig } from '../config.js';
import type { TitleService } from '../titles/titleService.js';
import { MAX_NAME_LENGTH, sanitizeName } from '../rooms/names.js';
import type { PlayerStats, StoredMatch, UserRow } from './accountStore.js';
import { normalizeEmail, toPublicAccount, type AuthService, type Identity } from './authService.js';
import type { MatchRecorder } from './matchRecorder.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

type AuthError =
  | 'INVALID_PAYLOAD'
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'EMAIL_TAKEN'
  | 'BAD_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_NICKNAME'
  | 'INVALID_AVATAR'
  | 'NOT_FOUND'
  | 'TITLE_NOT_FOUND'
  | 'TITLE_LOCKED'
  | 'INTERNAL';

const MESSAGES: Record<AuthError, string> = {
  INVALID_PAYLOAD: 'Yêu cầu không hợp lệ.',
  INVALID_EMAIL: 'Email chưa đúng định dạng.',
  WEAK_PASSWORD: `Mật khẩu cần từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự.`,
  EMAIL_TAKEN: 'Email này đã có tài khoản. Hãy đăng nhập nhé.',
  BAD_CREDENTIALS: 'Email hoặc mật khẩu chưa đúng.',
  RATE_LIMITED: 'Bạn thử quá nhiều lần, chờ vài phút rồi thử lại nhé.',
  UNAUTHORIZED: 'Bạn cần đăng nhập để xem mục này.',
  INVALID_NICKNAME: 'Nickname không hợp lệ.',
  INVALID_AVATAR: 'Avatar không hợp lệ.',
  NOT_FOUND: 'Không tìm thấy trận đấu này.',
  TITLE_NOT_FOUND: 'Danh hiệu này không tồn tại.',
  TITLE_LOCKED: 'Bạn chưa sở hữu danh hiệu này.',
  INTERNAL: 'Máy chủ gặp sự cố, thử lại sau nhé.',
};

const STATUS: Record<AuthError, number> = {
  INVALID_PAYLOAD: 400,
  INVALID_EMAIL: 400,
  WEAK_PASSWORD: 400,
  EMAIL_TAKEN: 409,
  BAD_CREDENTIALS: 401,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  INVALID_NICKNAME: 400,
  INVALID_AVATAR: 400,
  NOT_FOUND: 404,
  TITLE_NOT_FOUND: 404,
  TITLE_LOCKED: 403,
  INTERNAL: 500,
};

const email = z.string().trim().max(254).pipe(z.email());
const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const nickname = z.string().max(64);
const avatar = z.string().max(300);
/** Guest seat tokens (see MatchRecorder): proof of the games played before signing in. */
const guestTokens = z.array(z.string().min(16).max(64)).max(40).optional().default([]);

const schemas = {
  register: z.object({ email: z.string().max(254), password: z.string().max(PASSWORD_MAX_LENGTH * 4), nickname: nickname.optional(), avatar: avatar.optional(), guestTokens }),
  login: z.object({ email: z.string().max(254), password: z.string().max(PASSWORD_MAX_LENGTH * 4), guestTokens }),
  profile: z.object({ nickname: nickname.optional(), avatar: avatar.optional() }),
  claim: z.object({ guestTokens }),
  /** null unequips. Shape only: the title service decides whether the id exists and is owned. */
  equipTitle: z.object({ titleId: z.string().min(1).max(64).nullable() }),
  matches: z.object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    before: z.coerce.number().int().positive().optional(),
    mode: z.enum(['pvp', 'bot', 'tournament']).optional(),
  }),
};

/** Public shape of a history entry. Drops the opponent's account id. */
function toPublicMatch(m: StoredMatch, withMoves: boolean) {
  const { opponentUserId, moves, ...rest } = m;
  return { ...rest, opponentRegistered: !!opponentUserId, moveCount: moves.length, ...(withMoves ? { moves } : {}) };
}

/** The login token of a request (`Authorization: Bearer …`), or null. Shared by every account router. */
export function bearerToken(req: Request) {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/**
 * Accounts over plain HTTP (JSON, `Authorization: Bearer <jwt>`):
 *
 *   POST  /api/auth/register   { email, password, nickname?, avatar?, guestTokens? }
 *   POST  /api/auth/login      { email, password, guestTokens? }
 *   POST  /api/auth/logout
 *   GET   /api/me              → { user, stats }
 *   PATCH /api/me              { nickname?, avatar? }
 *   POST  /api/me/claim        { guestTokens }  → games played as a guest move into the account
 *   GET   /api/me/stats
 *   GET   /api/me/matches      ?limit&before&mode
 *   GET   /api/me/matches/:id  (with the move list, for the replay)
 *   GET   /api/me/achievements → every achievement with progress, summary, coin balance
 *   GET   /api/titles          → the title catalogue (secret titles masked; no login needed)
 *   GET   /api/me/titles       → every title with ownership, the equipped one, summary
 *   PATCH /api/me/title        { titleId | null } → equip an owned title, or unequip
 *
 * Achievements are only ever unlocked by the server (after a game, on sign-in
 * and when the list is read), and titles only arrive as achievement rewards;
 * there is no endpoint to unlock either. Responses that unlocked something
 * carry it (`achievements` / `newAchievements` / `newlyUnlocked`, and
 * `restoredTitles` for backfilled titles) so the client can celebrate it once.
 *
 * A bearer token (not a cookie) because the frontend and the game server live
 * on different sites in production (Vercel + Railway), where third-party
 * cookies are unreliable.
 */
export function createAuthRouter(
  cfg: AccountsConfig,
  auth: AuthService,
  recorder: MatchRecorder,
  avatars: AvatarStorage,
  achievements: AchievementManager,
  titles: TitleService,
): Router {
  const router = Router();
  const allowIp = createIpLimiter(cfg.authBurst, cfg.authWindowMs);
  const failures = createFailureCounter(cfg.failuresPerEmail, 15 * 60_000);
  const store = auth.store;

  const fail = (res: Response, error: AuthError, message = MESSAGES[error]) => res.status(STATUS[error]).json({ ok: false, error, message });

  router.use(['/api/auth', '/api/me'], express.json({ limit: '8kb' }), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** Resolves the signed-in user or answers 401. */
  const requireUser = async (req: Request, res: Response): Promise<(Identity & { user: UserRow }) | null> => {
    const identity = await auth.identify(bearerToken(req));
    const user = identity && (await store.getUser(identity.userId));
    if (!identity || !user) {
      fail(res, 'UNAUTHORIZED');
      return null;
    }
    return { ...identity, user };
  };

  const claim = async (tokens: string[], userId: string) => (tokens.length ? recorder.claim(tokens, userId) : 0);

  /** Claimed games (and history from before achievements existed) can unlock something at sign-in. */
  const checkAchievements = async (userId: string, stats?: PlayerStats): Promise<Pick<EvaluateResult, 'unlocked' | 'restoredTitles'>> => {
    try {
      return await achievements.evaluate(userId, stats);
    } catch (err) {
      // Never fail a login over this: the next check catches up.
      console.error('[achievements] check failed', err);
      return { unlocked: [], restoredTitles: [] };
    }
  };
  /** The account as stored now (the coin balance may have just changed). */
  const freshAccount = async (userId: string) => {
    const user = await store.getUser(userId);
    return user && toPublicAccount(user);
  };

  router.post('/api/auth/register', async (req, res) => {
    if (!allowIp(req.ip ?? 'unknown')) return fail(res, 'RATE_LIMITED');
    const parsed = schemas.register.safeParse(req.body);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const input = parsed.data;
    if (!email.safeParse(input.email).success) return fail(res, 'INVALID_EMAIL');
    if (!password.safeParse(input.password).success) return fail(res, 'WEAK_PASSWORD');
    const outcome = await auth.register(
      {
        email: input.email,
        password: input.password,
        // Carries the guest's nickname / avatar over when the client sends them.
        nickname: sanitizeName(input.nickname),
        avatar: normalizeAvatar(input.avatar, avatars),
      },
      req.get('user-agent') ?? null,
    );
    if (!outcome.ok) return fail(res, outcome.error);
    const claimed = await claim(input.guestTokens, outcome.user.id);
    const { unlocked, restoredTitles } = await checkAchievements(outcome.user.id);
    res
      .status(201)
      .json({ ok: true, token: outcome.token, user: (await freshAccount(outcome.user.id)) ?? toPublicAccount(outcome.user), claimed, achievements: unlocked, restoredTitles });
  });

  router.post('/api/auth/login', async (req, res) => {
    if (!allowIp(req.ip ?? 'unknown')) return fail(res, 'RATE_LIMITED');
    const parsed = schemas.login.safeParse(req.body);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const input = parsed.data;
    const key = normalizeEmail(input.email);
    if (!email.safeParse(key).success) return fail(res, 'BAD_CREDENTIALS');
    // Checked before the password, so a correct guess after the limit doesn't get through either.
    if (failures.locked(key)) return fail(res, 'RATE_LIMITED');
    const outcome = await auth.login(key, input.password, req.get('user-agent') ?? null);
    if (!outcome.ok) {
      // Only failures count, so a legitimate user isn't locked out by their own logins.
      failures.note(key);
      return fail(res, outcome.error);
    }
    const claimed = await claim(input.guestTokens, outcome.user.id);
    const { unlocked, restoredTitles } = await checkAchievements(outcome.user.id);
    res.json({ ok: true, token: outcome.token, user: (await freshAccount(outcome.user.id)) ?? toPublicAccount(outcome.user), claimed, achievements: unlocked, restoredTitles });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const identity = await auth.identify(bearerToken(req));
    if (identity) await auth.logout(identity);
    res.json({ ok: true });
  });

  router.get('/api/me', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const stats = await store.stats(me.userId);
    const { unlocked: newAchievements, restoredTitles } = await checkAchievements(me.userId, stats);
    const user = newAchievements.length ? ((await freshAccount(me.userId)) ?? toPublicAccount(me.user)) : toPublicAccount(me.user);
    res.json({ ok: true, user, stats, newAchievements, restoredTitles });
  });

  router.patch('/api/me', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const parsed = schemas.profile.safeParse(req.body);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const patch: { nickname?: string; avatar?: string } = {};
    if (parsed.data.nickname !== undefined) {
      const raw = parsed.data.nickname.trim();
      if (!raw || raw.length > MAX_NAME_LENGTH) return fail(res, 'INVALID_NICKNAME', `Nickname cần từ 1 đến ${MAX_NAME_LENGTH} ký tự.`);
      patch.nickname = sanitizeName(raw);
    }
    if (parsed.data.avatar !== undefined) {
      const value = normalizeAvatar(parsed.data.avatar, avatars);
      if (!value) return fail(res, 'INVALID_AVATAR');
      patch.avatar = value;
    }
    const user = await store.updateProfile(me.userId, patch);
    res.json({ ok: true, user: user && toPublicAccount(user) });
  });

  router.post('/api/me/claim', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const parsed = schemas.claim.safeParse(req.body);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const claimed = await claim(parsed.data.guestTokens, me.userId);
    const { unlocked, restoredTitles } = claimed ? await checkAchievements(me.userId) : { unlocked: [], restoredTitles: [] };
    res.json({ ok: true, claimed, achievements: unlocked, restoredTitles });
  });

  router.get('/api/me/stats', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    res.json({ ok: true, stats: await store.stats(me.userId) });
  });

  router.get('/api/me/achievements', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    res.json({ ok: true, ...(await achievements.overview(me.userId)) });
  });

  router.get('/api/titles', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, titles: titles.catalog() });
  });

  router.get('/api/me/titles', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    res.json({ ok: true, ...(await titles.collection(me.userId)) });
  });

  router.patch('/api/me/title', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const parsed = schemas.equipTitle.safeParse(req.body);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const outcome = await titles.equip(me.userId, parsed.data.titleId);
    if (!outcome.ok) return fail(res, outcome.error);
    res.json({ ok: true, titleId: outcome.titleId, title: outcome.title, user: await freshAccount(me.userId) });
  });

  router.get('/api/me/matches', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const parsed = schemas.matches.safeParse(req.query);
    if (!parsed.success) return fail(res, 'INVALID_PAYLOAD');
    const { limit, before, mode } = parsed.data;
    const rows = await store.listMatches(me.userId, { limit: limit + 1, before, mode });
    const page = rows.slice(0, limit);
    res.json({
      ok: true,
      matches: page.map((m) => toPublicMatch(m, false)),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    });
  });

  router.get('/api/me/matches/:id', async (req, res) => {
    const me = await requireUser(req, res);
    if (!me) return;
    const id = Number(req.params.id);
    const match = Number.isInteger(id) && id > 0 ? await store.getMatch(me.userId, id) : null;
    if (!match) return fail(res, 'NOT_FOUND');
    res.json({ ok: true, match: toPublicMatch(match, true) });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large' || type === 'entity.parse.failed') return fail(res, 'INVALID_PAYLOAD');
    console.error('[accounts] request failed', err);
    fail(res, 'INTERNAL');
  };
  router.use(['/api/auth', '/api/me'], onError);

  return router;
}

/** Failed attempts per key within a sliding window. */
function createFailureCounter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    locked(key: string) {
      return recent(key, Date.now()).length >= max;
    },
    note(key: string) {
      const now = Date.now();
      if (hits.size > 10_000) for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k);
      hits.set(key, [...recent(key, now), now]);
    },
  };
}
