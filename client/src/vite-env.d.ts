/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_PUBLIC_URL?: string;
  /** JSON array of RTCIceServer, e.g. to add a TURN server for voice chat. */
  readonly VITE_ICE_SERVERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
