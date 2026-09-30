import { useEffect, useState } from 'react';
import { request, socket } from './socket';

/**
 * Server clock estimate. The server owns every deadline; the client only
 * needs `serverNow()` to render how much of that deadline remains. We take
 * several NTP-style samples and keep the one with the lowest round-trip.
 */
let offsetMs = 0;
let bestRtt = Infinity;
let syncing: Promise<void> | null = null;

export const serverNow = () => Date.now() + offsetMs;

/** Coarse correction from a timestamped server message, used before the first ping completes. */
export function noteServerTime(serverTime: number) {
  if (bestRtt === Infinity) offsetMs = serverTime - Date.now();
}

export function syncClock(samples = 5): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    let best: { rtt: number; offset: number } | null = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const res = await request<{ serverNow: number }>('time:sync', { t0 }, 3_000);
      const t1 = Date.now();
      if (!res.ok) continue;
      const rtt = t1 - t0;
      const offset = res.serverNow - (t0 + rtt / 2);
      if (!best || rtt < best.rtt) best = { rtt, offset };
    }
    if (best) {
      offsetMs = best.offset;
      bestRtt = best.rtt;
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

let started = false;
/** Keeps the offset fresh: on (re)connect, when the tab becomes visible, and every minute. */
export function startClockSync() {
  if (started) return;
  started = true;
  const resync = () => {
    bestRtt = Infinity;
    void syncClock();
  };
  socket.on('connect', resync);
  if (socket.connected) resync();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket.connected) resync();
  });
  setInterval(() => socket.connected && void syncClock(3), 60_000);
}

/**
 * Re-renders every `intervalMs` with the current server time. Because the
 * value is recomputed from the clock (not decremented), a throttled
 * background tab snaps back to the correct time as soon as it is visible.
 */
export function useServerNow(intervalMs = 250, enabled = true) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(serverNow());
    tick();
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
  return now;
}
