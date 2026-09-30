import express, { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { bearerToken } from '../accounts/authRoutes.js';
import type { AuthService } from '../accounts/authService.js';
import { createIpLimiter } from '../avatars/avatarRoutes.js';
import { NameStyleError, NAME_STYLE_ERROR_MESSAGES, type NameStyleErrorCode, type NameStyleService } from './nameStyleService.js';

type RouteError = NameStyleErrorCode | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL';

const MESSAGES: Record<RouteError, string> = {
  ...NAME_STYLE_ERROR_MESSAGES,
  UNAUTHORIZED: 'Bạn cần đăng nhập để dùng hiệu ứng tên.',
  RATE_LIMITED: 'Bạn thao tác nhanh quá, chờ chút nhé.',
  INTERNAL: 'Máy chủ gặp sự cố, thử lại sau nhé.',
};

const STATUS: Record<RouteError, number> = {
  INVALID_STYLE: 400,
  UNAUTHORIZED: 401,
  NOT_ENOUGH_COIN: 402,
  STYLE_NOT_OWNED: 403,
  STYLE_LOCKED: 403,
  ACHIEVEMENT_REQUIRED: 403,
  STYLE_NOT_FOUND: 404,
  ALREADY_OWNED: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Pushed to the account's other tabs / devices after a purchase or an equip. */
export type AccountChangeNotifier = (userId: string, patch: { coins?: number; nameStyle?: string }) => void;

/**
 * Name styles over HTTP (JSON, `Authorization: Bearer <jwt>`):
 *
 *   GET  /api/name-styles              → the catalogue (secret styles masked)
 *   GET  /api/me/name-styles           → { styles (with owned/equipped), equipped, coins }
 *   POST /api/me/name-styles/:id/buy   → { style, coins }
 *   POST /api/me/name-styles/:id/equip → { equipped }
 *
 * The only input is the style id in the URL. Anything in the body (a price, a
 * rarity, "owned: true") is ignored: NameStyleService resolves it all.
 */
export function createNameStyleRouter(auth: AuthService, nameStyles: NameStyleService, notify: AccountChangeNotifier = () => {}): Router {
  const router = Router();
  // Per account: a purchase or an equip is a DB write and (for equip) a broadcast to every room the player sits in.
  const allow = createIpLimiter(12, 10_000);

  const fail = (res: Response, error: RouteError, message = MESSAGES[error]) => res.status(STATUS[error]).json({ ok: false, error, message });

  router.use(['/api/name-styles', '/api/me/name-styles'], express.json({ limit: '2kb' }), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const requireUserId = async (req: Request, res: Response) => {
    const identity = await auth.identify(bearerToken(req));
    if (!identity || !(await auth.store.getUser(identity.userId))) {
      fail(res, 'UNAUTHORIZED');
      return null;
    }
    return identity.userId;
  };

  /** Runs a buy/equip, mapping catalogue refusals to their error codes. */
  const act = async (res: Response, fn: () => Promise<object>) => {
    try {
      res.json({ ok: true, ...(await fn()) });
    } catch (err) {
      if (err instanceof NameStyleError) return fail(res, err.code, err.message);
      throw err;
    }
  };

  router.get('/api/name-styles', (_req, res) => {
    res.json({ ok: true, styles: nameStyles.catalogue() });
  });

  router.get('/api/me/name-styles', async (req, res) => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    res.json({ ok: true, ...(await nameStyles.overview(userId)) });
  });

  router.post('/api/me/name-styles/:id/buy', async (req, res) => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    if (!allow(userId)) return fail(res, 'RATE_LIMITED');
    await act(res, async () => {
      const result = await nameStyles.buy(userId, req.params.id);
      notify(userId, { coins: result.coins });
      return result;
    });
  });

  router.post('/api/me/name-styles/:id/equip', async (req, res) => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    if (!allow(userId)) return fail(res, 'RATE_LIMITED');
    await act(res, async () => {
      const result = await nameStyles.equip(userId, req.params.id);
      notify(userId, { nameStyle: result.equipped });
      return result;
    });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[name-styles] request failed', err);
    fail(res, 'INTERNAL');
  };
  router.use(['/api/name-styles', '/api/me/name-styles'], onError);

  return router;
}
