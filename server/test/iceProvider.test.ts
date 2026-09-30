import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIceProvider, MeteredIceProvider, sanitize } from '../src/comms/iceProvider.js';
import { loadConfig, type VoiceConfig } from '../src/config.js';

/* TURN credentials from Metered, with a fake fetch. */

const HOUR = 60 * 60_000;
const TURN_LIST = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'u1', credential: 'p1' },
  { urls: ['turns:global.relay.metered.ca:443?transport=tcp'], username: 'u1', credential: 'p1' },
];

function fakeMetered(opts: { fail?: boolean } = {}) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  let minted = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (opts.fail) return new Response('nope', { status: 401 });
    if (url.pathname === '/api/v1/turn/credential') return Response.json({ username: 'x', password: 'y', apiKey: `key-${++minted}` });
    if (url.pathname === '/api/v1/turn/credentials') return Response.json(TURN_LIST);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const voice = (metered: Partial<NonNullable<VoiceConfig['metered']>> = {}): VoiceConfig => ({
  metered: { domain: 'caro.metered.live', secretKey: 'secret', apiKey: null, ...metered },
  static: null,
  credentialTtlMs: 6 * HOUR,
});

describe('Metered ICE provider', () => {
  it('mints one expiring credential and reuses it until half its lifetime is gone', async () => {
    let now = 1_000_000;
    const m = fakeMetered();
    const p = new MeteredIceProvider(voice(), m.fetchImpl, () => now);

    assert.deepEqual(await p.get(), TURN_LIST);
    assert.equal(m.calls[0].method, 'POST');
    assert.equal(m.calls[0].url.host, 'caro.metered.live');
    assert.equal(m.calls[0].url.searchParams.get('secretKey'), 'secret');
    assert.deepEqual(m.calls[0].body, { expiryInSeconds: 6 * 3600, label: 'caro-voice' });
    assert.equal(m.calls[1].url.searchParams.get('apiKey'), 'key-1');

    now += 2 * HOUR;
    await Promise.all([p.get(), p.get()]);
    assert.equal(m.calls.length, 2, 'cached while more than half is left');

    now += 2 * HOUR;
    await Promise.all([p.get(), p.get()]);
    assert.equal(m.calls.length, 4, 'one refresh, even with concurrent callers');
    assert.equal(m.calls[3].url.searchParams.get('apiKey'), 'key-2');
  });

  it('uses a dashboard API key directly when no secret key is set', async () => {
    const m = fakeMetered();
    const p = new MeteredIceProvider(voice({ secretKey: null, apiKey: 'dash' }), m.fetchImpl);
    assert.deepEqual(await p.get(), TURN_LIST);
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url.searchParams.get('apiKey'), 'dash');
  });

  it('answers null on failure and backs off instead of retrying every call', async () => {
    const m = fakeMetered({ fail: true });
    const p = new MeteredIceProvider(voice(), m.fetchImpl);
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (msg: string) => void logged.push(msg);
    try {
      assert.equal(await p.get(), null);
      assert.equal(await p.get(), null);
    } finally {
      console.warn = warn;
    }
    assert.equal(m.calls.length, 1);
    assert.ok(!logged.join(' ').includes('secret'), 'the key never reaches the logs');
  });

  it('passes only well-formed STUN/TURN entries to browsers', () => {
    assert.deepEqual(sanitize('nope'), []);
    assert.deepEqual(
      sanitize([{ urls: 'javascript:alert(1)' }, { urls: ['turn:a', 'http://b'], username: 'u', credential: 'c', extra: 1 }, null]),
      [{ urls: ['turn:a'], username: 'u', credential: 'c' }],
    );
  });

  it('serves a fixed TURN login on the Metered relay, credentials on TURN entries only', async () => {
    const cfg = loadConfig({ TURN_USERNAME: 'user', TURN_CREDENTIAL: 'pass' }).voice;
    const servers = (await createIceProvider(cfg)!.get())!;
    assert.deepEqual(servers[0], { urls: 'stun:stun.relay.metered.ca:80' });
    assert.equal(servers.length, 5);
    for (const s of servers.slice(1)) assert.deepEqual([s.username, s.credential], ['user', 'pass']);
    assert.ok(servers.some((s) => s.urls === 'turns:global.relay.metered.ca:443?transport=tcp'));

    const custom = loadConfig({ TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p', TURN_URLS: 'turn:a:3478, http://x' }).voice.static;
    assert.deepEqual(custom?.urls, ['turn:a:3478']);
    assert.equal(createIceProvider(loadConfig({}).voice), null, 'nothing configured: STUN only');
  });

  it('reads METERED_* from the environment', () => {
    assert.equal(loadConfig({}).voice.metered, null);
    assert.deepEqual(loadConfig({ METERED_DOMAIN: 'https://caro.metered.live/', METERED_SECRET_KEY: ' s ' }).voice.metered, {
      domain: 'caro.metered.live',
      secretKey: 's',
      apiKey: null,
    });
  });
});
