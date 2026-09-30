import { useSyncExternalStore } from 'react';
import { apiUrl } from './env';

/**
 * Guest avatars. A value is one string, as on the wire (`PublicPlayer.avatar`):
 *   - `preset:<id>`                bundled image in public/avatars/<id>.webp
 *   - `preset:bot-<difficulty>`    bundled too, only ever set by the server on bot seats
 *   - `/api/avatars/files/<file>`  uploaded, stored on the game server's disk
 *   - `https://res.cloudinary.com/…` uploaded, stored on Cloudinary
 *
 * Only that string is kept in localStorage, never the image itself.
 */

export interface AvatarPreset {
  id: string;
  label: string;
  src: string;
}

const bundled = (id: string) => `${import.meta.env.BASE_URL}avatars/${id}.webp`;

/** What people can pick. Mirrored in server/src/avatars/avatars.ts. */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'owl', label: 'Cú mèo' },
  { id: 'ghost', label: 'Ma nhỏ' },
  { id: 'robot', label: 'Robot' },
  { id: 'bear', label: 'Gấu' },
  { id: 'tiger', label: 'Hổ' },
  { id: 'frog', label: 'Ếch' },
  { id: 'penguin', label: 'Chim cánh cụt' },
  { id: 'bunny', label: 'Thỏ' },
  { id: 'fox', label: 'Cáo' },
  { id: 'panda', label: 'Gấu trúc' },
  { id: 'dragon', label: 'Rồng' },
  { id: 'cat', label: 'Mèo' },
].map((p) => ({ ...p, src: bundled(p.id) }));

/** Recoloured robots, one per level (server: BOT_AVATARS). Shown, never offered in the picker. */
const BOT_PRESETS = new Set(['bot-easy', 'bot-medium', 'bot-hard']);

const PRESETS = new Map(AVATAR_PRESETS.map((p) => [p.id, p]));
/** A new guest never starts out looking like a bot; they can still pick the robot themselves. */
const STARTER_PRESETS = AVATAR_PRESETS.filter((p) => p.id !== 'robot');

export const presetAvatar = (id: string) => `preset:${id}`;
export const presetId = (avatar: string | null | undefined) =>
  avatar?.startsWith('preset:') && PRESETS.has(avatar.slice(7)) ? avatar.slice(7) : null;
export const isUploadedAvatar = (avatar: string | null | undefined) =>
  !!avatar && (avatar.startsWith('/api/avatars/files/') || avatar.startsWith('https://'));

/** Image URL for an avatar value, or null if it isn't one we can show. */
export function avatarSrc(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  const preset = presetId(avatar);
  if (preset) return PRESETS.get(preset)!.src;
  if (avatar.startsWith('preset:') && BOT_PRESETS.has(avatar.slice(7))) return bundled(avatar.slice(7));
  if (avatar.startsWith('/api/avatars/files/')) return apiUrl(avatar);
  if (avatar.startsWith('https://')) return avatar;
  return null;
}

/** Stable per-player default (same player → same animal on every screen), used when their avatar is missing or broken. */
export function defaultAvatarFor(seed: string): AvatarPreset {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return STARTER_PRESETS[Math.abs(h) % STARTER_PRESETS.length];
}

// ─── This browser's avatar ───────────────────────────────────────────────────

const KEY = 'caro:avatar';
const UPLOAD_KEY = 'caro:avatar:upload';
const listeners = new Set<() => void>();
/** In-memory copy, so the choice holds for the session even when storage is blocked. */
let memory: string | null = null;

const isValid = (v: string | null): v is string => !!v && (presetId(v) !== null || isUploadedAvatar(v));

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / storage full: the in-memory copy still works until reload.
  }
}

/** The saved avatar. The first visit gets a random preset, saved right away so a reload keeps it. */
export function getMyAvatar(): string {
  const stored = read(KEY);
  if (isValid(stored)) return (memory = stored);
  if (!memory) {
    memory = presetAvatar(STARTER_PRESETS[Math.floor(Math.random() * STARTER_PRESETS.length)].id);
    write(KEY, memory);
  }
  return memory;
}

export function setMyAvatar(avatar: string) {
  if (!isValid(avatar)) return;
  memory = avatar;
  write(KEY, avatar);
  if (isUploadedAvatar(avatar)) write(UPLOAD_KEY, avatar);
  listeners.forEach((fn) => fn());
}

/** Called after every change made in this tab (the account store mirrors it to the profile). */
export function onMyAvatarChange(fn: (avatar: string) => void) {
  const listener = () => fn(getMyAvatar());
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last photo this browser uploaded, so switching to a preset and back doesn't need a re-upload. */
export function getLastUploadedAvatar(): string | null {
  const v = read(UPLOAD_KEY);
  return isUploadedAvatar(v) ? v : null;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** This browser's avatar, kept in sync across components and tabs. */
export function useMyAvatar(): string {
  return useSyncExternalStore(subscribe, getMyAvatar);
}

// ─── Upload rules (the server re-checks everything) ──────────────────────────

export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';
export const AVATAR_INPUT_MAX_MB = 8;
/** Side of the square image that gets uploaded. */
export const AVATAR_OUTPUT_SIZE = 256;

/** Returns an error message, or null if the file can go to the cropper. */
export function checkAvatarFile(file: File): string | null {
  const byType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  const byName = !file.type && /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!byType && !byName) return 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.';
  if (file.size > AVATAR_INPUT_MAX_MB * 1024 * 1024) return `Ảnh tối đa ${AVATAR_INPUT_MAX_MB} MB.`;
  return null;
}
