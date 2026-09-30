import express, { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { bearerToken } from '../accounts/authRoutes.js';
import type { AuthService } from '../accounts/authService.js';
import { createIpLimiter } from '../avatars/avatarRoutes.js';
import { AvatarFrameError, AVATAR_FRAME_ERROR_MESSAGES, type AvatarFrameErrorCode, type AvatarFrameService } from './avatarFrameService.js';

type RouteError = AvatarFrameErrorCode | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL';

const MESSAGES: Record<RouteError, string> = {
  ...AVATAR_FRAME_ERROR_MESSAGES,
  UNAUTHORIZED: 'Bạn cần đăng nhập để dùng khung avatar.',
  RATE_LIMITED: 'Bạn thao tác nhanh quá, chờ chút nhé.',
  INTERNAL: 'Không thể trang bị khung avatar lúc này.',
};

const STATUS: Record<RouteError, number> = {
  INVALID_FRAME: 400,
  UNAUTHORIZED: 401,
  NOT_ENOUGH_COIN: 402,
  FRAME_NOT_OWNED: 403,
  FRAME_NOT_PURCHASABLE: 403,
  ACHIEVEMENT_REQUIRED: 403,
  FRAME_NOT_FOUND: 404,
  ALREADY_OWNED: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Pushed to the account's other tabs / devices after a purchase or an equip. */
export type AvatarFrameChangeNotifier = (userId: string, patch: { coins?: number; avatarFrame?: string }) => void;

/**
 * Avatar frames over HTTP (JSON, `Authorization: Bearer <jwt>`):
 *
 *   GET  /api/avatar-frames              → { frames } the catalogue for guests (secret frames masked)
 *   GET  /api/me/avatar-frames           → { frames, ownedAvatarFrames, equippedAvatarFrame, coins }
 *   POST /api/me/avatar-frames/:id/buy   → { frame, ownedAvatarFrames, equippedAvatarFrame, coins }
 *   POST /api/me/avatar-frames/:id/equip → { ownedAvatarFrames, equippedAvatarFrame, coins }
 *
 * The only input is the frame id in the URL. Anything in the body (a price,
 * a rarity, "owned: true") is ignored: AvatarFrameService resolves it all.
 */
export function createAvatarFrameRouter(auth: AuthService, frames: AvatarFrameService, notify: AvatarFrameChangeNotifier = () => {}): Router {
  const router = Router();
  // Per account: a purchase or an equip is a DB write and (for equip) a broadcast to every room the player sits in.
  const allow = createIpLimiter(12, 10_000);
  const paths = ['/api/avatar-frames', '/api/me/avatar-frames'];

  const fail = (res: Response, error: RouteError, message = MESSAGES[error]) => res.status(STATUS[error]).json({ ok: false, error, message });

  router.use(paths, express.json({ limit: '2kb' }), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const requireUserId = (req: Request, res: Response) => {
    const identity = auth.identify(bearerToken(req));
    if (!identity || !auth.store.getUser(identity.userId)) {
      fail(res, 'UNAUTHORIZED');
      return null;
    }
    return identity.userId;
  };

  /** Runs a buy/equip, mapping catalogue refusals to their error codes. */
  const act = (res: Response, fn: () => object) => {
    try {
      res.json({ ok: true, ...fn() });
    } catch (err) {
      if (err instanceof AvatarFrameError) return fail(res, err.code, err.message);
      throw err;
    }
  };

  router.get('/api/avatar-frames', (_req, res) => {
    res.json({ ok: true, frames: frames.catalogue() });
  });

  router.get('/api/me/avatar-frames', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    res.json({ ok: true, ...frames.overview(userId) });
  });

  router.post('/api/me/avatar-frames/:id/buy', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    if (!allow(userId)) return fail(res, 'RATE_LIMITED');
    act(res, () => {
      const result = frames.buy(userId, req.params.id);
      notify(userId, { coins: result.coins });
      return result;
    });
  });

  router.post('/api/me/avatar-frames/:id/equip', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    if (!allow(userId)) return fail(res, 'RATE_LIMITED');
    act(res, () => {
      const result = frames.equip(userId, req.params.id);
      notify(userId, { avatarFrame: result.equippedAvatarFrame });
      return result;
    });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[avatar-frames] request failed', err);
    fail(res, 'INTERNAL');
  };
  router.use(paths, onError);

  return router;
}
