const trim = (url: string | undefined) => (url ?? '').trim().replace(/\/+$/, '');

/** Game server origin. Empty = same origin (Vite dev proxy). */
export const SOCKET_URL = trim(import.meta.env.VITE_SOCKET_URL);

/** REST API origin; defaults to the socket server. */
export const API_URL = trim(import.meta.env.VITE_API_URL) || SOCKET_URL;

export const PUBLIC_URL = () => trim(import.meta.env.VITE_PUBLIC_URL) || window.location.origin;

export const inviteLink = (roomId: string) => `${PUBLIC_URL()}/game/${roomId}`;

export const tournamentLink = (tournamentId: string) => `${PUBLIC_URL()}/t/${tournamentId}`;

export const apiUrl = (path: string) => `${API_URL}${path}`;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** STUN/TURN servers for voice chat. Invalid JSON falls back to public STUN. */
export const ICE_SERVERS: RTCIceServer[] = (() => {
  const raw = import.meta.env.VITE_ICE_SERVERS?.trim();
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length ? (parsed as RTCIceServer[]) : DEFAULT_ICE_SERVERS;
  } catch {
    console.warn('[voice] VITE_ICE_SERVERS is not valid JSON; using public STUN');
    return DEFAULT_ICE_SERVERS;
  }
})();
