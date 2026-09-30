import { apiUrl } from './env';

export interface RoomInfo {
  exists: boolean;
  status?: string;
  players?: number;
  seatAvailable?: boolean;
  hostName?: string | null;
  hostAvatar?: string | null;
  /** The host's equipped name style id. */
  hostNameStyle?: string | null;
  hostAvatarFrame?: string | null;
  boardSize?: number;
  turnMs?: number;
}

/** Looks a room up over HTTP. Resolves to null if the API is unreachable. */
export async function fetchRoomInfo(roomId: string, timeoutMs = 4_000): Promise<RoomInfo | null> {
  try {
    const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}`), { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as RoomInfo) : null;
  } catch {
    return null;
  }
}

export type UploadResult = { ok: true; avatar: string } | { ok: false; message: string };

/** Uploads an already-cropped avatar image. The server answers with the value to use as `avatar`. */
export async function uploadAvatar(image: Blob, timeoutMs = 20_000): Promise<UploadResult> {
  try {
    const res = await fetch(apiUrl('/api/avatars'), {
      method: 'POST',
      headers: { 'Content-Type': image.type || 'application/octet-stream' },
      body: image,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; avatar?: unknown; message?: string } | null;
    if (res.ok && body?.ok && typeof body.avatar === 'string') return { ok: true, avatar: body.avatar };
    return { ok: false, message: body?.message ?? 'Không tải được ảnh lên, hãy thử lại.' };
  } catch {
    return { ok: false, message: 'Không kết nối được máy chủ để tải ảnh lên.' };
  }
}
