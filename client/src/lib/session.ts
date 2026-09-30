import {
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  DEFAULT_TURN_SECONDS,
  TURN_SECONDS,
  type BoardSize,
  type BotSettings,
  type TurnSeconds,
} from './protocol';

/**
 * Reconnect credentials.
 *
 * - sessionStorage: this tab's seat. Survives reload, so a reload reclaims the
 *   seat immediately (taking over the old, dying socket).
 * - localStorage: every seat this browser holds. Survives closing the tab, so
 *   reopening the invite link reconnects, but only if that seat is offline.
 *   That way a second tab in the same browser can still join as the opponent.
 */
export interface StoredSession {
  roomId: string;
  playerId: string;
  token: string;
  savedAt: number;
}

const TAB_KEY = (roomId: string) => `caro:tab:${roomId}`;
const ALL_KEY = 'caro:sessions';
const NAME_KEY = 'caro:name';
const BOT_KEY = 'caro:bot';
const BOARD_KEY = 'caro:boardSize';
const TURN_KEY = 'caro:turnSeconds';
const PLAYED_KEY = 'caro:played';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readAll(): StoredSession[] {
  return safe(() => {
    const list = JSON.parse(localStorage.getItem(ALL_KEY) ?? '[]') as StoredSession[];
    return Array.isArray(list) ? list.filter((s) => Date.now() - s.savedAt < MAX_AGE_MS) : [];
  }, []);
}

function writeAll(list: StoredSession[]) {
  safe(() => localStorage.setItem(ALL_KEY, JSON.stringify(list.slice(-30))), undefined);
}

export function getTabSession(roomId: string): StoredSession | null {
  return safe(() => JSON.parse(sessionStorage.getItem(TAB_KEY(roomId)) ?? 'null'), null);
}

export function getStoredSessions(roomId: string): StoredSession[] {
  return readAll()
    .filter((s) => s.roomId === roomId)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveSession(roomId: string, playerId: string, token: string) {
  const entry: StoredSession = { roomId, playerId, token, savedAt: Date.now() };
  safe(() => sessionStorage.setItem(TAB_KEY(roomId), JSON.stringify(entry)), undefined);
  writeAll([...readAll().filter((s) => s.token !== token), entry]);
  rememberPlayedSeat(token);
}

// ─── Seats played as a guest ─────────────────────────────────────────────────
// Kept even after leaving the room (unlike the reconnect list above): on sign-up
// or login the tokens go to the server, which moves those games into the account.

interface PlayedSeat {
  token: string;
  savedAt: number;
}

function readPlayed(): PlayedSeat[] {
  return safe(() => {
    const list = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]') as PlayedSeat[];
    return Array.isArray(list) ? list.filter((s) => typeof s?.token === 'string' && Date.now() - s.savedAt < MAX_AGE_MS) : [];
  }, []);
}

function rememberPlayedSeat(token: string) {
  const list = [...readPlayed().filter((s) => s.token !== token), { token, savedAt: Date.now() }].slice(-40);
  safe(() => localStorage.setItem(PLAYED_KEY, JSON.stringify(list)), undefined);
}

/** Seat tokens from the last day, newest last. Proof of the games played in them. */
export function getPlayedSeatTokens(): string[] {
  const tokens = new Set([...readAll().map((s) => s.token), ...readPlayed().map((s) => s.token)]);
  return [...tokens].slice(-40);
}

/** After the games moved into an account there's nothing left to claim. */
export function clearPlayedSeats() {
  safe(() => localStorage.removeItem(PLAYED_KEY), undefined);
}

export function forgetSession(roomId: string, token?: string) {
  const tab = getTabSession(roomId);
  if (!token || tab?.token === token) safe(() => sessionStorage.removeItem(TAB_KEY(roomId)), undefined);
  writeAll(readAll().filter((s) => (token ? s.token !== token : s.roomId !== roomId)));
}

export function getSavedName(): string {
  return safe(() => localStorage.getItem(NAME_KEY) ?? '', '');
}

const nameListeners = new Set<(name: string) => void>();

export function saveName(name: string) {
  const value = name.trim().slice(0, 20);
  safe(() => localStorage.setItem(NAME_KEY, value), undefined);
  if (value) nameListeners.forEach((fn) => fn(value));
}

/** Called with every saved name (the account store mirrors it to the profile). */
export function onNameSaved(fn: (name: string) => void) {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

/** Last difficulty / first-move choice for playing against the bot. */
export function getSavedBotSettings(): BotSettings {
  const fallback: BotSettings = { difficulty: 'medium', firstMove: 'human' };
  return safe(() => ({ ...fallback, ...(JSON.parse(localStorage.getItem(BOT_KEY) ?? '{}') as Partial<BotSettings>) }), fallback);
}

export function saveBotSettings(settings: BotSettings) {
  safe(() => localStorage.setItem(BOT_KEY, JSON.stringify(settings)), undefined);
}

/** Last board size picked in the lobby. */
export function getSavedBoardSize(): BoardSize {
  const saved = safe(() => Number(localStorage.getItem(BOARD_KEY)), NaN);
  return BOARD_SIZES.find((s) => s === saved) ?? DEFAULT_BOARD_SIZE;
}

export function saveBoardSize(size: BoardSize) {
  safe(() => localStorage.setItem(BOARD_KEY, String(size)), undefined);
}

/** Last turn time picked in the lobby. */
export function getSavedTurnSeconds(): TurnSeconds {
  const saved = safe(() => Number(localStorage.getItem(TURN_KEY)), NaN);
  return TURN_SECONDS.find((s) => s === saved) ?? DEFAULT_TURN_SECONDS;
}

export function saveTurnSeconds(seconds: TurnSeconds) {
  safe(() => localStorage.setItem(TURN_KEY, String(seconds)), undefined);
}
