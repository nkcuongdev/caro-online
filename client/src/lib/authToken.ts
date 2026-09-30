/**
 * The persisted login: `localStorage['caro:auth'] = { token, user }`.
 *
 * Kept apart from lib/account.ts so the socket (which sends the token in its
 * handshake) can read it without importing the account store, which itself
 * uses the socket.
 */

import type { PublicTitle } from './titles';

export interface Account {
  id: string;
  email: string;
  nickname: string;
  avatar: string | null;
  createdAt: number;
  /** Coin balance. Missing on logins stored before coins existed. */
  coins?: number;
  /** Equipped title. Missing on logins stored before titles existed (= none). */
  title?: PublicTitle | null;
  /** Equipped name style id. Missing on logins stored before name styles existed (= default). */
  nameStyle?: string;
  /** Equipped avatar frame id. Missing on logins stored before frames existed (= `frame_default`). */
  avatarFrame?: string;
}

export interface StoredAuth {
  token: string;
  user: Account;
}

export const AUTH_KEY = 'caro:auth';

export function readStoredAuth(): StoredAuth | null {
  try {
    const v = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as StoredAuth | null;
    return v && typeof v.token === 'string' && v.user && typeof v.user.id === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredAuth(auth: StoredAuth | null) {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // Private mode: the login lasts until the tab closes (the store keeps it in memory).
  }
}

let memory: StoredAuth | null | undefined;

/** The current login token, or null for a guest. */
export function getAuthToken(): string | null {
  if (memory === undefined) memory = readStoredAuth();
  return memory?.token ?? null;
}

/** Keeps the in-memory copy in step with the store (storage may be blocked). */
export function setAuthMemory(auth: StoredAuth | null) {
  memory = auth;
}
