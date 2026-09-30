import type { AccountsConfig } from '../config.js';
import type { AccountStore, UserRow } from './accountStore.js';
import { resolveAvatarFrameId } from '../cosmetics/avatarFrames.js';
import { resolveNameStyleId } from '../cosmetics/nameStyles.js';
import { publicTitleOf, type PublicTitle } from '../titles/titles.js';
import { signToken, verifyToken } from './jwt.js';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from './password.js';

/** What the client learns about its own account. Never includes the hash. */
export interface PublicAccount {
  id: string;
  email: string;
  nickname: string;
  avatar: string | null;
  createdAt: number;
  coins: number;
  /** The equipped title, null for none. */
  title: PublicTitle | null;
  /** The equipped name style id (`default` for none). */
  nameStyle: string;
  /** The equipped avatar frame id (`frame_default` for none). */
  avatarFrame: string;
}

export const toPublicAccount = (u: UserRow): PublicAccount => ({
  id: u.id,
  email: u.email,
  nickname: u.nickname,
  avatar: u.avatar,
  createdAt: u.createdAt,
  coins: u.coins,
  title: publicTitleOf(u.equippedTitleId),
  nameStyle: resolveNameStyleId(u.nameStyleId),
  avatarFrame: resolveAvatarFrameId(u.avatarFrameId),
});

export interface Identity {
  userId: string;
  sessionId: string;
}

export type AuthOutcome = { ok: true; token: string; user: UserRow } | { ok: false; error: 'EMAIL_TAKEN' | 'BAD_CREDENTIALS' };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Register / login / verify. Issues a JWT bound to a session row: the token
 * proves who you are, the row lets logout revoke it before it expires.
 */
export class AuthService {
  private secret: string | null;

  constructor(
    readonly store: AccountStore,
    private readonly cfg: AccountsConfig,
  ) {
    this.secret = cfg.jwtSecret;
  }

  private key() {
    // No JWT_SECRET: a random key generated once and kept in the database, so restarts don't sign everyone out.
    return (this.secret ??= this.store.persistentSecret('jwt_secret'));
  }

  private issue(user: UserRow, userAgent: string | null): string {
    const session = this.store.createSession(user.id, this.cfg.sessionTtlMs, userAgent);
    return signToken({ sub: user.id, sid: session.id }, this.key(), this.cfg.sessionTtlMs);
  }

  async register(input: { email: string; password: string; nickname: string; avatar: string | null }, userAgent: string | null): Promise<AuthOutcome> {
    const email = normalizeEmail(input.email);
    if (this.store.findUserByEmail(email)) return { ok: false, error: 'EMAIL_TAKEN' };
    const passwordHash = await hashPassword(input.password);
    // Re-checked by the UNIQUE constraint, in case two sign-ups race.
    const user = this.store.createUser({ email, passwordHash, nickname: input.nickname, avatar: input.avatar });
    if (!user) return { ok: false, error: 'EMAIL_TAKEN' };
    return { ok: true, token: this.issue(user, userAgent), user };
  }

  async login(emailRaw: string, password: string, userAgent: string | null): Promise<AuthOutcome> {
    const user = this.store.findUserByEmail(normalizeEmail(emailRaw));
    if (!user) {
      await burnPasswordCheck(password);
      return { ok: false, error: 'BAD_CREDENTIALS' };
    }
    if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: 'BAD_CREDENTIALS' };
    if (needsRehash(user.passwordHash)) this.store.setPasswordHash(user.id, await hashPassword(password));
    this.store.touchLogin(user.id);
    return { ok: true, token: this.issue(user, userAgent), user };
  }

  /** Resolves a bearer token to a live session, or null (expired, revoked, tampered, or the user is gone). */
  identify(token: unknown): Identity | null {
    if (typeof token !== 'string' || !token) return null;
    const claims = verifyToken(token, this.key());
    if (!claims) return null;
    const session = this.store.getSession(claims.sid);
    if (!session || session.userId !== claims.sub) return null;
    return { userId: claims.sub, sessionId: session.id };
  }

  logout(identity: Identity) {
    this.store.deleteSession(identity.sessionId);
  }
}
