import { useSyncExternalStore } from 'react';
import { clearUnlockPopups, enqueueUnlocks, type AchievementOverview, type UnlockedAchievement } from './achievements';
import { getMyAvatar, onMyAvatarChange, setMyAvatar } from './avatar';
import { AUTH_KEY, readStoredAuth, setAuthMemory, writeStoredAuth, type Account, type StoredAuth } from './authToken';
import { apiUrl } from './env';
import { DEFAULT_AVATAR_FRAME, type AvatarFrameOverview, type AvatarFrameState, type AvatarFrameView } from './avatarFrames';
import type { NameStyleOverview, NameStyleView } from './nameStyles';
import type { BotDifficulty, FinishReason, Mark, RoomMode } from './protocol';
import { clearPlayedSeats, getPlayedSeatTokens, getSavedName, onNameSaved, saveName } from './session';
import { socket } from './socket';
import type { PublicTitle, TitleCollection } from './titles';

/**
 * Optional accounts. Guests keep playing exactly as before; signing in adds a
 * profile stored on the server, full match history and stats.
 *
 * The browser's nickname / avatar (lib/session.ts, lib/avatar.ts) stay the
 * single source every screen reads. While signed in they mirror the profile:
 * signing in writes the profile into them, and later changes (lobby, in-game
 * rename, avatar picker) are sent back to the profile.
 */

export type { Account } from './authToken';

export type MatchResult = 'win' | 'loss' | 'draw';

export interface ModeStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface PlayerStats {
  overall: ModeStats;
  byMode: Record<RoomMode, ModeStats>;
  botWins: Record<BotDifficulty, number>;
  currentStreak: { result: MatchResult | null; count: number };
  bestWinStreak: number;
  tournamentTitles: number;
  totalMoves: number;
  totalPlayMs: number;
  fastestWinMoves: number | null;
  favoriteBoardSize: number | null;
  recentForm: MatchResult[];
  xp: number;
  level: number;
  levelFloorXp: number;
  nextLevelXp: number;
}

export interface MatchSummary {
  id: number;
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
  opponentRegistered: boolean;
  botDifficulty: BotDifficulty | null;
  boardSize: number;
  turnMs: number;
  moveCount: number;
  winLine: number[] | null;
  startedAt: number;
  finishedAt: number;
  tournamentId: string | null;
  tournamentName: string | null;
  tournamentRound: number | null;
  tournamentTotalRounds: number | null;
}

export interface MatchDetail extends MatchSummary {
  moves: number[];
}

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; message: string };

// ─── Store ───────────────────────────────────────────────────────────────────

export interface AuthState {
  token: string | null;
  user: Account | null;
}

export type AuthModalMode = 'login' | 'register';

let state: AuthState = toState(readStoredAuth());
let modal: AuthModalMode | null = null;
/** Last stats fetched for the signed-in user (the header badge shows the level). */
let stats: PlayerStats | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function toState(auth: StoredAuth | null): AuthState {
  setAuthMemory(auth);
  return { token: auth?.token ?? null, user: auth?.user ?? null };
}

function setAuth(auth: StoredAuth | null) {
  writeStoredAuth(auth);
  if (auth?.user.id !== state.user?.id) {
    stats = null;
    clearUnlockPopups();
  }
  state = toState(auth);
  emit();
  identifySocket();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getAuth = () => state;
export const useAuth = () => useSyncExternalStore(subscribe, getAuth);
/** The frame this browser's player wears: the account's equipped one, or none for guests. */
export const useMyAvatarFrame = () => useSyncExternalStore(subscribe, () => state.user?.avatarFrame ?? DEFAULT_AVATAR_FRAME);
export const useAccountStats = () => useSyncExternalStore(subscribe, () => stats);

/** The login / register dialog is global, so any screen can open it. */
export const useAuthModal = () => useSyncExternalStore(subscribe, () => modal);
export function openAuthModal(mode: AuthModalMode = 'login') {
  modal = mode;
  emit();
}
export function closeAuthModal() {
  modal = null;
  emit();
}

/** Tells the live socket who it is, so logging in or out mid-game keeps the seat and the clock. */
function identifySocket() {
  if (!socket.connected) return; // the next handshake carries the token anyway
  void socket
    .timeout(5_000)
    .emitWithAck('auth:identify', { token: state.token })
    .then((res: { ok: boolean; error?: string }) => {
      if (!res.ok && res.error === 'AUTH_INVALID') setAuth(null);
    })
    .catch(() => {});
}

// Another tab logged in or out.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== AUTH_KEY) return;
    const next = readStoredAuth();
    if (next?.user.id !== state.user?.id) stats = null;
    state = toState(next);
    emit();
    identifySocket();
  });
}

/** Name of the seat this tab plays right now (may be server-picked); the fallback for the guest's nickname. */
let seatName: string | null = null;
export function noteSeatName(name: string | null) {
  seatName = name;
}
/** The nickname a guest is known by: the one they saved, else the one they're playing under. */
export const guestNickname = () => getSavedName() || seatName || '';

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 12_000): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (res.status === 401 && state.token && path.startsWith('/api/me')) setAuth(null); // revoked or expired
    return json ?? { ok: false, error: 'INTERNAL', message: 'Máy chủ trả về dữ liệu không hợp lệ.' };
  } catch {
    return { ok: false, error: 'NETWORK', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại nhé.' };
  }
}

/** `achievements`: unlocked by this sign-in (claimed guest games, or history from before achievements existed). */
type AuthPayload = { token: string; user: Account; claimed: number; achievements?: UnlockedAchievement[]; restoredTitles?: PublicTitle[] };

/** What happens to the guest's nickname / avatar after logging in to an account that has its own. */
export interface ProfileChoice {
  account: { nickname: string; avatar: string | null };
  guest: { nickname: string; avatar: string };
}

export type AuthDone = { ok: true; claimed: number; choice: ProfileChoice | null } | { ok: false; error: string; message: string };

function finishAuth(res: ApiResult<AuthPayload>, applyProfile: boolean): AuthDone {
  if (!res.ok) return res;
  const guest = { nickname: guestNickname(), avatar: getMyAvatar() };
  setAuth({ token: res.token, user: res.user });
  clearPlayedSeats();
  enqueueUnlocks(res.achievements, res.restoredTitles);
  const differs = guest.nickname !== res.user.nickname || (!!res.user.avatar && guest.avatar !== res.user.avatar);
  // Nothing to decide when the guest never set a name: the account's profile simply applies.
  if (applyProfile || !differs || !guest.nickname) {
    applyAccountProfile();
    return { ok: true, claimed: res.claimed, choice: null };
  }
  return { ok: true, claimed: res.claimed, choice: { account: { nickname: res.user.nickname, avatar: res.user.avatar }, guest } };
}

export async function register(input: { email: string; password: string; nickname: string; avatar: string }): Promise<AuthDone> {
  const res = await call<AuthPayload>('POST', '/api/auth/register', { ...input, guestTokens: getPlayedSeatTokens() });
  return finishAuth(res, true);
}

export async function login(email: string, password: string): Promise<AuthDone> {
  const res = await call<AuthPayload>('POST', '/api/auth/login', { email, password, guestTokens: getPlayedSeatTokens() });
  return finishAuth(res, false);
}

export async function logout() {
  const token = state.token;
  setAuth(null);
  if (token) {
    // Revoke on the server too; the local sign-out already happened either way.
    void fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

/** Writes the account's nickname / avatar into this browser, so every screen and new room uses them. */
export function applyAccountProfile() {
  const user = state.user;
  if (!user) return;
  saveName(user.nickname);
  if (user.avatar) setMyAvatar(user.avatar);
  else void updateProfile({ avatar: getMyAvatar() });
}

/** Keeps the guest look and saves it to the account instead. */
export async function keepGuestProfile(guest: ProfileChoice['guest']) {
  const res = await updateProfile({ nickname: guest.nickname, avatar: guest.avatar });
  if (!res.ok) applyAccountProfile();
  return res;
}

export async function updateProfile(patch: { nickname?: string; avatar?: string }) {
  const res = await call<{ user: Account }>('PATCH', '/api/me', patch);
  if (res.ok && res.user && state.token) setAuthUser(res.user);
  return res;
}

function setAuthUser(user: Account) {
  if (!state.token) return;
  writeStoredAuth({ token: state.token, user });
  state = toState({ token: state.token, user });
  emit();
}

/** Refreshes the profile (and learns whether the login is still valid). */
export async function fetchMe() {
  const res = await call<{ user: Account; stats: PlayerStats; newAchievements?: UnlockedAchievement[]; restoredTitles?: PublicTitle[] }>('GET', '/api/me');
  if (res.ok) {
    stats = res.stats;
    setAuthUser(res.user);
    enqueueUnlocks(res.newAchievements, res.restoredTitles);
  }
  return res;
}

/** Every achievement with the player's progress. The server checks (and backfills) before answering. */
export async function fetchAchievements() {
  const res = await call<AchievementOverview>('GET', '/api/me/achievements');
  if (res.ok) {
    setCoins(res.coins);
    enqueueUnlocks(res.newlyUnlocked, res.restoredTitles);
  }
  return res;
}

/** Every title with ownership. Like the achievements page, the server checks (and backfills) first. */
export async function fetchTitles() {
  const res = await call<TitleCollection & { newlyUnlocked?: UnlockedAchievement[]; restoredTitles?: PublicTitle[] }>('GET', '/api/me/titles');
  if (res.ok) {
    setEquippedTitle(res.titles.find((t) => t.equipped)?.title ?? null);
    enqueueUnlocks(res.newlyUnlocked, res.restoredTitles);
  }
  return res;
}

/**
 * Equips an owned title (null unequips). The server checks ownership; the
 * account (header, profile, rooms) updates as soon as it answers.
 */
export async function equipTitle(titleId: string | null) {
  const res = await call<{ titleId: string | null; title: PublicTitle | null; user: Account | null }>('PATCH', '/api/me/title', { titleId });
  if (res.ok) {
    if (res.user) setAuthUser(res.user);
    else setEquippedTitle(res.title);
  }
  return res;
}

function setEquippedTitle(title: PublicTitle | null) {
  if (state.user && (state.user.title?.id ?? null) !== (title?.id ?? null)) setAuthUser({ ...state.user, title });
}

/** The equipped title of the signed-in player (null for guests or none). */
export const useEquippedTitle = () => useSyncExternalStore(subscribe, () => state.user?.title ?? null);

function setCoins(coins: number) {
  if (state.user && state.user.coins !== coins) setAuthUser({ ...state.user, coins });
}

// Pushed to this account's sockets after a game unlocked something.
socket.on('achievement:unlocked', (event: { achievements: UnlockedAchievement[]; restoredTitles?: PublicTitle[]; coins: number }) => {
  if (!state.user) return;
  setCoins(event.coins);
  enqueueUnlocks(event.achievements, event.restoredTitles);
});

// ─── Name styles ─────────────────────────────────────────────────────────────

/** The collection: every style with owned / equipped, plus the coin balance. */
export async function fetchNameStyles() {
  const res = await call<NameStyleOverview>('GET', '/api/me/name-styles');
  if (res.ok) patchUser({ coins: res.coins, nameStyle: res.equipped });
  return res;
}

/** Buys a style. The server takes the price from its catalogue and answers with the new balance. */
export async function buyNameStyle(id: string) {
  const res = await call<{ style: NameStyleView; coins: number }>('POST', `/api/me/name-styles/${encodeURIComponent(id)}/buy`);
  if (res.ok) patchUser({ coins: res.coins });
  return res;
}

/** Equips an owned style (`default` takes it off). Rooms and tournaments update from the server's broadcast. */
export async function equipNameStyle(id: string) {
  const res = await call<{ equipped: string }>('POST', `/api/me/name-styles/${encodeURIComponent(id)}/equip`);
  if (res.ok) patchUser({ nameStyle: res.equipped });
  return res;
}

// ─── Avatar frames ───────────────────────────────────────────────────────────

/** The collection: every frame with owned / equipped, plus the coin balance. */
export async function fetchAvatarFrames() {
  const res = await call<AvatarFrameOverview>('GET', '/api/me/avatar-frames');
  if (res.ok) patchUser({ coins: res.coins, avatarFrame: res.equippedAvatarFrame });
  return res;
}

/** Buys a frame. The server takes the price from its catalogue and answers with the new state. */
export async function buyAvatarFrame(id: string) {
  const res = await call<AvatarFrameState & { frame: AvatarFrameView }>('POST', `/api/me/avatar-frames/${encodeURIComponent(id)}/buy`);
  if (res.ok) patchUser({ coins: res.coins });
  return res;
}

/** Equips an owned frame (`frame_default` takes it off). Rooms and tournaments update from the server's broadcast. */
export async function equipAvatarFrame(id: string) {
  const res = await call<AvatarFrameState>('POST', `/api/me/avatar-frames/${encodeURIComponent(id)}/equip`);
  if (res.ok) patchUser({ coins: res.coins, avatarFrame: res.equippedAvatarFrame });
  return res;
}

type AccountPatch = { coins?: number; nameStyle?: string; avatarFrame?: string };

function patchUser(patch: AccountPatch) {
  const user = state.user;
  if (!user) return;
  const changed = (Object.keys(patch) as (keyof AccountPatch)[]).some((k) => patch[k] !== undefined && patch[k] !== user[k]);
  if (changed) setAuthUser({ ...user, ...patch });
}

// Another tab or device of this account bought (balance) or equipped (style, frame) something.
socket.on('account:updated', (patch: AccountPatch) => {
  patchUser(patch);
});

// Another tab or device of this account changed its title.
socket.on('title:equipped', (event: { titleId: string | null; title: PublicTitle | null }) => {
  if (state.user) setEquippedTitle(event.title);
});

export const fetchMatches = (opts: { before?: number | null; mode?: RoomMode | null; limit?: number } = {}) => {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit ?? 15));
  if (opts.before) q.set('before', String(opts.before));
  if (opts.mode) q.set('mode', opts.mode);
  return call<{ matches: MatchSummary[]; nextBefore: number | null }>('GET', `/api/me/matches?${q}`);
};

export const fetchMatch = (id: number) => call<{ match: MatchDetail }>('GET', `/api/me/matches/${id}`);

// ─── Profile mirroring ───────────────────────────────────────────────────────

let pending: { nickname?: string; avatar?: string } = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueProfileSync(patch: { nickname?: string; avatar?: string }) {
  const user = state.user;
  if (!user) return;
  if (patch.nickname !== undefined && patch.nickname !== user.nickname) pending.nickname = patch.nickname;
  if (patch.avatar !== undefined && patch.avatar !== user.avatar) pending.avatar = patch.avatar;
  if (!Object.keys(pending).length) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const body = pending;
    pending = {};
    flushTimer = null;
    void updateProfile(body);
  }, 600);
}

onNameSaved((nickname) => queueProfileSync({ nickname }));
onMyAvatarChange((avatar) => queueProfileSync({ avatar }));

// A stored login is re-validated once per page load.
if (state.token) void fetchMe();

// ─── Display helpers ─────────────────────────────────────────────────────────

export const RESULT_LABEL: Record<MatchResult, string> = { win: 'Thắng', loss: 'Thua', draw: 'Hòa' };
