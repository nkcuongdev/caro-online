import { io, type Socket } from 'socket.io-client';
import { getAuthToken } from './authToken';
import { SOCKET_URL } from './env';
import type { Ack } from './protocol';

export const socket: Socket = io(SOCKET_URL || undefined, {
  // Websocket first; polling is kept as a fallback for restrictive networks.
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3_000,
  timeout: 10_000,
  // Read on every (re)connect, so a reconnect after logging in or out carries the current identity.
  auth: (cb) => cb({ token: getAuthToken() }),
});

/** Emits with an ack and never rejects: timeouts come back as `{ ok: false, error: 'TIMEOUT' }`. */
export async function request<T extends object = object>(event: string, payload: unknown, timeoutMs = 8_000): Promise<Ack<T>> {
  try {
    return (await socket.timeout(timeoutMs).emitWithAck(event, payload)) as Ack<T>;
  } catch {
    return { ok: false, error: 'TIMEOUT', message: 'Máy chủ không phản hồi. Hãy kiểm tra kết nối mạng.' };
  }
}
