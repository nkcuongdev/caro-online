import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { AvatarConfig } from '../config.js';
import type { BotDifficulty } from '../types.js';

/**
 * Avatars travel as one string (`PublicPlayer.avatar`):
 *   - `preset:<id>`                                   bundled with the client (client/public/avatars/<id>.webp)
 *   - `preset:bot-<difficulty>`                       bundled too, but only the server gives it out (bot seats)
 *   - `/api/avatars/files/<id>.<ext>`                 uploaded, local disk (resolved against the API origin)
 *   - `https://res.cloudinary.com/<cloud>/image/upload/…` uploaded, Cloudinary
 *
 * Only values this server can vouch for are accepted, so a player can't make
 * the opponent's browser load an arbitrary third-party URL.
 */

/** What people can pick. Mirrored in client/src/lib/avatar.ts. */
export const AVATAR_PRESETS = [
  'owl', 'ghost', 'robot', 'bear', 'tiger', 'frog',
  'penguin', 'bunny', 'fox', 'panda', 'dragon', 'cat',
] as const;
const PRESET_SET = new Set<string>(AVATAR_PRESETS);

/**
 * One colour per level (green / purple / red), so the opponent's difficulty
 * reads at a glance. Not in AVATAR_PRESETS: a person can't look like a bot.
 */
export const BOT_AVATARS: Record<BotDifficulty, string> = {
  easy: 'preset:bot-easy',
  medium: 'preset:bot-medium',
  hard: 'preset:bot-hard',
};

/** Anything larger than this is not an avatar (the client uploads 256×256). */
export const MAX_AVATAR_DIMENSION = 2048;

export interface SniffedImage {
  bytes: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

export interface AvatarStorage {
  readonly kind: 'local' | 'cloudinary';
  /** Stores the image and returns the avatar value to put on the player. */
  save(image: SniffedImage): Promise<string>;
  /** True if `value` points at an image this storage produced. */
  owns(value: string): boolean;
}

/** Returns the normalized avatar, or null if it isn't one this server accepts. */
export function normalizeAvatar(raw: string | null | undefined, storage: AvatarStorage): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('preset:')) return PRESET_SET.has(value.slice(7)) ? value : null;
  return storage.owns(value) ? value : null;
}

// ─── Image validation ────────────────────────────────────────────────────────

/**
 * Identifies JPEG / PNG / WebP from the file's bytes (never the declared type)
 * and reads its dimensions, so a tiny file that decodes to a huge bitmap
 * can't be used to freeze the opponent's browser.
 */
export function sniffImage(bytes: Buffer): SniffedImage | null {
  let kind: Pick<SniffedImage, 'mime' | 'ext'> | null = null;
  let size: { width: number; height: number } | null = null;
  try {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      kind = { mime: 'image/jpeg', ext: 'jpg' };
      size = jpegSize(bytes);
    } else if (bytes.length > 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString('latin1', 12, 16) === 'IHDR') {
      kind = { mime: 'image/png', ext: 'png' };
      size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    } else if (bytes.length > 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
      kind = { mime: 'image/webp', ext: 'webp' };
      size = webpSize(bytes);
    }
  } catch {
    return null; // truncated header
  }
  if (!kind || !size || size.width < 1 || size.height < 1) return null;
  return { bytes, ...kind, ...size };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function webpSize(b: Buffer) {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

/** Walks the JPEG markers up to the first start-of-frame. */
function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// ─── Storage backends ────────────────────────────────────────────────────────

export const LOCAL_AVATAR_PREFIX = '/api/avatars/files/';
export const LOCAL_AVATAR_FILE = /^[A-Za-z0-9_-]{16}\.(?:webp|jpg|png)$/;

/** Dev / single-instance fallback. Note: Railway and Render disks are wiped on redeploy. */
export class LocalAvatarStorage implements AvatarStorage {
  readonly kind = 'local';
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async save(image: SniffedImage) {
    await mkdir(this.dir, { recursive: true });
    const file = `${nanoid(16)}.${image.ext}`;
    await writeFile(join(this.dir, file), image.bytes, { flag: 'wx' });
    return LOCAL_AVATAR_PREFIX + file;
  }

  owns(value: string) {
    return value.startsWith(LOCAL_AVATAR_PREFIX) && LOCAL_AVATAR_FILE.test(value.slice(LOCAL_AVATAR_PREFIX.length));
  }
}

/** Signed upload to Cloudinary's REST API (no SDK needed). */
export class CloudinaryAvatarStorage implements AvatarStorage {
  readonly kind = 'cloudinary';
  private readonly pattern: RegExp;

  constructor(private readonly cfg: NonNullable<AvatarConfig['cloudinary']>) {
    this.pattern = new RegExp(
      `^https://res\\.cloudinary\\.com/${escapeRegExp(cfg.cloudName)}/image/upload/(?:v\\d+/)?${escapeRegExp(cfg.folder)}/[A-Za-z0-9_-]{16}\\.(?:webp|jpg|png)$`,
    );
  }

  async save(image: SniffedImage) {
    const { cloudName, apiKey, apiSecret, folder } = this.cfg;
    const params: Record<string, string> = {
      folder,
      public_id: nanoid(16),
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const toSign = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `avatar.${image.ext}`);
    for (const [k, v] of Object.entries(params)) form.append(k, v);
    form.append('api_key', apiKey);
    form.append('signature', createHash('sha1').update(toSign + apiSecret).digest('hex'));

    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { secure_url?: unknown; error?: { message?: string } } | null;
    if (!res.ok || typeof body?.secure_url !== 'string') {
      throw new Error(`Cloudinary upload failed (${res.status}): ${body?.error?.message ?? 'no secure_url'}`);
    }
    if (!this.owns(body.secure_url)) throw new Error(`Unexpected Cloudinary URL: ${body.secure_url}`);
    return body.secure_url;
  }

  owns(value: string) {
    return this.pattern.test(value);
  }
}

export function createAvatarStorage(cfg: AvatarConfig): AvatarStorage {
  return cfg.cloudinary ? new CloudinaryAvatarStorage(cfg.cloudinary) : new LocalAvatarStorage(cfg.localDir);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
