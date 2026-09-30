import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT. Only what the server needs: it signs its own tokens and
 * only ever accepts HS256 (no `alg` negotiation, so no `alg: none` tricks).
 * A token is not enough on its own: `sid` must also name a live row in the
 * sessions table, which is what makes logout effective.
 */

export interface AuthClaims {
  /** User id. */
  sub: string;
  /** Session id (row in `sessions`). */
  sid: string;
  iat: number;
  exp: number;
}

const ISSUER = 'caro-online';
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest();

export function signToken(claims: Omit<AuthClaims, 'iat' | 'exp'>, secret: string, ttlMs: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = { iss: ISSUER, sub: claims.sub, sid: claims.sid, iat, exp: iat + Math.floor(ttlMs / 1000) };
  const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

export function verifyToken(token: unknown, secret: string, now = Date.now()): AuthClaims | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown };
    if (h.alg !== 'HS256') return null;
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (c.iss !== ISSUER || typeof c.sub !== 'string' || typeof c.sid !== 'string') return null;
    if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp * 1000 <= now) return null;
    return { sub: c.sub, sid: c.sid, iat: c.iat, exp: c.exp };
  } catch {
    return null;
  }
}
