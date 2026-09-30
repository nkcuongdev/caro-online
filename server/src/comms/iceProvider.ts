import type { VoiceConfig } from '../config.js';
import type { IceServer } from '../protocol.js';

/** Where a player's peer connection gets its TURN servers. `null` = use the client's built-in STUN list. */
export interface IceProvider {
  get(): Promise<IceServer[] | null>;
}

const REQUEST_TIMEOUT_MS = 5_000;
/** After a failed refresh, don't hammer Metered on every "enable voice" click. */
const RETRY_AFTER_MS = 60_000;
const MAX_SERVERS = 10;

/**
 * TURN servers from a Metered.ca app.
 *
 * With a secret key, one expiring credential is minted and shared until less
 * than half its lifetime is left, so every player receives one that stays
 * valid for at least `credentialTtlMs / 2` and Metered is called a few times a
 * day rather than once per call. The secret key itself never leaves the server.
 *
 * Every failure resolves to the last still-valid list or `null`: voice then
 * falls back to STUN and nothing else is affected.
 */
export class MeteredIceProvider implements IceProvider {
  private cached: { servers: IceServer[]; expiresAt: number } | null = null;
  private inflight: Promise<IceServer[] | null> | null = null;
  private failedAt = -Infinity;

  constructor(
    private readonly cfg: VoiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<IceServer[] | null> {
    if (!this.cfg.metered) return null;
    const now = this.now();
    if (this.cached && this.cached.expiresAt - now > this.cfg.credentialTtlMs / 2) return this.cached.servers;
    if (now - this.failedAt < RETRY_AFTER_MS) return this.stillValid();
    this.inflight ??= this.refresh(this.cfg.metered).finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async refresh(m: NonNullable<VoiceConfig['metered']>): Promise<IceServer[] | null> {
    try {
      let apiKey = m.apiKey;
      if (m.secretKey) {
        const cred = await this.call(`https://${m.domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(m.secretKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiryInSeconds: Math.round(this.cfg.credentialTtlMs / 1000), label: 'caro-voice' }),
        });
        apiKey = typeof (cred as { apiKey?: unknown })?.apiKey === 'string' ? (cred as { apiKey: string }).apiKey : null;
        if (!apiKey) throw new Error('credential response has no apiKey');
      }
      const servers = sanitize(await this.call(`https://${m.domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey!)}`));
      if (!servers.some((s) => toList(s.urls).some((u) => u.startsWith('turn')))) throw new Error('no TURN server in the list');
      // A dashboard API key doesn't expire, but re-reading it now and then picks up changes made there.
      this.cached = { servers, expiresAt: this.now() + this.cfg.credentialTtlMs };
      return servers;
    } catch (err) {
      this.failedAt = this.now();
      // Only the message: URLs carry the key.
      console.warn(`[voice] Metered TURN unavailable (${err instanceof Error ? err.message : 'unknown error'}); using STUN only`);
      return this.stillValid();
    }
  }

  private stillValid() {
    return this.cached && this.cached.expiresAt > this.now() ? this.cached.servers : null;
  }

  private async call(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Metered answered HTTP ${res.status}`);
    return res.json();
  }
}

/** A fixed TURN username/password from the environment. Only seated players ever receive it. */
export class StaticIceProvider implements IceProvider {
  private readonly servers: IceServer[];

  constructor(cfg: NonNullable<VoiceConfig['static']>) {
    this.servers = cfg.urls.map((urls) => (urls.startsWith('stun:') ? { urls } : { urls, username: cfg.username, credential: cfg.credential }));
  }

  async get() {
    return this.servers;
  }
}

/** Expiring Metered credentials when a key is set, else a fixed TURN login, else none (STUN only). */
export function createIceProvider(cfg: VoiceConfig): IceProvider | null {
  if (cfg.metered) return new MeteredIceProvider(cfg);
  if (cfg.static) return new StaticIceProvider(cfg.static);
  return null;
}

const toList = (urls: string | string[]) => (Array.isArray(urls) ? urls : [urls]);

/** Keeps only well-formed STUN/TURN entries; whatever Metered sends goes straight to browsers. */
export function sanitize(raw: unknown): IceServer[] {
  if (!Array.isArray(raw)) return [];
  const out: IceServer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => typeof u === 'string' && /^(stun|turns?):/.test(u));
    if (!list.length) continue;
    const server: IceServer = { urls: Array.isArray(urls) ? list : list[0] };
    if (typeof username === 'string') server.username = username;
    if (typeof credential === 'string') server.credential = credential;
    out.push(server);
    if (out.length >= MAX_SERVERS) break;
  }
  return out;
}
