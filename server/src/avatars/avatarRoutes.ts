import express, { Router, type ErrorRequestHandler } from 'express';
import type { AvatarConfig } from '../config.js';
import { LOCAL_AVATAR_FILE, LocalAvatarStorage, MAX_AVATAR_DIMENSION, sniffImage, type AvatarStorage } from './avatars.js';

type UploadError = 'INVALID_IMAGE' | 'TOO_LARGE' | 'RATE_LIMITED' | 'UPLOAD_FAILED';

const MESSAGES: Record<UploadError, string> = {
  INVALID_IMAGE: 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.',
  TOO_LARGE: 'Ảnh quá lớn.',
  RATE_LIMITED: 'Bạn đổi ảnh quá nhiều lần, thử lại sau ít phút nhé.',
  UPLOAD_FAILED: 'Không lưu được ảnh, hãy thử lại.',
};

/**
 * `POST /api/avatars`: the raw image as the request body (the client crops it
 * to 256×256 first). Answers `{ ok: true, avatar }` with the value to send in
 * `player:avatar`. `GET /api/avatars/files/:file` serves local uploads.
 *
 * Guests have no account, so abuse is bounded per IP instead.
 */
export function createAvatarRouter(cfg: AvatarConfig, storage: AvatarStorage): Router {
  const router = Router();
  const allow = createIpLimiter(cfg.uploadBurst, cfg.uploadWindowMs);
  const fail = (res: express.Response, status: number, error: UploadError, message = MESSAGES[error]) =>
    res.status(status).json({ ok: false, error, message });

  router.post('/api/avatars', express.raw({ type: () => true, limit: cfg.maxBytes }), async (req, res) => {
    if (!allow(req.ip ?? 'unknown')) return fail(res, 429, 'RATE_LIMITED');
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const image = sniffImage(bytes);
    if (!image) return fail(res, 415, 'INVALID_IMAGE');
    if (image.width > MAX_AVATAR_DIMENSION || image.height > MAX_AVATAR_DIMENSION) {
      return fail(res, 413, 'TOO_LARGE', `Ảnh tối đa ${MAX_AVATAR_DIMENSION}×${MAX_AVATAR_DIMENSION} px.`);
    }
    try {
      res.status(201).json({ ok: true, avatar: await storage.save(image) });
    } catch (err) {
      console.error('[avatars] upload failed', err);
      fail(res, 502, 'UPLOAD_FAILED');
    }
  });

  if (storage instanceof LocalAvatarStorage) {
    router.get('/api/avatars/files/:file', (req, res) => {
      const file = String(req.params.file);
      if (!LOCAL_AVATAR_FILE.test(file)) return res.status(404).end();
      res.sendFile(
        file,
        {
          root: storage.dir,
          dotfiles: 'deny',
          maxAge: '365d',
          immutable: true,
          headers: {
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
            // The frontend is on another origin in production (Vercel).
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        },
        (err) => {
          if (err && !res.headersSent) res.status(404).end();
        },
      );
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if ((err as { type?: string }).type === 'entity.too.large') {
      return fail(res, 413, 'TOO_LARGE', `Ảnh tối đa ${Math.round(cfg.maxBytes / 1024)} KB.`);
    }
    fail(res, 400, 'INVALID_IMAGE');
  };
  router.use('/api/avatars', onError);

  return router;
}

/** Sliding-window budget per key (an IP, an email…). */
export function createIpLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (ip: string) => {
    const now = Date.now();
    if (hits.size > 5_000) {
      for (const [key, list] of hits) if (!list.length || now - list[list.length - 1] > windowMs) hits.delete(key);
    }
    const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    const ok = list.length < max;
    if (ok) list.push(now);
    hits.set(ip, list);
    return ok;
  };
}
