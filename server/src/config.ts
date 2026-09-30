import type { BoardSize } from './types.js';

export interface AppConfig {
  port: number;
  /** Allowed CORS origins. Entries may contain `*` wildcards, e.g. `https://*.vercel.app`. */
  clientOrigins: string[];
  /** Board size for rooms created without one. */
  boardSize: BoardSize;
  winLength: number;
  /** Turn time for rooms created without one. */
  turnMs: number;
  startCountdownMs: number;
  disconnectForfeitMs: number;
  /** Tolerance for network latency: a move that reaches the server this late after the deadline still counts. */
  moveGraceMs: number;
  roomIdleTtlMs: number;
  timerBroadcastMs: number;
  /** "Bot is thinking…" pause before the bot moves, including its compute time. */
  botMinDelayMs: number;
  botMaxDelayMs: number;
  avatars: AvatarConfig;
  tournament: TournamentConfig;
  accounts: AccountsConfig;
  voice: VoiceConfig;
}

/**
 * TURN relay for voice chat. Without it, calls rely on public STUN only and
 * fail between some networks (mobile carrier NAT, strict office Wi-Fi).
 */
export interface VoiceConfig {
  /**
   * Metered.ca TURN app. `secretKey` (preferred) mints short-lived credentials;
   * `apiKey` is a single long-lived TURN credential from the dashboard.
   */
  metered: { domain: string; secretKey: string | null; apiKey: string | null } | null;
  /** A fixed TURN username/password (e.g. one credential from the Metered dashboard). Used when `metered` is unset. */
  static: { urls: string[]; username: string; credential: string } | null;
  /** Lifetime of each minted credential; a fresh one is minted once less than half of it is left. */
  credentialTtlMs: number;
}

/** Optional accounts (guests never need one). */
export interface AccountsConfig {
  /** SQLite file holding users, sessions and match history. Must sit on a persistent disk in production. */
  databasePath: string;
  /** HS256 key for login tokens. Unset: a random key is generated once and kept in the database. */
  jwtSecret: string | null;
  /** How long a login lasts. */
  sessionTtlMs: number;
  /** Per-IP budget for login / register attempts. */
  authBurst: number;
  authWindowMs: number;
  /** Failed logins allowed per email per window before that email is paused. */
  failuresPerEmail: number;
}

export interface TournamentConfig {
  /** How long both players have to confirm "ready" before a bracket match; a no-show loses by walkover. */
  readyCheckMs: number;
  /**
   * Time from both players being ready to the first legal move. Covers moving
   * to the game page plus the usual 3-2-1 countdown.
   */
  matchStartDelayMs: number;
  /** Tournaments nobody has been connected to for this long are deleted. */
  idleTtlMs: number;
  /** Best-of-3/5 series: pause after a game (result on screen) before the next one starts in the same room. */
  nextGameDelayMs: number;
}

export interface AvatarConfig {
  /** Largest accepted upload. The client already crops to 256×256, which is ~20–150 KB. */
  maxBytes: number;
  /** Per-IP upload budget: at most `uploadBurst` uploads per `uploadWindowMs`. */
  uploadBurst: number;
  uploadWindowMs: number;
  /** Where uploads are written when Cloudinary isn't configured. */
  localDir: string;
  /** Set from CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET. */
  cloudinary: { cloudName: string; apiKey: string; apiSecret: string; folder: string } | null;
}

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: positive(env.PORT, 4000),
    clientOrigins: (env.CLIENT_ORIGIN ?? "http://localhost:5173,*")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
    boardSize: 20,
    winLength: 5,
    turnMs: positive(env.TURN_SECONDS, 30) * 1000,
    startCountdownMs: positive(env.START_COUNTDOWN_SECONDS, 3) * 1000,
    disconnectForfeitMs: positive(env.DISCONNECT_FORFEIT_SECONDS, 60) * 1000,
    moveGraceMs: positive(env.MOVE_GRACE_MS, 300),
    roomIdleTtlMs: positive(env.ROOM_IDLE_MINUTES, 15) * 60_000,
    timerBroadcastMs: 1000,
    botMinDelayMs: 300,
    botMaxDelayMs: 800,
    avatars: {
      maxBytes: positive(env.AVATAR_MAX_KB, 1024) * 1024,
      uploadBurst: positive(env.AVATAR_UPLOADS_PER_10_MIN, 10),
      uploadWindowMs: 10 * 60_000,
      localDir: env.AVATAR_UPLOAD_DIR?.trim() || 'uploads/avatars',
      cloudinary: loadCloudinary(env),
    },
    accounts: {
      databasePath: env.DATABASE_PATH?.trim() || 'data/caro.db',
      jwtSecret: loadJwtSecret(env),
      sessionTtlMs: positive(env.AUTH_SESSION_DAYS, 30) * 24 * 60 * 60_000,
      authBurst: positive(env.AUTH_ATTEMPTS_PER_10_MIN, 20),
      authWindowMs: 10 * 60_000,
      failuresPerEmail: 8,
    },
    tournament: {
      readyCheckMs: positive(env.TOURNAMENT_READY_SECONDS, 30) * 1000,
      matchStartDelayMs: positive(env.TOURNAMENT_START_DELAY_SECONDS, 5) * 1000,
      idleTtlMs: positive(env.TOURNAMENT_IDLE_MINUTES, 30) * 60_000,
      nextGameDelayMs: positive(env.TOURNAMENT_NEXT_GAME_SECONDS, 6) * 1000,
    },
    voice: {
      metered: loadMetered(env),
      static: loadStaticTurn(env),
      credentialTtlMs: positive(env.METERED_CREDENTIAL_HOURS, 6) * 60 * 60_000,
    },
  };
}

/** Metered's global relay, as its dashboard lists it for every credential. */
const METERED_RELAY_URLS = [
  'stun:stun.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80?transport=tcp',
  'turn:global.relay.metered.ca:443',
  'turns:global.relay.metered.ca:443?transport=tcp',
];

/** `TURN_USERNAME` + `TURN_CREDENTIAL`, optionally `TURN_URLS` (comma-separated; default: Metered's relay). */
function loadStaticTurn(env: NodeJS.ProcessEnv): VoiceConfig['static'] {
  const username = env.TURN_USERNAME?.trim();
  const credential = env.TURN_CREDENTIAL?.trim();
  if (!username && !credential) return null;
  if (!username || !credential) {
    console.warn('[caro] TURN needs both TURN_USERNAME and TURN_CREDENTIAL; voice uses STUN only');
    return null;
  }
  const urls = (env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter((u) => /^(stun|turns?):/.test(u));
  return { urls: urls.length ? urls : METERED_RELAY_URLS, username, credential };
}

/** `METERED_DOMAIN` (e.g. `myapp.metered.live`) plus `METERED_SECRET_KEY` or `METERED_API_KEY`. */
function loadMetered(env: NodeJS.ProcessEnv): VoiceConfig['metered'] {
  const domain = env.METERED_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const secretKey = env.METERED_SECRET_KEY?.trim() || null;
  const apiKey = env.METERED_API_KEY?.trim() || null;
  if (!domain && !secretKey && !apiKey) return null;
  if (!domain || (!secretKey && !apiKey)) {
    console.warn('[caro] Metered TURN needs METERED_DOMAIN and METERED_SECRET_KEY (or METERED_API_KEY); voice uses STUN only');
    return null;
  }
  if (secretKey?.startsWith('sk_id_') || secretKey?.startsWith('sk_secret_')) {
    console.warn('[caro] METERED_SECRET_KEY looks like a Realtime Messaging key, not a TURN secret key; TURN will be rejected');
  }
  return { domain, secretKey, apiKey };
}

function loadJwtSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) return null;
  if (secret.length < 32) console.warn('[caro] JWT_SECRET is shorter than 32 characters; use a long random value');
  return secret;
}

/** `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>` or the three separate variables. */
function loadCloudinary(env: NodeJS.ProcessEnv): AvatarConfig['cloudinary'] {
  const folder = env.CLOUDINARY_FOLDER?.trim() || 'caro/avatars';
  const url = env.CLOUDINARY_URL?.trim();
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: decodeURIComponent(m[1]), apiSecret: decodeURIComponent(m[2]), cloudName: m[3], folder };
    console.warn('[caro] CLOUDINARY_URL is malformed; falling back to local avatar storage');
  }
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret, folder } : null;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
): boolean {
  // Non-browser clients (curl, health checks, tests) send no Origin header.
  if (!origin) return true;
  return allowed.some((pattern) => {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === origin;
    const re = new RegExp(
      "^" + pattern.split("*").map(escapeRegExp).join("[^/]*") + "$",
    );
    return re.test(origin);
  });
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
